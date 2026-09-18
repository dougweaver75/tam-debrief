# Company Notes, Timeline, and Interaction Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a timestamped notes log and a merged activity timeline to each company (plus a dashboard-level recent-activity/upcoming feed), and add the missing edit action for interactions.

**Architecture:** Two new SQLite tables (`company_notes`, `timeline_events`) follow the existing raw-`sqlite3` pattern in `app.py`. A per-company "timeline" is computed by querying the four relevant tables independently and merging in Python (avoids a fragile 4-way SQL UNION across differently-shaped rows). The dashboard gets the same merge treatment at the all-companies scope. Frontend follows the codebase's existing Add/Edit-modal convention (one shared modal per entity, `openAdd*`/`openEdit*` functions, a single `submit*` that POSTs or PUTs based on a hidden id field) rather than introducing a new inline-edit-in-place pattern.

**Tech Stack:** Flask + raw `sqlite3`, Jinja2 templates, vanilla JS (`static/app.js`), pytest + Flask test client.

## Global Constraints

- No ORM — raw `sqlite3` only, matching `ccrm/CLAUDE.md`.
- `migrate_db()` already runs `schema.sql` via `executescript` on every startup, so new tables only need `CREATE TABLE IF NOT EXISTS` in `schema.sql` — no explicit Python migration code for new tables. New *columns* on existing tables still need a guarded `ALTER TABLE` in `migrate_db()`.
- Timeline event categories are exactly: `milestone`, `renewal`, `go-live`, `risk`, `other` (spec: [2026-09-18-company-notes-and-timeline-design.md](../specs/2026-09-18-company-notes-and-timeline-design.md)).
- Follow the existing shared-modal Add/Edit convention already used for action items (`openAddActionItem`/`openEditActionItem`/`submitActionItem` in `static/app.js:988-1032`), not a new inline-edit-in-place widget.

---

### Task 1: Schema — new tables and `interactions.updated_at`

**Files:**
- Modify: `schema.sql`
- Modify: `app.py:57-78` (`migrate_db`)
- Test: `tests/test_api.py`

**Interfaces:**
- Produces: tables `company_notes(id, company_id, body, created_at, updated_at)` and `timeline_events(id, company_id, category, title, description, event_date, created_at, updated_at)`; column `interactions.updated_at`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_api.py` (top-level, alongside the other tests):

```python
def test_new_tables_and_columns_exist(client):
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'company_notes' in tables
    assert 'timeline_events' in tables
    cols = {r[1] for r in conn.execute("PRAGMA table_info(interactions)")}
    assert 'updated_at' in cols
    conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_api.py::test_new_tables_and_columns_exist -v`
Expected: FAIL (`AssertionError`, `company_notes` not in tables) — the tables don't exist yet.

- [ ] **Step 3: Add the new tables and column**

In `schema.sql`, add `updated_at TEXT` to the existing `interactions` table definition:

```sql
CREATE TABLE IF NOT EXISTS interactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type             TEXT    NOT NULL CHECK(type IN ('call','email','meeting','note')),
    summary          TEXT    NOT NULL,
    interaction_date TEXT    NOT NULL,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT
);
```

Then append two new tables at the end of `schema.sql` (after the existing `action_items` table):

```sql

CREATE TABLE IF NOT EXISTS company_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category    TEXT    NOT NULL DEFAULT 'other'
                CHECK(category IN ('milestone','renewal','go-live','risk','other')),
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    event_date  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);
```

In `app.py`, add a guarded migration for the new `interactions.updated_at` column, following the existing pattern in `migrate_db()` (`app.py:57-78`). Add this right after the existing `cols_co` block (before `db.commit()`):

```python
    cols_int = {r[1] for r in db.execute("PRAGMA table_info(interactions)")}
    if 'updated_at' not in cols_int:
        db.execute("ALTER TABLE interactions ADD COLUMN updated_at TEXT")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_api.py::test_new_tables_and_columns_exist -v`
Expected: PASS

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `python -m pytest tests/ -v`
Expected: all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: add company_notes and timeline_events tables, interactions.updated_at"
```

---

### Task 2: Backend — company notes CRUD API

**Files:**
- Modify: `app.py` (insert new "API: company notes" section right after `api_company_action_items`, i.e. after `app.py:382`, before the `# ── API: meetings` comment)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `company_notes` table (Task 1).
- Produces: `GET/POST /api/companies/<coid>/notes`, `PUT/DELETE /api/notes/<nid>`. A note JSON object has keys `id, company_id, body, created_at, updated_at`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_api.py`:

```python
def _make_company(client, name='Acme Corp'):
    r = client.post('/api/companies', json={'name': name})
    return r.get_json()['id']

