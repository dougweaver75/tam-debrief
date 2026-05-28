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
    data = request.get_json(force=True)
    ts   = now_iso()
    cur  = execute(
        'INSERT INTO contacts (first_name,last_name,company,title,email,phone,notes,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?)',
        (data['first_name'], data['last_name'],
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
    data = request.get_json(force=True)
    execute(
        'UPDATE contacts SET first_name=?,last_name=?,company=?,title=?,email=?,phone=?,notes=?,updated_at=? WHERE id=?',
        (data['first_name'], data['last_name'],
         data.get('company',''), data.get('title',''),
         data.get('email',''),   data.get('phone',''),
         data.get('notes',''),   now_iso(), cid)
    )
    row = query('SELECT * FROM contacts WHERE id=?', (cid,), one=True)
    return (jsonify({'error': 'Not found'}), 404) if not row else (jsonify(as_dict(row)), 200)


@app.route('/api/contacts/<int:cid>', methods=['DELETE'])
def api_delete_contact(cid):
    execute('DELETE FROM contacts WHERE id=?', (cid,))
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
    data = request.get_json(force=True)
    cur  = execute(
        'INSERT INTO interactions (contact_id,type,summary,interaction_date,created_at) VALUES (?,?,?,?,?)',
        (data['contact_id'], data['type'], data['summary'], data['interaction_date'], now_iso())
    )
    return jsonify(as_dict(query('SELECT * FROM interactions WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/interactions/<int:iid>', methods=['DELETE'])
def api_delete_interaction(iid):
    execute('DELETE FROM interactions WHERE id=?', (iid,))
    return jsonify({'ok': True})


# ── API: deals ───────────────────────────────────────────────────────────────

@app.route('/api/contacts/<int:cid>/deals', methods=['GET'])
def api_list_deals(cid):
    rows = query('SELECT * FROM deals WHERE contact_id=? ORDER BY created_at DESC', (cid,))
    return jsonify(as_list(rows))


@app.route('/api/deals', methods=['POST'])
def api_create_deal():
    data = request.get_json(force=True)
    ts   = now_iso()
    cur  = execute(
        'INSERT INTO deals (contact_id,title,value,stage,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        (data['contact_id'], data['title'],
         float(data.get('value', 0)), data.get('stage', 'lead'),
         data.get('notes', ''), ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM deals WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/deals/<int:did>', methods=['PUT'])
def api_update_deal(did):
    data = request.get_json(force=True)
    execute(
        'UPDATE deals SET title=?,value=?,stage=?,notes=?,updated_at=? WHERE id=?',
        (data['title'], float(data.get('value', 0)),
         data.get('stage', 'lead'), data.get('notes', ''), now_iso(), did)
    )
    row = query('SELECT * FROM deals WHERE id=?', (did,), one=True)
    return (jsonify({'error': 'Not found'}), 404) if not row else (jsonify(as_dict(row)), 200)


@app.route('/api/deals/<int:did>', methods=['DELETE'])
def api_delete_deal(did):
    execute('DELETE FROM deals WHERE id=?', (did,))
    return jsonify({'ok': True})


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
    threading.Timer(1.2, lambda: webbrowser.open('http://localhost:5000/')).start()
    app.run(debug=False, port=5000)
