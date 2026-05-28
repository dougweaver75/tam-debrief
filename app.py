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
    """Add columns to existing tables that schema.sql can't add (SQLite ALTER limitations)."""
    db = sqlite3.connect(DB_PATH)
    cols = {r[1] for r in db.execute("PRAGMA table_info(contacts)")}
    if 'company_id' not in cols:
        db.execute("ALTER TABLE contacts ADD COLUMN company_id INTEGER")
    if 'reports_to' not in cols:
        db.execute("ALTER TABLE contacts ADD COLUMN reports_to INTEGER")
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
            f'SELECT * FROM contacts WHERE first_name LIKE ? OR last_name LIKE ? '
            f'OR company LIKE ? OR email LIKE ? ORDER BY {sort} {direction}',
            (like, like, like, like)
        )
    else:
        rows = query(f'SELECT * FROM contacts ORDER BY {sort} {direction}')
    return jsonify(as_list(rows))


@app.route('/api/contacts', methods=['POST'])
def api_create_contact():
    data = request.get_json(force=True) or {}
    first_name = data.get('first_name', '').strip()
    last_name  = data.get('last_name', '').strip()
    if not first_name or not last_name:
        return jsonify({'error': 'first_name and last_name are required'}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO contacts (first_name,last_name,company,title,email,phone,notes,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?)',
        (first_name, last_name,
         data.get('company',''), data.get('title',''),
         data.get('email',''),   data.get('phone',''),
         data.get('notes',''),   ts, ts)
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
    execute(
        'UPDATE contacts SET first_name=?,last_name=?,company=?,title=?,email=?,phone=?,notes=?,updated_at=? WHERE id=?',
        (first_name, last_name,
         data.get('company',''), data.get('title',''),
         data.get('email',''),   data.get('phone',''),
         data.get('notes',''),   now_iso(), cid)
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


# ── API: deals ───────────────────────────────────────────────────────────────

@app.route('/api/contacts/<int:cid>/deals', methods=['GET'])
def api_list_deals(cid):
    rows = query('SELECT * FROM deals WHERE contact_id=? ORDER BY created_at DESC', (cid,))
    return jsonify(as_list(rows))


@app.route('/api/deals', methods=['POST'])
def api_create_deal():
    data = request.get_json(force=True) or {}
    contact_id = data.get('contact_id')
    title      = data.get('title', '').strip()
    if not contact_id or not title:
        return jsonify({'error': 'contact_id and title are required'}), 400
    try:
        ts  = now_iso()
        cur = execute(
            'INSERT INTO deals (contact_id,title,value,stage,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
            (contact_id, title,
             float(data.get('value', 0)), data.get('stage', 'lead'),
             data.get('notes', ''), ts, ts)
        )
    except sqlite3.IntegrityError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify(as_dict(query('SELECT * FROM deals WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/deals/<int:did>', methods=['PUT'])
def api_update_deal(did):
    if not query('SELECT id FROM deals WHERE id=?', (did,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    title = data.get('title', '').strip()
    if not title:
        return jsonify({'error': 'title is required'}), 400
    execute(
        'UPDATE deals SET title=?,value=?,stage=?,notes=?,updated_at=? WHERE id=?',
        (title, float(data.get('value', 0)),
         data.get('stage', 'lead'), data.get('notes', ''), now_iso(), did)
    )
    return jsonify(as_dict(query('SELECT * FROM deals WHERE id=?', (did,), one=True)))


@app.route('/api/deals/<int:did>', methods=['DELETE'])
def api_delete_deal(did):
    cur = execute('DELETE FROM deals WHERE id=?', (did,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


# ── API: companies ───────────────────────────────────────────────────────────

@app.route('/api/companies', methods=['GET'])
def api_list_companies():
    rows = query('SELECT * FROM companies ORDER BY name ASC')
    return jsonify(as_list(rows))


# ── API: meetings ────────────────────────────────────────────────────────────

@app.route('/api/meetings', methods=['GET'])
def api_list_meetings():
    rows = query('SELECT * FROM meetings ORDER BY meeting_date DESC')
    return jsonify(as_list(rows))


# ── API: dashboard ───────────────────────────────────────────────────────────

@app.route('/api/dashboard', methods=['GET'])
def api_dashboard():
    total  = query('SELECT COUNT(*) AS n FROM contacts', one=True)['n']
    open_  = query(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(value),0) AS total FROM deals "
        "WHERE stage IN ('lead','qualified','proposal')",
        one=True
    )
    recent = query(
        'SELECT i.*, c.first_name, c.last_name FROM interactions i '
        'JOIN contacts c ON c.id=i.contact_id '
        'ORDER BY i.interaction_date DESC, i.created_at DESC LIMIT 10'
    )
    return jsonify({
        'total_contacts':    total,
        'open_deals_count':  open_['cnt'],
        'open_deals_value':  open_['total'],
        'recent_interactions': as_list(recent)
    })


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    if not os.path.exists(DB_PATH):
        init_db()
    migrate_db()
    threading.Timer(1.2, lambda: webbrowser.open('http://localhost:5000/')).start()
    app.run(debug=False, port=5000, host='127.0.0.1')