def test_company_notes_crud(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/notes', json={'body': 'First note'})
    assert r.status_code == 201
    note = r.get_json()
    assert note['body'] == 'First note'
    nid = note['id']

    r2 = client.post(f'/api/companies/{coid}/notes', json={'body': 'Second note'})
    nid2 = r2.get_json()['id']

    r3 = client.get(f'/api/companies/{coid}/notes')
    data = r3.get_json()
    assert len(data) == 2
    assert data[0]['id'] == nid2  # newest first

    r4 = client.put(f'/api/notes/{nid}', json={'body': 'Updated note'})
    assert r4.status_code == 200
    assert r4.get_json()['body'] == 'Updated note'

    r5 = client.delete(f'/api/notes/{nid2}')
    assert r5.status_code == 200
    r6 = client.get(f'/api/companies/{coid}/notes')
    assert len(r6.get_json()) == 1

def test_company_note_body_required(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/notes', json={'body': '   '})
    assert r.status_code == 400

def test_company_note_company_not_found(client):
    r = client.post('/api/companies/999/notes', json={'body': 'x'})
    assert r.status_code == 404
    r2 = client.get('/api/companies/999/notes')
    assert r2.status_code == 404

def test_note_update_and_delete_not_found(client):
    assert client.put('/api/notes/999', json={'body': 'x'}).status_code == 404
    assert client.delete('/api/notes/999').status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k company_note -v`
Expected: FAIL with 404s (routes don't exist yet — Flask returns 404 for unknown routes, so `test_company_notes_crud`'s first `assert r.status_code == 201` fails)

- [ ] **Step 3: Implement the routes**

In `app.py`, insert after `api_company_action_items` (`app.py:370-382`) and before the `# ── API: meetings` section comment:

```python
# ── API: company notes ───────────────────────────────────────────────────────

@app.route('/api/companies/<int:coid>/notes', methods=['GET'])
def api_list_company_notes(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    rows = query(
        'SELECT * FROM company_notes WHERE company_id=? ORDER BY created_at DESC, id DESC',
        (coid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/companies/<int:coid>/notes', methods=['POST'])
def api_create_company_note(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    body = data.get('body', '').strip()
    if not body:
        return jsonify({'error': 'body is required'}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO company_notes (company_id,body,created_at,updated_at) VALUES (?,?,?,?)',
        (coid, body, ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM company_notes WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/notes/<int:nid>', methods=['PUT'])
def api_update_company_note(nid):
    if not query('SELECT id FROM company_notes WHERE id=?', (nid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    body = data.get('body', '').strip()
    if not body:
        return jsonify({'error': 'body is required'}), 400
    execute('UPDATE company_notes SET body=?,updated_at=? WHERE id=?', (body, now_iso(), nid))
    return jsonify(as_dict(query('SELECT * FROM company_notes WHERE id=?', (nid,), one=True)))


@app.route('/api/notes/<int:nid>', methods=['DELETE'])
def api_delete_company_note(nid):
    cur = execute('DELETE FROM company_notes WHERE id=?', (nid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -k "company_note or notes" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: add company notes CRUD API"
```

---

### Task 3: Backend — timeline events CRUD API

**Files:**
- Modify: `app.py` (insert new "API: timeline events" section right after the company notes section added in Task 2)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `timeline_events` table (Task 1), `_make_company` helper (Task 2).
- Produces: `POST /api/companies/<coid>/timeline_events`, `PUT/DELETE /api/timeline_events/<eid>`; module-level tuple `TIMELINE_CATEGORIES = ('milestone','renewal','go-live','risk','other')`. A timeline event JSON object has keys `id, company_id, category, title, description, event_date, created_at, updated_at`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_api.py`:

```python
def test_timeline_events_crud(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'renewal', 'title': 'Contract renewed',
        'description': 'Renewed for 1yr', 'event_date': '2026-06-01'
    })
    assert r.status_code == 201
    ev = r.get_json()
    assert ev['category'] == 'renewal'
    eid = ev['id']

    r_upd = client.put(f'/api/timeline_events/{eid}', json={
        'category': 'milestone', 'title': 'Contract renewed (updated)',
        'description': '', 'event_date': '2026-06-02'
    })
    assert r_upd.status_code == 200
    assert r_upd.get_json()['category'] == 'milestone'
    assert r_upd.get_json()['event_date'] == '2026-06-02'

    r_del = client.delete(f'/api/timeline_events/{eid}')
    assert r_del.status_code == 200
    r_del2 = client.delete(f'/api/timeline_events/{eid}')
    assert r_del2.status_code == 404

def test_timeline_event_invalid_category_rejected(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'bogus', 'title': 'Bad', 'event_date': '2026-06-01'
    })
    assert r.status_code == 400

def test_timeline_event_defaults_category_other(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'title': 'Untyped', 'event_date': '2026-06-01'
    })
    assert r.status_code == 201
    assert r.get_json()['category'] == 'other'

def test_timeline_event_requires_title_and_date(client):
    coid = _make_company(client)
    assert client.post(f'/api/companies/{coid}/timeline_events', json={'event_date': '2026-06-01'}).status_code == 400
    assert client.post(f'/api/companies/{coid}/timeline_events', json={'title': 'X'}).status_code == 400

def test_timeline_event_company_not_found(client):
    r = client.post('/api/companies/999/timeline_events', json={'title': 'X', 'event_date': '2026-06-01'})
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k timeline_event -v`
Expected: FAIL (404 — routes don't exist yet)

- [ ] **Step 3: Implement the routes**

In `app.py`, insert after the company notes section (Task 2) and before `# ── API: meetings`:

```python
# ── API: timeline events ─────────────────────────────────────────────────────

TIMELINE_CATEGORIES = ('milestone', 'renewal', 'go-live', 'risk', 'other')

@app.route('/api/companies/<int:coid>/timeline_events', methods=['POST'])
def api_create_timeline_event(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data     = request.get_json(force=True) or {}
    title    = data.get('title', '').strip()
    edate    = (data.get('event_date') or '').strip()
    category = data.get('category') or 'other'
    if not title or not edate:
        return jsonify({'error': 'title and event_date are required'}), 400
    if category not in TIMELINE_CATEGORIES:
        return jsonify({'error': 'category must be one of ' + ', '.join(TIMELINE_CATEGORIES)}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO timeline_events (company_id,category,title,description,event_date,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?)',
        (coid, category, title, data.get('description', ''), edate, ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM timeline_events WHERE id=?', (cur.lastrowid,), one=True))), 201


@app.route('/api/timeline_events/<int:eid>', methods=['PUT'])
def api_update_timeline_event(eid):
    if not query('SELECT id FROM timeline_events WHERE id=?', (eid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data     = request.get_json(force=True) or {}
    title    = data.get('title', '').strip()
    edate    = (data.get('event_date') or '').strip()
    category = data.get('category') or 'other'
    if not title or not edate:
        return jsonify({'error': 'title and event_date are required'}), 400
    if category not in TIMELINE_CATEGORIES:
        return jsonify({'error': 'category must be one of ' + ', '.join(TIMELINE_CATEGORIES)}), 400
    execute(
        'UPDATE timeline_events SET category=?,title=?,description=?,event_date=?,updated_at=? WHERE id=?',
        (category, title, data.get('description', ''), edate, now_iso(), eid)
    )
    return jsonify(as_dict(query('SELECT * FROM timeline_events WHERE id=?', (eid,), one=True)))


@app.route('/api/timeline_events/<int:eid>', methods=['DELETE'])
def api_delete_timeline_event(eid):
    cur = execute('DELETE FROM timeline_events WHERE id=?', (eid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -k timeline_event -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: add timeline events CRUD API"
```

---

### Task 4: Backend — merged per-company timeline endpoint

