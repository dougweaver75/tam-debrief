import sqlite3
import os
import threading
import webbrowser
from datetime import datetime
from flask import Flask, g, jsonify, request, render_template, redirect

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, 'ccrm.db')

app = Flask(__name__)


# ── DB helpers ──────────────────────────────────────────────────────────────

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db

@app.teardown_appcontext
def close_db(e=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def query(sql, args=(), one=False):
    cur = get_db().execute(sql, args)
    rv = cur.fetchall()
    return (rv[0] if rv else None) if one else rv

def execute(sql, args=()):
    db = get_db()
    cur = db.execute(sql, args)
    db.commit()
    return cur

def as_dict(row):
    return dict(row) if row else None

def as_list(rows):
    return [dict(r) for r in rows]

def now_iso():
    return datetime.utcnow().isoformat(timespec='seconds')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    schema = os.path.join(BASE_DIR, 'schema.sql')
    with open(schema) as f:
        conn.executescript(f.read())
    conn.close()

def migrate_db():
    """Create missing tables and add new columns to existing tables."""
    db = sqlite3.connect(DB_PATH)
    schema = os.path.join(BASE_DIR, 'schema.sql')
    with open(schema) as f:
        db.executescript(f.read())
    cols = {r[1] for r in db.execute("PRAGMA table_info(contacts)")}
    if 'company_id' not in cols:
        db.execute("ALTER TABLE contacts ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL")
    if 'reports_to' not in cols:
        db.execute("ALTER TABLE contacts ADD COLUMN reports_to INTEGER REFERENCES contacts(id) ON DELETE SET NULL")
    cols_m = {r[1] for r in db.execute("PRAGMA table_info(meetings)")}
    if 'summary' not in cols_m:
        db.execute("ALTER TABLE meetings ADD COLUMN summary TEXT DEFAULT ''")
    db.commit()
    db.close()


# ── Page routes ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return redirect('/dashboard')

@app.route('/dashboard')
def dashboard_page():
    return render_template('dashboard.html')

@app.route('/contacts')
def contacts_page():
    return render_template('contacts.html')

@app.route('/contacts/<int:cid>')
def contact_page(cid):
    return render_template('contact.html', contact_id=cid)

@app.route('/companies')
def companies_page():
    return render_template('companies.html')

@app.route('/companies/<int:coid>')
def company_page(coid):
    return render_template('company.html', company_id=coid)

@app.route('/meetings')
def meetings_page():
    return render_template('meetings.html')

@app.route('/meetings/<int:mid>')
def meeting_page(mid):
    return render_template('meeting.html', meeting_id=mid)

@app.route('/meetings/new')
def new_meeting_page():
    return render_template('meeting_new.html')

@app.route('/sanitize')
def sanitize_page():
    return render_template('sanitize.html')


# ── API: contacts ────────────────────────────────────────────────────────────

@app.route('/api/contacts', methods=['GET'])
def api_list_contacts():
    search    = request.args.get('search', '').strip()
    sort      = request.args.get('sort', 'last_name')
    direction = 'DESC' if request.args.get('dir', 'asc').lower() == 'desc' else 'ASC'
    allowed   = {'first_name', 'last_name', 'company', 'email', 'created_at'}
    if sort not in allowed:
        sort = 'last_name'
    if search:
        like = f'%{search}%'
        rows = query(
            f'SELECT c.*, co.name AS company_name FROM contacts c '
            f'LEFT JOIN companies co ON co.id=c.company_id '
            f'WHERE c.first_name LIKE ? OR c.last_name LIKE ? '
            f'OR c.company LIKE ? OR co.name LIKE ? OR c.email LIKE ? '
            f'ORDER BY c.{sort} {direction}',
            (like, like, like, like, like)
        )
    else:
        rows = query(
            f'SELECT c.*, co.name AS company_name FROM contacts c '
            f'LEFT JOIN companies co ON co.id=c.company_id '
            f'ORDER BY c.{sort} {direction}'
        )
    return jsonify(as_list(rows))


@app.route('/api/contacts', methods=['POST'])
def api_create_contact():
    data = request.get_json(force=True) or {}
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()
    if not first_name or not last_name:
        return jsonify({'error': 'first_name and last_name are required'}), 400
    ts  = now_iso()
    company_id  = data.get('company_id') or None
    reports_to  = data.get('reports_to') or None
    cur = execute(
        'INSERT INTO contacts (first_name,last_name,company,title,email,phone,notes,'
        'company_id,reports_to,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        (first_name, last_name,
         data.get('company',''), data.get('title',''),
         data.get('email',''),   data.get('phone',''),
         data.get('notes',''),   company_id, reports_to, ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM contacts WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/contacts/<int:cid>', methods=['GET'])
def api_get_contact(cid):
    row = query('SELECT * FROM contacts WHERE id=?', (cid,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(as_dict(row))


@app.route('/api/contacts/<int:cid>', methods=['PUT'])
def api_update_contact(cid):
    if not query('SELECT id FROM contacts WHERE id=?', (cid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()
    if not first_name or not last_name:
        return jsonify({'error': 'first_name and last_name are required'}), 400
    company_id = data.get('company_id') or None
    reports_to = data.get('reports_to') or None
    execute(
        'UPDATE contacts SET first_name=?,last_name=?,company=?,title=?,email=?,phone=?,notes=?,'
        'company_id=?,reports_to=?,updated_at=? WHERE id=?',
        (first_name, last_name,
         data.get('company',''), data.get('title',''),
         data.get('email',''),   data.get('phone',''),
         data.get('notes',''),   company_id, reports_to, now_iso(), cid)
    )
    return jsonify(as_dict(query('SELECT * FROM contacts WHERE id=?', (cid,), one=True)))


@app.route('/api/contacts/<int:cid>', methods=['DELETE'])
def api_delete_contact(cid):
    cur = execute('DELETE FROM contacts WHERE id=?', (cid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


# ── API: interactions ────────────────────────────────────────────────────────

@app.route('/api/contacts/<int:cid>/interactions', methods=['GET'])
def api_list_interactions(cid):
    rows = query(
        'SELECT * FROM interactions WHERE contact_id=? ORDER BY interaction_date DESC, created_at DESC',
        (cid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/interactions', methods=['POST'])
def api_create_interaction():
    data = request.get_json(force=True) or {}
    contact_id = data.get('contact_id')
    itype      = data.get('type', '')
    summary    = data.get('summary', '').strip()
    idate      = data.get('interaction_date', '')
    if not contact_id or not summary or not idate:
        return jsonify({'error': 'contact_id, summary, and interaction_date are required'}), 400
    if itype not in ('call', 'email', 'meeting', 'note'):
        return jsonify({'error': 'type must be call, email, meeting, or note'}), 400
    try:
        cur = execute(
            'INSERT INTO interactions (contact_id,type,summary,interaction_date,created_at) VALUES (?,?,?,?,?)',
            (contact_id, itype, summary, idate, now_iso())
        )
    except sqlite3.IntegrityError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify(as_dict(query('SELECT * FROM interactions WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/interactions/<int:iid>', methods=['DELETE'])
def api_delete_interaction(iid):
    cur = execute('DELETE FROM interactions WHERE id=?', (iid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


# ── API: companies ───────────────────────────────────────────────────────────

@app.route('/api/companies', methods=['GET'])
def api_list_companies():
    search = request.args.get('search', '').strip()
    if search:
        like = f'%{search}%'
        rows = query(
            'SELECT * FROM companies WHERE name LIKE ? OR industry LIKE ? ORDER BY name ASC',
            (like, like)
        )
    else:
        rows = query('SELECT * FROM companies ORDER BY name ASC')
    return jsonify(as_list(rows))


@app.route('/api/companies', methods=['POST'])
def api_create_company():
    data = request.get_json(force=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO companies (name,industry,website,address,notes,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?)',
        (name, data.get('industry',''), data.get('website',''),
         data.get('address',''), data.get('notes',''), ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM companies WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/companies/<int:coid>', methods=['GET'])
def api_get_company(coid):
    row = query('SELECT * FROM companies WHERE id=?', (coid,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(as_dict(row))


@app.route('/api/companies/<int:coid>', methods=['PUT'])
def api_update_company(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    execute(
        'UPDATE companies SET name=?,industry=?,website=?,address=?,notes=?,updated_at=? WHERE id=?',
        (name, data.get('industry',''), data.get('website',''),
         data.get('address',''), data.get('notes',''), now_iso(), coid)
    )
    return jsonify(as_dict(query('SELECT * FROM companies WHERE id=?', (coid,), one=True)))


@app.route('/api/companies/<int:coid>', methods=['DELETE'])
def api_delete_company(coid):
    cur = execute('DELETE FROM companies WHERE id=?', (coid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


@app.route('/api/companies/<int:coid>/contacts', methods=['GET'])
def api_company_contacts(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    rows = query(
        'SELECT * FROM contacts WHERE company_id=? ORDER BY last_name ASC, first_name ASC',
        (coid,)
    )
    return jsonify(as_list(rows))


# ── API: meetings ────────────────────────────────────────────────────────────

@app.route('/api/meetings', methods=['GET'])
def api_list_meetings():
    rows = query(
        'SELECT m.*, co.name AS company_name FROM meetings m '
        'LEFT JOIN companies co ON co.id=m.company_id '
        'ORDER BY m.meeting_date DESC'
    )
    return jsonify(as_list(rows))


@app.route('/api/meetings', methods=['POST'])
def api_create_meeting():
    data = request.get_json(force=True) or {}
    title = data.get('title', '').strip()
    mdate = data.get('meeting_date', '').strip()
    if not title or not mdate:
        return jsonify({'error': 'title and meeting_date are required'}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO meetings (title,meeting_date,company_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        (title, mdate, data.get('company_id') or None, data.get('notes',''), ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM meetings WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/meetings/<int:mid>', methods=['GET'])
def api_get_meeting(mid):
    row = query(
        'SELECT m.*, co.name AS company_name FROM meetings m '
        'LEFT JOIN companies co ON co.id=m.company_id WHERE m.id=?',
        (mid,), one=True
    )
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(as_dict(row))


@app.route('/api/meetings/<int:mid>', methods=['PUT'])
def api_update_meeting(mid):
    if not query('SELECT id FROM meetings WHERE id=?', (mid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    title = data.get('title', '').strip()
    mdate = data.get('meeting_date', '').strip()
    if not title or not mdate:
        return jsonify({'error': 'title and meeting_date are required'}), 400
    execute(
        'UPDATE meetings SET title=?,meeting_date=?,company_id=?,notes=?,updated_at=? WHERE id=?',
        (title, mdate, data.get('company_id') or None, data.get('notes',''), now_iso(), mid)
    )
    return jsonify(as_dict(query(
        'SELECT m.*, co.name AS company_name FROM meetings m '
        'LEFT JOIN companies co ON co.id=m.company_id WHERE m.id=?',
        (mid,), one=True
    )))


@app.route('/api/meetings/<int:mid>', methods=['DELETE'])
def api_delete_meeting(mid):
    cur = execute('DELETE FROM meetings WHERE id=?', (mid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


@app.route('/api/meetings/<int:mid>/summary', methods=['PATCH'])
def api_update_meeting_summary(mid):
    if not query('SELECT id FROM meetings WHERE id=?', (mid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data    = request.get_json(force=True) or {}
    summary = data.get('summary', '').strip()
    if not summary:
        return jsonify({'error': 'summary is required'}), 400
    execute('UPDATE meetings SET summary=?,updated_at=? WHERE id=?',
            (summary, now_iso(), mid))
    return jsonify({'ok': True})


@app.route('/api/sanitize/context', methods=['GET'])
def api_sanitize_context():
    mid = request.args.get('meeting_id', type=int)
    if not mid:
        return jsonify({'error': 'meeting_id is required'}), 400
    meeting = query(
        'SELECT m.*, co.name AS company_name FROM meetings m '
        'LEFT JOIN companies co ON co.id=m.company_id WHERE m.id=?',
        (mid,), one=True
    )
    if not meeting:
        return jsonify({'error': 'Not found'}), 404
    m = as_dict(meeting)
    attendees = query(
        'SELECT c.id, c.first_name, c.last_name FROM contacts c '
        'JOIN meeting_attendees ma ON ma.contact_id=c.id '
        'WHERE ma.meeting_id=? ORDER BY c.last_name, c.first_name',
        (mid,)
    )
    company = None
    if m.get('company_id'):
        company = {'id': m['company_id'], 'name': m['company_name']}
    return jsonify({
        'meeting_id': m['id'],
        'title':      m['title'],
        'notes':      m['notes'] or '',
        'company':    company,
        'attendees':  as_list(attendees),
    })


@app.route('/api/meetings/<int:mid>/attendees', methods=['GET'])
def api_list_attendees(mid):
    rows = query(
        'SELECT c.* FROM contacts c '
        'JOIN meeting_attendees ma ON ma.contact_id=c.id '
        'WHERE ma.meeting_id=? ORDER BY c.last_name ASC, c.first_name ASC',
        (mid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/meetings/<int:mid>/attendees', methods=['POST'])
def api_add_attendee(mid):
    if not query('SELECT id FROM meetings WHERE id=?', (mid,), one=True):
        return jsonify({'error': 'Meeting not found'}), 404
    data = request.get_json(force=True) or {}
    contact_id = data.get('contact_id')
    if not contact_id:
        return jsonify({'error': 'contact_id is required'}), 400
    try:
        execute('INSERT OR IGNORE INTO meeting_attendees (meeting_id, contact_id) VALUES (?,?)',
                (mid, contact_id))
    except sqlite3.IntegrityError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'ok': True}), 201


@app.route('/api/meetings/<int:mid>/attendees/<int:cid>', methods=['DELETE'])
def api_remove_attendee(mid, cid):
    cur = execute('DELETE FROM meeting_attendees WHERE meeting_id=? AND contact_id=?', (mid, cid))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


# ── API: dashboard ───────────────────────────────────────────────────────────

@app.route('/api/dashboard', methods=['GET'])
def api_dashboard():
    total   = query('SELECT COUNT(*) AS n FROM contacts', one=True)['n']
    meetings = query('SELECT COUNT(*) AS n FROM meetings', one=True)['n']
    open_ai = query(
        'SELECT COUNT(*) AS n FROM action_items WHERE completed=0', one=True
    )['n']
    recent  = query(
        'SELECT i.*, c.first_name, c.last_name FROM interactions i '
        'JOIN contacts c ON c.id=i.contact_id '
        'ORDER BY i.interaction_date DESC, i.created_at DESC LIMIT 10'
    )
    action_items = query(
        'SELECT a.*, c.first_name, c.last_name, m.title AS meeting_title '
        'FROM action_items a '
        'JOIN meetings m ON m.id=a.meeting_id '
        'LEFT JOIN contacts c ON c.id=a.assigned_to '
        'WHERE a.completed=0 '
        'ORDER BY CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END ASC, a.due_date ASC '
        'LIMIT 20'
    )
    return jsonify({
        'total_contacts':       total,
        'total_meetings':       meetings,
        'open_action_items':    open_ai,
        'recent_interactions':  as_list(recent),
        'action_items':         as_list(action_items),
    })


# ── API: action items ────────────────────────────────────────────────────────

@app.route('/api/meetings/<int:mid>/action_items', methods=['GET'])
def api_list_action_items(mid):
    rows = query(
        'SELECT a.*, c.first_name, c.last_name FROM action_items a '
        'LEFT JOIN contacts c ON c.id=a.assigned_to '
        'WHERE a.meeting_id=? '
        'ORDER BY CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END ASC, a.due_date ASC',
        (mid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/meetings/<int:mid>/action_items', methods=['POST'])
def api_create_action_item(mid):
    if not query('SELECT id FROM meetings WHERE id=?', (mid,), one=True):
        return jsonify({'error': 'Meeting not found'}), 404
    data = request.get_json(force=True) or {}
    description = data.get('description', '').strip()
    if not description:
        return jsonify({'error': 'description is required'}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO action_items (meeting_id,assigned_to,description,due_date,completed,created_at,updated_at) '
        'VALUES (?,?,?,?,0,?,?)',
        (mid, data.get('assigned_to') or None, description,
         data.get('due_date') or None, ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM action_items WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/action_items/<int:aid>', methods=['PUT'])
def api_update_action_item(aid):
    if not query('SELECT id FROM action_items WHERE id=?', (aid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    description = data.get('description', '').strip()
    if not description:
        return jsonify({'error': 'description is required'}), 400
    execute(
        'UPDATE action_items SET description=?,due_date=?,assigned_to=?,updated_at=? WHERE id=?',
        (description, data.get('due_date') or None,
         data.get('assigned_to') or None, now_iso(), aid)
    )
    return jsonify(as_dict(query('SELECT * FROM action_items WHERE id=?', (aid,), one=True)))


@app.route('/api/action_items/<int:aid>/toggle', methods=['PATCH'])
def api_toggle_action_item(aid):
    row = query('SELECT * FROM action_items WHERE id=?', (aid,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    new_val = 0 if row['completed'] else 1
    execute('UPDATE action_items SET completed=?,updated_at=? WHERE id=?',
            (new_val, now_iso(), aid))
    return jsonify(as_dict(query('SELECT * FROM action_items WHERE id=?', (aid,), one=True)))


@app.route('/api/action_items/<int:aid>', methods=['DELETE'])
def api_delete_action_item(aid):
    cur = execute('DELETE FROM action_items WHERE id=?', (aid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if not os.path.exists(DB_PATH):
        init_db()
    migrate_db()
    threading.Timer(1.2, lambda: webbrowser.open('http://localhost:5000/')).start()
    app.run(debug=False, port=5000, host='127.0.0.1')