**Files:**
- Modify: `app.py` (insert after the timeline events section from Task 3, before `# ── API: meetings`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `meetings`, `action_items`, `company_notes`, `timeline_events` tables; `_make_company` and `_make_meeting` test helpers.
- Produces: `GET /api/companies/<coid>/timeline` → JSON array of `{source, id, date, category, title, detail, link}`, sorted by `date` descending. `source` is one of `meeting`, `action_item`, `note`, `event`. `category` is `null` except for `source == 'event'`. `link` is `null` for `note` and `event` sources.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_api.py`:

```python
def test_company_timeline_merges_sources(client):
    coid = _make_company(client)
    r_m = client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Send SOW', 'due_date': '2026-06-02'})
    client.post(f'/api/companies/{coid}/notes', json={'body': 'Called to check in'})
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'go-live', 'title': 'Go live', 'event_date': '2026-06-03'
    })

    r = client.get(f'/api/companies/{coid}/timeline')
    assert r.status_code == 200
    items = r.get_json()
    assert {i['source'] for i in items} == {'meeting', 'action_item', 'note', 'event'}
    dates = [i['date'] for i in items]
    assert dates == sorted(dates, reverse=True)
    event_item = next(i for i in items if i['source'] == 'event')
    assert event_item['category'] == 'go-live'
    meeting_item = next(i for i in items if i['source'] == 'meeting')
    assert meeting_item['link'] == f'/meetings/{mid}'
    note_item = next(i for i in items if i['source'] == 'note')
    assert note_item['link'] is None

def test_company_timeline_excludes_action_items_without_due_date(client):
    coid = _make_company(client)
    r_m = client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'No due date'})
    items = client.get(f'/api/companies/{coid}/timeline').get_json()
    assert not any(i['source'] == 'action_item' for i in items)

def test_company_timeline_not_found(client):
    r = client.get('/api/companies/999/timeline')
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k company_timeline -v`
Expected: FAIL (404 — route doesn't exist yet)

- [ ] **Step 3: Implement the route**

In `app.py`, insert after the timeline events section (Task 3):

```python
# ── API: company timeline (merged) ───────────────────────────────────────────

@app.route('/api/companies/<int:coid>/timeline', methods=['GET'])
def api_company_timeline(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404

    meetings = query('SELECT id, title, meeting_date FROM meetings WHERE company_id=?', (coid,))
    action_items = query(
        'SELECT ai.id, ai.description, ai.due_date, m.id AS meeting_id '
        'FROM action_items ai JOIN meetings m ON m.id=ai.meeting_id '
        'WHERE m.company_id=? AND ai.due_date IS NOT NULL',
        (coid,)
    )
    notes  = query('SELECT id, body, created_at FROM company_notes WHERE company_id=?', (coid,))
    events = query(
        'SELECT id, category, title, description, event_date FROM timeline_events WHERE company_id=?',
        (coid,)
    )

    items = []
    for m in meetings:
        items.append({
            'source': 'meeting', 'id': m['id'], 'date': m['meeting_date'], 'category': None,
            'title': m['title'], 'detail': '', 'link': f"/meetings/{m['id']}"
        })
    for a in action_items:
        items.append({
            'source': 'action_item', 'id': a['id'], 'date': a['due_date'], 'category': None,
            'title': a['description'], 'detail': '', 'link': f"/meetings/{a['meeting_id']}"
        })
    for n in notes:
        items.append({
            'source': 'note', 'id': n['id'], 'date': n['created_at'], 'category': None,
            'title': 'Note', 'detail': n['body'], 'link': None
        })
    for e in events:
        items.append({
            'source': 'event', 'id': e['id'], 'date': e['event_date'], 'category': e['category'],
            'title': e['title'], 'detail': e['description'] or '', 'link': None
        })

    items.sort(key=lambda x: x['date'], reverse=True)
    return jsonify(items)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -k company_timeline -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: add merged per-company timeline endpoint"
```

---

### Task 5: Backend — interaction update (`PUT /api/interactions/<id>`)

**Files:**
- Modify: `app.py:271-277` (insert the new route right after `api_delete_interaction`)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `interactions.updated_at` column (Task 1).
- Produces: `PUT /api/interactions/<iid>` — body `{type, summary, interaction_date}`, same validation as `POST /api/interactions` (`app.py:250-268`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_api.py`:

```python
def test_update_interaction(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={
        'contact_id': cid, 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'
    })
    iid = r.get_json()['id']
    r2 = client.put(f'/api/interactions/{iid}', json={
        'type': 'email', 'summary': 'Updated', 'interaction_date': '2026-05-29'
    })
    assert r2.status_code == 200
    d = r2.get_json()
    assert d['type'] == 'email'
    assert d['summary'] == 'Updated'
    assert d['interaction_date'] == '2026-05-29'
    assert d['updated_at'] is not None

def test_update_interaction_invalid_type(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={
        'contact_id': cid, 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'
    })
    iid = r.get_json()['id']
    r2 = client.put(f'/api/interactions/{iid}', json={
        'type': 'bogus', 'summary': 'x', 'interaction_date': '2026-05-28'
    })
    assert r2.status_code == 400

def test_update_interaction_not_found(client):
    r = client.put('/api/interactions/999', json={
        'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-28'
    })
    assert r.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k update_interaction -v`
Expected: FAIL (405 Method Not Allowed — `PUT` isn't registered for `/api/interactions/<id>` yet)

- [ ] **Step 3: Implement the route**

In `app.py`, insert right after `api_delete_interaction` (`app.py:271-276`):

```python
@app.route('/api/interactions/<int:iid>', methods=['PUT'])
def api_update_interaction(iid):
    if not query('SELECT id FROM interactions WHERE id=?', (iid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data    = request.get_json(force=True) or {}
    itype   = data.get('type', '')
    summary = data.get('summary', '').strip()
    idate   = data.get('interaction_date', '')
    if not summary or not idate:
        return jsonify({'error': 'summary and interaction_date are required'}), 400
    if itype not in ('call', 'email', 'meeting', 'note'):
        return jsonify({'error': 'type must be call, email, meeting, or note'}), 400
    execute(
        'UPDATE interactions SET type=?,summary=?,interaction_date=?,updated_at=? WHERE id=?',
        (itype, summary, idate, now_iso(), iid)
    )
    return jsonify(as_dict(query('SELECT * FROM interactions WHERE id=?', (iid,), one=True)))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -k update_interaction -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: add interaction update API"
```

---

### Task 6: Backend — dashboard `recent_activity` and `upcoming`

**Files:**
- Modify: `app.py:533-567` (`api_dashboard`)
- Modify: `tests/test_api.py` (add `from datetime import timedelta` to the existing `datetime`-less import block — see Step 1)
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `meetings`, `action_items`, `timeline_events`, `companies` tables.
- Produces: `GET /api/dashboard` response gains two keys: `recent_activity` (list, max 15, newest-first, each `{source, date, company_id, company_name, title, category, link}`) and `upcoming` (list, max 20, soonest-first, same shape). Existing keys (`total_contacts`, `total_meetings`, `open_action_items`, `recent_interactions`, `action_items`, `companies`) are unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/test_api.py` currently has no `datetime` import. Add one at the top of the file (after the existing `import pytest`):

```python
from datetime import datetime, timedelta
```

Then add:

```python
def test_dashboard_recent_activity_and_upcoming(client):
    coid = _make_company(client)
    today     = datetime.utcnow().date()
    yesterday = (today - timedelta(days=1)).isoformat()
    tomorrow  = (today + timedelta(days=1)).isoformat()

    client.post('/api/meetings', json={'title': 'Past Meeting', 'meeting_date': yesterday, 'company_id': coid})
    client.post('/api/meetings', json={'title': 'Future Meeting', 'meeting_date': tomorrow, 'company_id': coid})
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'go-live', 'title': 'Past event', 'event_date': yesterday
    })
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'renewal', 'title': 'Future event', 'event_date': tomorrow
    })

    d = client.get('/api/dashboard').get_json()
    assert 'recent_activity' in d
    assert 'upcoming' in d

    recent_titles = {i['title'] for i in d['recent_activity']}
    assert 'Past Meeting' in recent_titles
    assert 'Past event' in recent_titles
    assert 'Future Meeting' not in recent_titles
    assert 'Future event' not in recent_titles

    upcoming_titles = {i['title'] for i in d['upcoming']}
    assert 'Future Meeting' in upcoming_titles
    assert 'Future event' in upcoming_titles
    assert 'Past Meeting' not in upcoming_titles
    assert 'Past event' not in upcoming_titles

def test_dashboard_upcoming_includes_open_action_items(client):
    coid = _make_company(client)
    tomorrow = (datetime.utcnow().date() + timedelta(days=1)).isoformat()
    r_m = client.post('/api/meetings', json={'title': 'M', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Follow up', 'due_date': tomorrow})
    d = client.get('/api/dashboard').get_json()
    assert any(i['title'] == 'Follow up' for i in d['upcoming'])

def test_dashboard_recent_activity_capped_at_15(client):
    coid = _make_company(client)
    for i in range(20):
        client.post(f'/api/companies/{coid}/timeline_events', json={
            'category': 'other', 'title': f'Event {i}', 'event_date': f'2020-01-{(i % 28) + 1:02d}'
        })
    d = client.get('/api/dashboard').get_json()
    assert len(d['recent_activity']) == 15
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k dashboard_recent_activity -v`
Expected: FAIL (`KeyError: 'recent_activity'`)

- [ ] **Step 3: Implement the dashboard changes**

Replace `api_dashboard` in `app.py:533-567` with:

```python
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
    companies = query(
        'SELECT co.id, co.name, co.logo, '
        '(SELECT COUNT(*) FROM contacts WHERE company_id=co.id) AS contact_count, '
        '(SELECT COUNT(*) FROM meetings  WHERE company_id=co.id) AS meeting_count '
        'FROM companies co ORDER BY co.name COLLATE NOCASE ASC'
    )

    today = datetime.utcnow().strftime('%Y-%m-%d')

    recent_meetings = query(
        'SELECT m.id, m.title, m.meeting_date AS date, co.id AS company_id, co.name AS company_name '
        'FROM meetings m JOIN companies co ON co.id=m.company_id '
        'WHERE m.meeting_date <= ? ORDER BY m.meeting_date DESC LIMIT 15',
        (today,)
    )
    recent_notes = query(
        'SELECT cn.id, cn.body, cn.created_at AS date, co.id AS company_id, co.name AS company_name '
        'FROM company_notes cn JOIN companies co ON co.id=cn.company_id '
        'ORDER BY cn.created_at DESC LIMIT 15'
    )
    recent_events = query(
        'SELECT te.id, te.category, te.title, te.event_date AS date, '
        'co.id AS company_id, co.name AS company_name '
        'FROM timeline_events te JOIN companies co ON co.id=te.company_id '
        'WHERE te.event_date <= ? ORDER BY te.event_date DESC LIMIT 15',
        (today,)
    )
    recent_activity = []
    for m in recent_meetings:
        recent_activity.append({
            'source': 'meeting', 'date': m['date'], 'company_id': m['company_id'],
            'company_name': m['company_name'], 'title': m['title'], 'category': None,
            'link': f"/companies/{m['company_id']}"
        })
    for n in recent_notes:
        recent_activity.append({
            'source': 'note', 'date': n['date'], 'company_id': n['company_id'],
            'company_name': n['company_name'], 'title': n['body'], 'category': None,
            'link': f"/companies/{n['company_id']}"
        })
    for e in recent_events:
        recent_activity.append({
            'source': 'event', 'date': e['date'], 'company_id': e['company_id'],
            'company_name': e['company_name'], 'title': e['title'], 'category': e['category'],
            'link': f"/companies/{e['company_id']}"
        })
    recent_activity.sort(key=lambda x: x['date'], reverse=True)
    recent_activity = recent_activity[:15]

    upcoming_meetings = query(
        'SELECT m.id, m.title, m.meeting_date AS date, co.id AS company_id, co.name AS company_name '
        'FROM meetings m JOIN companies co ON co.id=m.company_id '
        'WHERE m.meeting_date >= ? ORDER BY m.meeting_date ASC LIMIT 20',
        (today,)
    )
    upcoming_ai = query(
        'SELECT ai.id, ai.description, ai.due_date AS date, co.id AS company_id, co.name AS company_name '
        'FROM action_items ai JOIN meetings m ON m.id=ai.meeting_id '
        'JOIN companies co ON co.id=m.company_id '
        'WHERE ai.completed=0 AND ai.due_date >= ? ORDER BY ai.due_date ASC LIMIT 20',
        (today,)
    )
    upcoming_events = query(
        'SELECT te.id, te.category, te.title, te.event_date AS date, '
        'co.id AS company_id, co.name AS company_name '
        'FROM timeline_events te JOIN companies co ON co.id=te.company_id '
        'WHERE te.event_date >= ? ORDER BY te.event_date ASC LIMIT 20',
        (today,)
    )
    upcoming = []
    for m in upcoming_meetings:
        upcoming.append({
            'source': 'meeting', 'date': m['date'], 'company_id': m['company_id'],
            'company_name': m['company_name'], 'title': m['title'], 'category': None,
            'link': f"/companies/{m['company_id']}"
        })
    for a in upcoming_ai:
        upcoming.append({
            'source': 'action_item', 'date': a['date'], 'company_id': a['company_id'],
            'company_name': a['company_name'], 'title': a['description'], 'category': None,
            'link': f"/companies/{a['company_id']}"
        })
    for e in upcoming_events:
        upcoming.append({
            'source': 'event', 'date': e['date'], 'company_id': e['company_id'],
            'company_name': e['company_name'], 'title': e['title'], 'category': e['category'],
            'link': f"/companies/{e['company_id']}"
        })
    upcoming.sort(key=lambda x: x['date'])
    upcoming = upcoming[:20]

    return jsonify({
        'total_contacts':       total,
        'total_meetings':       meetings,
        'open_action_items':    open_ai,
        'recent_interactions':  as_list(recent),
        'action_items':         as_list(action_items),
        'companies':            as_list(companies),
        'recent_activity':      recent_activity,
        'upcoming':             upcoming,
    })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_api.py -v`
Expected: all PASS, including the new dashboard tests

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat: add recent_activity and upcoming feeds to dashboard API"
```

---

### Task 7: Frontend — company notes section

**Files:**
- Modify: `templates/company.html`
- Modify: `static/app.js` (Company Detail section, `static/app.js:1156-1352`)

**Interfaces:**
- Consumes: `GET/POST /api/companies/<id>/notes`, `PUT/DELETE /api/notes/<id>` (Task 2); `_currentCompany` (`static/app.js:1158`); `openModal`/`closeModal`/`confirmDelete`/`esc`/`fmtDate`/`icon`/`showToast`/`API` (`static/app.js:1-148`).
- Produces: `timeAgo(iso)` utility function (module scope, near `fmtDate` at `static/app.js:127-131`) — used again by Task 8 and Task 10. `renderCompanyNotes(notes)`, `openAddCompanyNote()`, `openEditCompanyNote(id)`, `submitCompanyNote(e)`, `deleteCompanyNote(id)`.

- [ ] **Step 1: Add the Notes section and modal to the template**

In `templates/company.html`, insert a new section right after the `companyDetailRoot` div (before `companyContactsSection`, currently at line 8):

```html
<div id="companyNotesSection" style="display:none">
  <div class="card">
    <div class="section-header">
      <div class="card-title" style="margin:0">Notes</div>
      <button class="btn btn-primary btn-sm" onclick="openAddCompanyNote()">+ Add Note</button>
    </div>
    <div id="companyNotesList"></div>
  </div>
</div>
```

Add the Note modal right before `{% endblock %}` (after the existing `companyModal` closing `</div>`, currently line 56):

```html
<!-- Company Note Modal -->
<div class="modal" id="companyNoteModal">
  <div class="modal-title" id="companyNoteModalTitle">Add Note</div>
  <form id="companyNoteForm" onsubmit="submitCompanyNote(event)">
    <input type="hidden" id="cnId">
    <div class="form-row"><label>Note *</label><textarea id="cnBody" required></textarea></div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
    </div>
  </form>
</div>
```

In the `{% block scripts %}` at the bottom of `templates/company.html`, add a line to reveal the new section:

```html
<script>
  initCompanyDetail({{ company_id }});
  document.getElementById('companyNotesSection').style.display = '';
  document.getElementById('companyContactsSection').style.display = '';
  document.getElementById('companyMeetingsSection').style.display = '';
  document.getElementById('companyActionItemsSection').style.display = '';
</script>
```

- [ ] **Step 2: Add the `timeAgo` utility**

In `static/app.js`, right after `fmtDate` (`static/app.js:127-131`), add:

```js
function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  const secs = Math.floor((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
```

- [ ] **Step 3: Add rendering and CRUD functions**

In `static/app.js`, add a new subsection right after `deleteCompanyDetail` (`static/app.js:1344-1351`), before the `// ── Dashboard` comment:

```js
// ── Company Notes ─────────────────────────────────────────────────────────

function renderCompanyNotes(notes) {
  const el = document.getElementById('companyNotesList');
  if (!el) return;
  if (!notes.length) { el.innerHTML = '<p class="empty-state">No notes yet.</p>'; return; }
  el.innerHTML = notes.map(n => `
    <div class="interaction-item">
      <div style="flex:1">
        <div class="interaction-date" title="${fmtDate(n.created_at)}">${timeAgo(n.created_at)}</div>
        <div class="interaction-summary" style="white-space:pre-wrap">${esc(n.body)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditCompanyNote(${n.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteCompanyNote(${n.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>
  `).join('');
}

function openAddCompanyNote() {
  document.getElementById('companyNoteModalTitle').textContent = 'Add Note';
  document.getElementById('cnId').value = '';
  document.getElementById('companyNoteForm').reset();
  openModal('companyNoteModal');
}

async function openEditCompanyNote(id) {
  try {
    const notes = await API.get(`/api/companies/${_currentCompany.id}/notes`);
    const n = notes.find(x => x.id === id);
    if (!n) return;
    document.getElementById('companyNoteModalTitle').textContent = 'Edit Note';
    document.getElementById('cnId').value = n.id;
    document.getElementById('cnBody').value = n.body;
    openModal('companyNoteModal');
  } catch (e) { showToast('Failed to load note.'); }
}

async function submitCompanyNote(e) {
  e.preventDefault();
  const id   = document.getElementById('cnId').value;
  const body = document.getElementById('cnBody').value.trim();
  try {
    if (id) {
      await API.put(`/api/notes/${id}`, { body });
      showToast('Note updated.');
    } else {
      await API.post(`/api/companies/${_currentCompany.id}/notes`, { body });
      showToast('Note added.');
    }
    closeModal();
    const notes = await API.get(`/api/companies/${_currentCompany.id}/notes`);
    renderCompanyNotes(notes);
  } catch (e) { showToast('Save failed.'); }
}

function deleteCompanyNote(id) {
  confirmDelete('Delete this note?', async () => {
    try {
      await API.del(`/api/notes/${id}`);
      showToast('Note deleted.');
      const notes = await API.get(`/api/companies/${_currentCompany.id}/notes`);
      renderCompanyNotes(notes);
    } catch (e) { showToast('Delete failed.'); }
  });
}
```

- [ ] **Step 4: Wire notes into `loadCompanyDetail`**

In `static/app.js`, update `loadCompanyDetail` (`static/app.js:1199-1216`) to also fetch and render notes:

```js
async function loadCompanyDetail(companyId) {
  try {
    const [company, contacts, meetings, actionItems, notes] = await Promise.all([
      API.get(`/api/companies/${companyId}`),
      API.get(`/api/companies/${companyId}/contacts`),
      API.get(`/api/companies/${companyId}/meetings`),
      API.get(`/api/companies/${companyId}/action-items`),
      API.get(`/api/companies/${companyId}/notes`)
    ]);
    _currentCompany = company;
    renderCompanyDetail(company);
    renderCompanyContacts(contacts);
    renderCompanyMeetings(meetings);
    renderCompanyActionItems(actionItems);
    renderCompanyNotes(notes);
  } catch (e) {
    document.getElementById('companyDetailRoot').innerHTML =
      '<p class="empty-state">Company not found.</p>';
  }
}
```

- [ ] **Step 5: Manual verification**

Run: `python app.py`

1. Navigate to a company detail page.
2. Click "+ Add Note", type text, Save → note appears at the top of the list with a relative timestamp.
3. Add a second note → it appears above the first.
4. Click Edit on a note, change the text, Save → updated text shows, order unchanged.
5. Click Delete on a note, confirm → note disappears.
6. Reload the page → notes persist in the same order.

Expected: all steps behave as described, no console errors (check via browser devtools or just visually).

- [ ] **Step 6: Commit**

```bash
git add templates/company.html static/app.js
git commit -m "feat: add company notes UI"
```

---

### Task 8: Frontend — company timeline section

**Files:**
- Modify: `templates/company.html`
- Modify: `static/app.js` (Company Detail section)
- Modify: `static/style.css` (badge colors)

**Interfaces:**
- Consumes: `GET /api/companies/<id>/timeline`, `POST /api/companies/<id>/timeline_events`, `PUT/DELETE /api/timeline_events/<id>` (Tasks 3–4); `timeAgo`/`fmtDate`/`badgeHtml`/`esc`/`icon`/`API`/`openModal`/`closeModal`/`confirmDelete`/`showToast`/`_currentCompany` (Task 7 and earlier).
- Produces: `TIMELINE_CATEGORY_LABELS`, `TIMELINE_SOURCE_LABELS` (module scope, near `TYPE_LABELS` at `static/app.js:188`) — consumed again by Task 10. `renderCompanyTimeline(items)`, `openAddTimelineEvent()`, `openEditTimelineEvent(id)`, `submitTimelineEvent(e)`, `deleteTimelineEvent(id)`.

- [ ] **Step 1: Add badge CSS for timeline categories and the action-item source**

In `static/style.css`, right after the existing interaction badges (`static/style.css:374-377`):

```css
.badge-action_item { background: #fef3c7; color: #b45309; }

.badge-milestone { background: #ede9fe; color: #6d28d9; }
.badge-renewal   { background: #dcfce7; color: #166534; }
.badge-go-live   { background: #dbeafe; color: #1d4ed8; }
.badge-risk      { background: #fee2e2; color: #991b1b; }
.badge-other     { background: #f1f5f9; color: var(--text-muted); }
```

- [ ] **Step 2: Add the Timeline section and modal to the template**

In `templates/company.html`, insert right after the `companyNotesSection` div added in Task 7:

```html
<div id="companyTimelineSection" style="display:none">
  <div class="card">
    <div class="section-header">
      <div class="card-title" style="margin:0">Timeline</div>
      <button class="btn btn-primary btn-sm" onclick="openAddTimelineEvent()">+ Add Event</button>
    </div>
    <div id="companyTimelineList"></div>
  </div>
</div>
```

Add the Timeline Event modal right after the `companyNoteModal` added in Task 7:

```html
<!-- Timeline Event Modal -->
<div class="modal" id="timelineEventModal">
  <div class="modal-title" id="timelineEventModalTitle">Add Event</div>
  <form id="timelineEventForm" onsubmit="submitTimelineEvent(event)">
    <input type="hidden" id="teId">
    <div class="form-row-2">
      <div class="form-row">
        <label>Category</label>
        <select id="teCategory">
          <option value="milestone">Milestone</option>
          <option value="renewal">Renewal</option>
          <option value="go-live">Go Live</option>
          <option value="risk">Risk</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-row"><label>Date *</label><input type="date" id="teDate" required></div>
    </div>
    <div class="form-row"><label>Title *</label><input type="text" id="teTitle" required></div>
    <div class="form-row"><label>Description</label><textarea id="teDescription"></textarea></div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
    </div>
  </form>
</div>
```

Update `{% block scripts %}` to reveal the new section:

```html
<script>
  initCompanyDetail({{ company_id }});
  document.getElementById('companyNotesSection').style.display = '';
  document.getElementById('companyTimelineSection').style.display = '';
  document.getElementById('companyContactsSection').style.display = '';
  document.getElementById('companyMeetingsSection').style.display = '';
  document.getElementById('companyActionItemsSection').style.display = '';
</script>
```

- [ ] **Step 3: Add category/source labels**

In `static/app.js`, right after `const TYPE_LABELS = ...` (`static/app.js:188`):

```js
const TIMELINE_CATEGORY_LABELS = { milestone: 'Milestone', renewal: 'Renewal', 'go-live': 'Go Live', risk: 'Risk', other: 'Other' };
const TIMELINE_SOURCE_LABELS   = { meeting: 'Meeting', action_item: 'Action Item', note: 'Note' };
```

- [ ] **Step 4: Add rendering and CRUD functions**

In `static/app.js`, add a new subsection right after the company notes functions added in Task 7 (before `// ── Dashboard`):

```js
// ── Company Timeline ─────────────────────────────────────────────────────

function renderCompanyTimeline(items) {
  const el = document.getElementById('companyTimelineList');
  if (!el) return;
  if (!items.length) { el.innerHTML = '<p class="empty-state">Nothing on the timeline yet.</p>'; return; }
  el.innerHTML = items.map(i => {
    const badge = i.category
      ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
      : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source);
    const titleHtml = i.link
      ? `<a href="${i.link}" class="table-link">${esc(i.title)}</a>`
      : esc(i.title);
    const actions = i.source === 'event'
      ? `<div style="display:flex;gap:6px">
           <button class="btn btn-secondary btn-sm" onclick="openEditTimelineEvent(${i.id})">Edit</button>
           <button class="btn btn-danger btn-sm" onclick="deleteTimelineEvent(${i.id})" title="Delete">${icon('close')}</button>
         </div>`
      : '';
    return `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badge}
          <span class="interaction-date">${fmtDate(i.date)}</span>
        </div>
        <div class="interaction-summary">${titleHtml}</div>
        ${i.detail ? `<div class="interaction-summary" style="color:var(--text-muted)">${esc(i.detail)}</div>` : ''}
      </div>
      ${actions}
    </div>`;
  }).join('');
}

function openAddTimelineEvent() {
  document.getElementById('timelineEventModalTitle').textContent = 'Add Event';
  document.getElementById('teId').value = '';
  document.getElementById('timelineEventForm').reset();
  document.getElementById('teCategory').value = 'milestone';
  document.getElementById('teDate').value = new Date().toISOString().slice(0,10);
  openModal('timelineEventModal');
}

async function openEditTimelineEvent(id) {
  try {
    const items = await API.get(`/api/companies/${_currentCompany.id}/timeline`);
    const ev = items.find(x => x.source === 'event' && x.id === id);
    if (!ev) return;
    document.getElementById('timelineEventModalTitle').textContent = 'Edit Event';
    document.getElementById('teId').value = ev.id;
    document.getElementById('teCategory').value = ev.category || 'other';
    document.getElementById('teDate').value = ev.date;
    document.getElementById('teTitle').value = ev.title;
    document.getElementById('teDescription').value = ev.detail || '';
    openModal('timelineEventModal');
  } catch (e) { showToast('Failed to load event.'); }
}

async function submitTimelineEvent(e) {
  e.preventDefault();
  const id   = document.getElementById('teId').value;
  const data = {
    category:    document.getElementById('teCategory').value,
    title:       document.getElementById('teTitle').value.trim(),
    description: document.getElementById('teDescription').value.trim(),
    event_date:  document.getElementById('teDate').value,
  };
  try {
    if (id) {
      await API.put(`/api/timeline_events/${id}`, data);
      showToast('Event updated.');
    } else {
      await API.post(`/api/companies/${_currentCompany.id}/timeline_events`, data);
      showToast('Event added.');
    }
    closeModal();
    const items = await API.get(`/api/companies/${_currentCompany.id}/timeline`);
    renderCompanyTimeline(items);
  } catch (e) { showToast('Save failed.'); }
}

function deleteTimelineEvent(id) {
  confirmDelete('Delete this event?', async () => {
    try {
      await API.del(`/api/timeline_events/${id}`);
      showToast('Event deleted.');
      const items = await API.get(`/api/companies/${_currentCompany.id}/timeline`);
      renderCompanyTimeline(items);
    } catch (e) { showToast('Delete failed.'); }
  });
}
```

- [ ] **Step 5: Wire timeline into `loadCompanyDetail`**

In `static/app.js`, update `loadCompanyDetail` again (last touched in Task 7) to also fetch and render the timeline:

```js
async function loadCompanyDetail(companyId) {
  try {
    const [company, contacts, meetings, actionItems, notes, timeline] = await Promise.all([
      API.get(`/api/companies/${companyId}`),
      API.get(`/api/companies/${companyId}/contacts`),
      API.get(`/api/companies/${companyId}/meetings`),
      API.get(`/api/companies/${companyId}/action-items`),
      API.get(`/api/companies/${companyId}/notes`),
      API.get(`/api/companies/${companyId}/timeline`)
    ]);
    _currentCompany = company;
    renderCompanyDetail(company);
    renderCompanyContacts(contacts);
    renderCompanyMeetings(meetings);
    renderCompanyActionItems(actionItems);
    renderCompanyNotes(notes);
    renderCompanyTimeline(timeline);
  } catch (e) {
    document.getElementById('companyDetailRoot').innerHTML =
      '<p class="empty-state">Company not found.</p>';
  }
}
```

- [ ] **Step 6: Manual verification**

Run: `python app.py`

1. Navigate to a company that has at least one meeting and one open action item with a due date.
2. Confirm the Timeline section shows the meeting and action item, each linking to `/meetings/<id>`.
3. Click "+ Add Event", pick each category in turn, fill title/date, Save → each appears with the correct colored badge.
4. Add a company note (Task 7) → confirm it now also shows in the Timeline with a "Note" badge.
5. Edit a timeline event, change its date → list re-sorts correctly.
6. Delete a timeline event → it disappears; the meeting/action item/note entries are unaffected.

Expected: all steps behave as described.

- [ ] **Step 7: Commit**

```bash
git add templates/company.html static/app.js static/style.css
git commit -m "feat: add company timeline UI"
```

---

### Task 9: Frontend — interaction editing on the contact page

**Files:**
- Modify: `templates/contact.html`
- Modify: `static/app.js:447-502` (Interactions section)

**Interfaces:**
- Consumes: `PUT /api/interactions/<id>` (Task 5); `_currentContact` (`static/app.js:325`).
- Produces: `openEditInteraction(id)`. `submitInteraction(e)` and `openLogInteraction()` are modified in place (same names, same call sites in `templates/contact.html`).

- [ ] **Step 1: Add a hidden id field and title id to the interaction modal**

In `templates/contact.html`, update the `interactionModal` (currently lines 73–100):

```html
<!-- Log Interaction Modal -->
<div class="modal" id="interactionModal">
  <div class="modal-title" id="interactionModalTitle">Log Interaction</div>
  <form id="interactionForm" onsubmit="submitInteraction(event)">
    <input type="hidden" id="iId">
    <div class="form-row-2">
      <div class="form-row">
        <label>Type</label>
        <select id="iType">
          <option value="call">Call</option>
          <option value="email">Email</option>
          <option value="meeting">Meeting</option>
          <option value="note">Note</option>
        </select>
      </div>
      <div class="form-row">
        <label>Date</label>
        <input type="date" id="iDate" required>
      </div>
    </div>
    <div class="form-row">
      <label>Summary *</label>
      <textarea id="iSummary" required placeholder="What happened?"></textarea>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button type="submit" class="btn btn-primary">Save</button>
    </div>
  </form>
</div>
```

(Only the `modal-title` id and the added `<input type="hidden" id="iId">` and the footer button label — "Log" → "Save" — changed from the original.)

- [ ] **Step 2: Add an Edit button to each interaction row**

In `static/app.js`, update `renderInteractions` (`static/app.js:449-468`):

```js
function renderInteractions(interactions) {
  const el = document.getElementById('interactionsList');
  if (!el) return;
  if (!interactions.length) {
    el.innerHTML = '<p class="empty-state">No interactions logged yet.</p>';
    return;
  }
  el.innerHTML = interactions.map(i => `
    <div class="interaction-item">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          ${badgeHtml(i.type, TYPE_LABELS[i.type] || i.type)}
          <span class="interaction-date">${fmtDate(i.interaction_date)}</span>
        </div>
        <div class="interaction-summary">${esc(i.summary)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditInteraction(${i.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteInteraction(${i.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>
  `).join('');
}
```

- [ ] **Step 3: Add `openEditInteraction` and update `openLogInteraction`/`submitInteraction`**

In `static/app.js`, replace `openLogInteraction` and `submitInteraction` (`static/app.js:470-491`) with:

```js
function openLogInteraction() {
  document.getElementById('interactionModalTitle').textContent = 'Log Interaction';
  document.getElementById('iId').value = '';
  document.getElementById('interactionForm').reset();
  document.getElementById('iDate').value = new Date().toISOString().slice(0,10);
  openModal('interactionModal');
}

async function openEditInteraction(id) {
  try {
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    const i = interactions.find(x => x.id === id);
    if (!i) return;
    document.getElementById('interactionModalTitle').textContent = 'Edit Interaction';
    document.getElementById('iId').value = i.id;
    document.getElementById('iType').value = i.type;
    document.getElementById('iDate').value = i.interaction_date;
    document.getElementById('iSummary').value = i.summary;
    openModal('interactionModal');
  } catch (e) { showToast('Failed to load interaction.'); }
}

async function submitInteraction(e) {
  e.preventDefault();
  const id   = document.getElementById('iId').value;
  const data = {
    type:             document.getElementById('iType').value,
    summary:          document.getElementById('iSummary').value.trim(),
    interaction_date: document.getElementById('iDate').value,
  };
  try {
    if (id) {
      await API.put(`/api/interactions/${id}`, data);
      showToast('Interaction updated.');
    } else {
      data.contact_id = _currentContact.id;
      await API.post('/api/interactions', data);
      showToast('Interaction logged.');
    }
    closeModal();
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Failed to save interaction.'); }
}
```

- [ ] **Step 4: Manual verification**

Run: `python app.py`

1. Navigate to a contact with at least one logged interaction.
2. Click "+ Log Interaction", fill it in, Save → new interaction appears, modal title reads "Log Interaction" next time it's reopened via that button.
3. Click "Edit" on an existing interaction → modal opens titled "Edit Interaction" with fields pre-filled.
4. Change the type and summary, Save → the row updates in place, no duplicate row created.
5. Reload the page → the edit persisted.

Expected: all steps behave as described.

- [ ] **Step 5: Commit**

```bash
git add templates/contact.html static/app.js
git commit -m "feat: add interaction editing"
```

---

### Task 10: Frontend — dashboard Recent Activity and Upcoming panels

**Files:**
- Modify: `templates/dashboard.html`
- Modify: `static/app.js:1370-1435` (`renderDashboard`)

**Interfaces:**
- Consumes: `data.recent_activity`, `data.upcoming` from `GET /api/dashboard` (Task 6); `TIMELINE_CATEGORY_LABELS`, `TIMELINE_SOURCE_LABELS` (Task 8); `badgeHtml`/`esc`/`fmtDate` (existing utilities).

- [ ] **Step 1: Add the two panels to the template**

In `templates/dashboard.html`, add a new `dash-row` right after the existing one (after the closing `</div>` of the `dashRoot` row, currently line 40, before `{% endblock %}`):

```html
<div class="dash-row">
  <div class="card dash-col-half">
    <div class="card-title">Recent Activity</div>
    <div id="dashRecentActivity"><p class="empty-state">Loading…</p></div>
  </div>
  <div class="card dash-col-half">
    <div class="card-title">Upcoming</div>
    <div id="dashUpcoming"><p class="empty-state">Loading…</p></div>
  </div>
</div>
```

- [ ] **Step 2: Render the panels**

In `static/app.js`, add to the end of `renderDashboard` (right before its closing `}`, after the existing `recentList` block that ends around `static/app.js:1434`):

```js
  const raEl = document.getElementById('dashRecentActivity');
  if (raEl) {
    const items = data.recent_activity || [];
    raEl.innerHTML = items.length
      ? items.map(i => `
        <div class="interaction-item">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              ${i.category ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
                            : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source)}
              <a href="${i.link}" class="table-link">${esc(i.company_name)}</a>
              <span class="interaction-date">${fmtDate(i.date)}</span>
            </div>
            <div class="interaction-summary">${esc(i.title)}</div>
          </div>
        </div>`).join('')
      : '<p class="empty-state">No recent activity.</p>';
  }

  const upEl = document.getElementById('dashUpcoming');
  if (upEl) {
    const items = data.upcoming || [];
    upEl.innerHTML = items.length
      ? items.map(i => `
        <div class="interaction-item">
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px">
              ${i.category ? badgeHtml(i.category, TIMELINE_CATEGORY_LABELS[i.category] || i.category)
                            : badgeHtml(i.source, TIMELINE_SOURCE_LABELS[i.source] || i.source)}
              <a href="${i.link}" class="table-link">${esc(i.company_name)}</a>
              <span class="interaction-date">${fmtDate(i.date)}</span>
            </div>
            <div class="interaction-summary">${esc(i.title)}</div>
          </div>
        </div>`).join('')
      : '<p class="empty-state">Nothing upcoming.</p>';
  }
```

`TIMELINE_SOURCE_LABELS` needs an `action_item` entry for this panel (already added in Task 8's `TIMELINE_SOURCE_LABELS` definition — no change needed here).

- [ ] **Step 3: Manual verification**

Run: `python app.py`

1. Open the Dashboard.
2. Confirm "Recent Activity" shows past meetings/notes/events across companies, newest first, each linking to its company.
3. Confirm "Upcoming" shows future meetings, open action items due in the future, and future timeline events, soonest first.
4. Add a new company note or timeline event dated today → refresh Dashboard → it appears in Recent Activity.
5. Add a timeline event dated next week → refresh Dashboard → it appears in Upcoming.

Expected: all steps behave as described.

- [ ] **Step 4: Commit**

```bash
git add templates/dashboard.html static/app.js
git commit -m "feat: add dashboard recent activity and upcoming panels"
```

---

## Final Verification

- [ ] Run the full test suite: `python -m pytest tests/ -v` — all tests pass.
- [ ] Manually walk through: add/edit/delete a company note; add/edit/delete each of the 5 timeline event categories; confirm the merged company timeline sorts correctly; edit an interaction; confirm the dashboard's Recent Activity and Upcoming panels populate and link correctly.
