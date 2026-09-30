# Multi-Contact Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an interaction involve multiple contacts (editable), and limit dashboard Recent Activity / Upcoming to 5 items with expand.

**Architecture:** New `interaction_contacts` join table; `interactions.contact_id` removed via one-time rebuild in `migrate_db()`. API returns a `contacts` array on every interaction. Contact-page modal gets a chips + dropdown participant picker. Dashboard list limiting is client-side.

**Tech Stack:** Flask, raw sqlite3, Jinja2, vanilla JS, pytest.

Spec: `docs/superpowers/specs/2026-09-30-multi-contact-interactions-design.md`

## Global Constraints

- No ORM — raw `sqlite3` only.
- `contact_ids` = non-empty list of existing contact ids; duplicates collapsed; unknown id → 400; required on both POST and PUT.
- Every interaction returned by the API carries `contacts: [{id, first_name, last_name}]` sorted by last name then first name, case-insensitive.
- Deleting a contact keeps interactions that still have other participants and deletes interactions left with none.
- Migration must preserve every existing interaction and its contact link.
- Interaction `type` stays one of `call`, `email`, `meeting`, `note`.
- Dashboard Recent Activity and Upcoming: show 5, "Show N more" / "Show less" toggle (client-side).
- Match existing conventions: `API.get/post/put/del`, `showToast`, `confirmDelete`, `openModal/closeModal`, `esc()`, `icon()`, `badgeHtml`, `.interaction-item`.
- Run tests with `python -m pytest tests/ -v`.

---

### Task 1: Backend — join table, migration, API, tests

**Files:**
- Modify: `schema.sql` (change `interactions` DDL, add `interaction_contacts`)
- Modify: `app.py` (`migrate_db`, interactions API section ~lines 220-303, `api_delete_contact`, dashboard `recent` query)
- Modify: `tests/test_api.py` (update existing interaction tests to `contact_ids`; add new tests)

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  - `POST /api/interactions` body `{contact_ids, type, summary, interaction_date}` → 201 interaction
  - `PUT /api/interactions/<id>` body `{contact_ids, type, summary, interaction_date}` → interaction
  - `GET /api/contacts/<id>/interactions` → `[interaction]`
  - `GET /api/dashboard` → `recent_interactions: [interaction]`
  - interaction = `{id, type, summary, interaction_date, created_at, updated_at, contacts: [{id, first_name, last_name}]}` (no `contact_id` field)

- [ ] **Step 1: Update existing tests and add new failing tests.** In `tests/test_api.py`, change every `'contact_id': cid` in the interaction tests (`test_create_interaction`, `test_list_interactions`, `test_delete_interaction`, `test_update_interaction`, `test_update_interaction_invalid_type`, `test_delete_cascades`, `test_dashboard_stats`) to `'contact_ids': [cid]`, and add `'contact_ids': [cid]` to the PUT bodies in `test_update_interaction`, `test_update_interaction_invalid_type`, and `test_update_interaction_not_found` (for the not-found test use `'contact_ids': [1]`). In `test_create_interaction` replace `assert data['contact_id'] == cid` with:

```python
    assert [c['id'] for c in data['contacts']] == [cid]
    assert 'contact_id' not in data
```

Then append these tests:

```python
# ── Multi-contact interactions ───────────────────────────────────────────────

def _log(client, cids, **kw):
    body = {'contact_ids': cids, 'type': 'email', 'summary': 'Group email',
            'interaction_date': '2026-05-28'}
    body.update(kw)
    return client.post('/api/interactions', json=body)


def test_interaction_multiple_contacts(client):
    a = _make_contact(client, 'Zed', 'Adams')
    b = _make_contact(client, 'Amy', 'Brown')
    r = _log(client, [b, a])
    assert r.status_code == 201
    # sorted by last name then first name
    assert [c['id'] for c in r.get_json()['contacts']] == [a, b]
    assert set(r.get_json()['contacts'][0]) == {'id', 'first_name', 'last_name'}
    for cid in (a, b):
        items = client.get(f'/api/contacts/{cid}/interactions').get_json()
        assert len(items) == 1
        assert [c['id'] for c in items[0]['contacts']] == [a, b]


def test_interaction_contact_ids_validation(client):
    cid = _make_contact(client)
    assert _log(client, []).status_code == 400
    assert _log(client, 'nope').status_code == 400
    assert _log(client, None).status_code == 400
    assert _log(client, [cid, 999]).status_code == 400
    assert _log(client, ['x']).status_code == 400
    r = _log(client, [cid, cid])
    assert r.status_code == 201
    assert len(r.get_json()['contacts']) == 1


def test_update_interaction_replaces_participants(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    c = _make_contact(client, 'C', 'Three')
    iid = _log(client, [a, b]).get_json()['id']
    r = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [b, c], 'type': 'call', 'summary': 'Edited',
        'interaction_date': '2026-05-29'})
    assert r.status_code == 200
    assert sorted(x['id'] for x in r.get_json()['contacts']) == sorted([b, c])
    assert client.get(f'/api/contacts/{a}/interactions').get_json() == []
    assert len(client.get(f'/api/contacts/{c}/interactions').get_json()) == 1
    # empty / unknown participants rejected, existing set untouched
    bad = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [], 'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-29'})
    assert bad.status_code == 400
    bad2 = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [999], 'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-29'})
    assert bad2.status_code == 400
    assert len(client.get(f'/api/contacts/{b}/interactions').get_json()) == 1


def test_delete_contact_keeps_shared_interaction(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    _log(client, [a, b])
    client.delete(f'/api/contacts/{a}')
    items = client.get(f'/api/contacts/{b}/interactions').get_json()
    assert len(items) == 1
    assert [c['id'] for c in items[0]['contacts']] == [b]
    client.delete(f'/api/contacts/{b}')
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    assert conn.execute('SELECT COUNT(*) FROM interactions').fetchone()[0] == 0
    conn.close()


def test_dashboard_recent_interactions_include_contacts(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    _log(client, [a, b])
    d = client.get('/api/dashboard').get_json()
    assert len(d['recent_interactions']) == 1
    assert sorted(c['id'] for c in d['recent_interactions'][0]['contacts']) == sorted([a, b])


def test_migrate_legacy_interactions(tmp_path):
    import sqlite3
    db_file = tmp_path / 'legacy.db'
    conn = sqlite3.connect(db_file)
    conn.executescript('''
        CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL,
            last_name TEXT NOT NULL, company TEXT DEFAULT '', title TEXT DEFAULT '',
            email TEXT DEFAULT '', phone TEXT DEFAULT '', notes TEXT DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE interactions (id INTEGER PRIMARY KEY AUTOINCREMENT,
            contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK(type IN ('call','email','meeting','note')),
            summary TEXT NOT NULL, interaction_date TEXT NOT NULL, created_at TEXT NOT NULL);
        INSERT INTO contacts (first_name,last_name,created_at,updated_at) VALUES ('Old','Timer','t','t');
        INSERT INTO interactions (contact_id,type,summary,interaction_date,created_at)
            VALUES (1,'call','Legacy call','2026-01-02','t');
    ''')
    conn.commit()
    conn.close()
    ccrm_app.DB_PATH = str(db_file)
    ccrm_app.migrate_db()
    ccrm_app.migrate_db()  # idempotent
    conn = sqlite3.connect(db_file)
    cols = {r[1] for r in conn.execute('PRAGMA table_info(interactions)')}
    assert 'contact_id' not in cols
    assert conn.execute('SELECT interaction_id, contact_id FROM interaction_contacts').fetchall() == [(1, 1)]
    assert conn.execute('SELECT summary FROM interactions').fetchone()[0] == 'Legacy call'
    conn.close()
    ccrm_app.app.config['TESTING'] = True
    with ccrm_app.app.test_client() as c:
        items = c.get('/api/contacts/1/interactions').get_json()
        assert items[0]['summary'] == 'Legacy call'
        assert items[0]['contacts'][0]['last_name'] == 'Timer'
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `python -m pytest tests/test_api.py -v -k "interaction or cascade or dashboard or legacy"`
Expected: FAIL (contact_ids not understood / no `contacts`).

- [ ] **Step 3: Schema.** In `schema.sql` replace the `interactions` table with:

```sql
CREATE TABLE IF NOT EXISTS interactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    type             TEXT    NOT NULL CHECK(type IN ('call','email','meeting','note')),
    summary          TEXT    NOT NULL,
    interaction_date TEXT    NOT NULL,
    created_at       TEXT    NOT NULL,
    updated_at       TEXT
);

CREATE TABLE IF NOT EXISTS interaction_contacts (
    interaction_id INTEGER NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
    contact_id     INTEGER NOT NULL REFERENCES contacts(id)     ON DELETE CASCADE,
    PRIMARY KEY (interaction_id, contact_id)
);
```

- [ ] **Step 4: Migration.** In `migrate_db()` in `app.py`, immediately after the `cols_int` / `updated_at` block and before `db.commit()`, add:

```python
    cols_int = {r[1] for r in db.execute("PRAGMA table_info(interactions)")}
    if 'contact_id' in cols_int:
        # One-time: move the single contact link into interaction_contacts and
        # rebuild interactions without contact_id (SQLite can't drop a NOT NULL FK column).
        db.execute(
            'INSERT OR IGNORE INTO interaction_contacts (interaction_id, contact_id) '
            'SELECT id, contact_id FROM interactions'
        )
        db.commit()
        db.executescript('''
            CREATE TABLE interactions_new (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                type             TEXT    NOT NULL CHECK(type IN ('call','email','meeting','note')),
                summary          TEXT    NOT NULL,
                interaction_date TEXT    NOT NULL,
                created_at       TEXT    NOT NULL,
                updated_at       TEXT
            );
            INSERT INTO interactions_new (id,type,summary,interaction_date,created_at,updated_at)
                SELECT id,type,summary,interaction_date,created_at,updated_at FROM interactions;
            DROP TABLE interactions;
            ALTER TABLE interactions_new RENAME TO interactions;
        ''')
```

(The connection in `migrate_db` does not enable foreign keys, which the rebuild requires. Keep it that way; do not add `PRAGMA foreign_keys = ON` there.)

- [ ] **Step 5: API.** In `app.py` replace the interactions routes (`api_list_interactions`, `api_create_interaction`, `api_update_interaction`; leave `api_delete_interaction` as is) with:

```python
INTERACTION_TYPES = ('call', 'email', 'meeting', 'note')

def attach_contacts(interactions):
    """Add a 'contacts' list [{id, first_name, last_name}] to each interaction dict."""
    for i in interactions:
        i['contacts'] = []
    if not interactions:
        return interactions
    by_id = {i['id']: i for i in interactions}
    marks = ','.join('?' * len(by_id))
    rows = query(
        'SELECT ic.interaction_id, c.id, c.first_name, c.last_name '
        'FROM interaction_contacts ic JOIN contacts c ON c.id = ic.contact_id '
        f'WHERE ic.interaction_id IN ({marks}) '
        'ORDER BY c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE, c.id',
        list(by_id)
    )
    for r in rows:
        by_id[r['interaction_id']]['contacts'].append(
            {'id': r['id'], 'first_name': r['first_name'], 'last_name': r['last_name']})
    return interactions


def get_interaction(iid):
    row = query('SELECT * FROM interactions WHERE id=?', (iid,), one=True)
    return attach_contacts([as_dict(row)])[0] if row else None


def _parse_contact_ids(data):
    """Return (deduped id list, error). Every id must be an existing contact."""
    ids = data.get('contact_ids')
    if not isinstance(ids, list) or not ids:
        return None, 'contact_ids must be a non-empty list'
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in ids):
        return None, 'contact_ids must be integers'
    ids = list(dict.fromkeys(ids))
    marks = ','.join('?' * len(ids))
    found = query(f'SELECT id FROM contacts WHERE id IN ({marks})', ids)
    if len(found) != len(ids):
        return None, 'unknown contact in contact_ids'
    return ids, None


def _interaction_fields(data):
    itype   = data.get('type', '')
    summary = (data.get('summary') or '').strip()
    idate   = data.get('interaction_date', '')
    if not summary or not idate:
        return None, 'summary and interaction_date are required'
    if itype not in INTERACTION_TYPES:
        return None, 'type must be call, email, meeting, or note'
    return (itype, summary, idate), None


def _set_participants(iid, contact_ids):
    db = get_db()
    db.execute('DELETE FROM interaction_contacts WHERE interaction_id=?', (iid,))
    db.executemany('INSERT INTO interaction_contacts (interaction_id, contact_id) VALUES (?,?)',
                   [(iid, cid) for cid in contact_ids])
    db.commit()


@app.route('/api/contacts/<int:cid>/interactions', methods=['GET'])
def api_list_interactions(cid):
    rows = query(
        'SELECT i.* FROM interactions i '
        'JOIN interaction_contacts ic ON ic.interaction_id = i.id '
        'WHERE ic.contact_id=? ORDER BY i.interaction_date DESC, i.created_at DESC, i.id DESC',
        (cid,)
    )
    return jsonify(attach_contacts(as_list(rows)))


@app.route('/api/interactions', methods=['POST'])
def api_create_interaction():
    data = request.get_json(force=True) or {}
    contact_ids, err = _parse_contact_ids(data)
    if err:
        return jsonify({'error': err}), 400
    fields, err = _interaction_fields(data)
    if err:
        return jsonify({'error': err}), 400
    itype, summary, idate = fields
    cur = execute(
        'INSERT INTO interactions (type,summary,interaction_date,created_at) VALUES (?,?,?,?)',
        (itype, summary, idate, now_iso())
    )
    _set_participants(cur.lastrowid, contact_ids)
    return jsonify(get_interaction(cur.lastrowid)), 201


@app.route('/api/interactions/<int:iid>', methods=['PUT'])
def api_update_interaction(iid):
    if not query('SELECT id FROM interactions WHERE id=?', (iid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    contact_ids, err = _parse_contact_ids(data)
    if err:
        return jsonify({'error': err}), 400
    fields, err = _interaction_fields(data)
    if err:
        return jsonify({'error': err}), 400
    itype, summary, idate = fields
    execute(
        'UPDATE interactions SET type=?,summary=?,interaction_date=?,updated_at=? WHERE id=?',
        (itype, summary, idate, now_iso(), iid)
    )
    _set_participants(iid, contact_ids)
    return jsonify(get_interaction(iid))
```

Keep the existing `api_delete_interaction` route in place. Remove the now-unused `sqlite3.IntegrityError` handling that was in the old create route (it goes away with the old function).

- [ ] **Step 6: Contact delete + dashboard.** Replace `api_delete_contact` body so orphaned interactions are removed:

```python
@app.route('/api/contacts/<int:cid>', methods=['DELETE'])
def api_delete_contact(cid):
    cur = execute('DELETE FROM contacts WHERE id=?', (cid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    # Interactions whose last participant was just deleted are now unreachable.
    execute('DELETE FROM interactions WHERE id NOT IN (SELECT interaction_id FROM interaction_contacts)')
    return jsonify({'ok': True})
```

In `api_dashboard`, replace the `recent = query(...)` statement with:

```python
    recent  = query(
        'SELECT * FROM interactions '
        'ORDER BY interaction_date DESC, created_at DESC, id DESC LIMIT 10'
    )
```

and in the returned JSON change `'recent_interactions':  as_list(recent),` to `'recent_interactions':  attach_contacts(as_list(recent)),`.

- [ ] **Step 7: Run full suite**

Run: `python -m pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: multi-contact interactions (join table, migration, API)"
```

---

### Task 2: Contact page + dashboard interaction UI

**Files:**
- Modify: `templates/contact.html` (Log Interaction modal)
- Modify: `static/app.js` (`renderInteractions`, `openLogInteraction`, `openEditInteraction`, `submitInteraction`; dashboard `recentList` rendering)
- Modify: `static/style.css` (chip styles)

**Interfaces:**
- Consumes: Task 1 API exactly as listed (`contacts` array on each interaction; `contact_ids` on POST/PUT).
- Produces: none used by later tasks.

- [ ] **Step 1: Modal markup.** In `templates/contact.html`, in the `interactionModal` form insert this block between the Type/Date `form-row-2` and the Summary row:

```html
    <div class="form-row">
      <label>With *</label>
      <div id="iChips" class="chip-list"></div>
      <select id="iAddContact" onchange="addInteractionContact()"></select>
    </div>
```

- [ ] **Step 2: Chip styles.** Append to `static/style.css`:

```css
/* ── Participant chips (interaction modal) ──────────────────────────────── */
.chip-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px 2px 10px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--border);
  font-size: var(--fs-sm);
}
.chip button {
  border: 0; background: none; cursor: pointer; padding: 0 2px;
  color: var(--text-muted); font-size: var(--fs-md); line-height: 1;
}
.chip button:hover { color: var(--text); }
```

- [ ] **Step 3: JS — participant picker.** In `static/app.js`, directly above `function openLogInteraction()` add:

```js
let _iParticipants = [];   // [{id, name}]
let _allContacts = [];

function contactLabel(c) { return `${c.first_name} ${c.last_name}`.trim(); }

function renderInteractionChips() {
  document.getElementById('iChips').innerHTML = _iParticipants.map(p => `
    <span class="chip">${esc(p.name)}
      ${_iParticipants.length > 1
        ? `<button type="button" onclick="removeInteractionContact(${p.id})" title="Remove">&times;</button>`
        : ''}
    </span>`).join('');
  const taken = new Set(_iParticipants.map(p => p.id));
  const sel = document.getElementById('iAddContact');
  sel.innerHTML = '<option value="">Add another contact…</option>' +
    _allContacts.filter(c => !taken.has(c.id))
      .map(c => `<option value="${c.id}">${esc(c.last_name)}, ${esc(c.first_name)}</option>`).join('');
}

function addInteractionContact() {
  const sel = document.getElementById('iAddContact');
  const id = parseInt(sel.value, 10);
  const c = _allContacts.find(x => x.id === id);
  if (c) _iParticipants.push({ id: c.id, name: contactLabel(c) });
  renderInteractionChips();
}

function removeInteractionContact(id) {
  if (_iParticipants.length <= 1) return;
  _iParticipants = _iParticipants.filter(p => p.id !== id);
  renderInteractionChips();
}

async function loadAllContacts() {
  try { _allContacts = await API.get('/api/contacts'); } catch (e) { _allContacts = []; }
}
```

- [ ] **Step 4: JS — open/edit/submit.** Replace `openLogInteraction`, `openEditInteraction`, and `submitInteraction` with:

```js
async function openLogInteraction() {
  document.getElementById('interactionModalTitle').textContent = 'Log Interaction';
  document.getElementById('iId').value = '';
  document.getElementById('interactionForm').reset();
  document.getElementById('iDate').value = new Date().toISOString().slice(0,10);
  await loadAllContacts();
  _iParticipants = [{ id: _currentContact.id, name: contactLabel(_currentContact) }];
  renderInteractionChips();
  openModal('interactionModal');
}

async function openEditInteraction(id) {
  try {
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    const i = interactions.find(x => x.id === id);
    if (!i) return;
    await loadAllContacts();
    document.getElementById('interactionModalTitle').textContent = 'Edit Interaction';
    document.getElementById('iId').value = i.id;
    document.getElementById('iType').value = i.type;
    document.getElementById('iDate').value = i.interaction_date;
    document.getElementById('iSummary').value = i.summary;
    _iParticipants = i.contacts.map(c => ({ id: c.id, name: contactLabel(c) }));
    renderInteractionChips();
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
    contact_ids:      _iParticipants.map(p => p.id),
  };
  try {
    if (id) {
      await API.put(`/api/interactions/${id}`, data);
      showToast('Interaction updated.');
    } else {
      await API.post('/api/interactions', data);
      showToast('Interaction logged.');
    }
    closeModal();
    const interactions = await API.get(`/api/contacts/${_currentContact.id}/interactions`);
    renderInteractions(interactions);
  } catch (e) { showToast('Failed to save interaction.'); }
}
```

Note: if the edit removes the current contact from the participants, the interaction disappears from this page after the refresh — that is intended.

- [ ] **Step 5: JS — "With:" line on contact page.** In `renderInteractions`, inside the `<div style="flex:1">` block, after the `interaction-summary` div add:

```js
        ${(() => {
          const others = i.contacts.filter(c => c.id !== _currentContact.id);
          return others.length
            ? `<div class="interaction-summary" style="color:var(--text-muted)">With: ${others.map(c =>
                `<a href="/contacts/${c.id}" class="table-link">${esc(contactLabel(c))}</a>`).join(', ')}</div>`
            : '';
        })()}
```

- [ ] **Step 6: JS — dashboard Recent Interactions.** In the `recentList` rendering in `renderDashboard`, replace the single contact link
`<a href="/contacts/${i.contact_id}" class="table-link">${esc(i.first_name)} ${esc(i.last_name)}</a>` with:

```js
            ${i.contacts.map(c => `<a href="/contacts/${c.id}" class="table-link">${esc(contactLabel(c))}</a>`).join(', ')}
```

- [ ] **Step 7: Verify in browser.** Check for orphaned Flask processes on :5000 (see CLAUDE.md), start the app (preview_start name "ccrm"), and confirm using at least three contacts (create temporary ones and delete them afterward, along with any test interactions; do not leave junk data in `ccrm.db`): log an interaction from contact A that adds B and C; it shows on A, B and C pages with a correct "With:" line; edit it to drop C and add D; the dashboard Recent Interactions lists all participants as links; the last remaining chip has no remove button; existing (migrated) interactions still display; no console errors. Note `ccrm.db` here is the user's real DB and will have been migrated by the app start — that is expected; do not commit `ccrm.db`.

- [ ] **Step 8: Run tests, commit**

Run: `python -m pytest tests/ -v` (expect all PASS), then:

```bash
git add templates static
git commit -m "feat: multi-contact interaction picker and display"
```

---

### Task 3: Dashboard Recent Activity / Upcoming — show 5 with expand

**Files:**
- Modify: `static/app.js` (dashboard `raEl` / `upEl` rendering in `renderDashboard`)

**Interfaces:**
- Consumes: `data.recent_activity` and `data.upcoming` arrays (unchanged; server limits stay 15 / 20).
- Produces: none.

- [ ] **Step 1: Add helpers** in `static/app.js` directly above `function renderDashboard(data)`:

```js
const DASH_LIMIT = 5;

function renderDashActivityItem(i) {
  return `
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
    </div>`;
}

// Shows the first DASH_LIMIT items with a Show more / Show less toggle.
function renderExpandableList(el, items, emptyHtml) {
  if (!items.length) { el.innerHTML = emptyHtml; return; }
  let expanded = false;
  const draw = () => {
    const shown = expanded ? items : items.slice(0, DASH_LIMIT);
    const extra = items.length - DASH_LIMIT;
    el.innerHTML = shown.map(renderDashActivityItem).join('') +
      (extra > 0
        ? `<button type="button" class="btn btn-secondary btn-sm dash-more" style="margin-top:8px">${expanded ? 'Show less' : `Show ${extra} more`}</button>`
        : '');
    const btn = el.querySelector('.dash-more');
    if (btn) btn.onclick = () => { expanded = !expanded; draw(); };
  };
  draw();
}
```

- [ ] **Step 2: Use it.** Replace the whole `raEl` block and the whole `upEl` block in `renderDashboard` with:

```js
  const raEl = document.getElementById('dashRecentActivity');
  if (raEl) renderExpandableList(raEl, data.recent_activity || [], '<p class="empty-state">No recent activity.</p>');

  const upEl = document.getElementById('dashUpcoming');
  if (upEl) renderExpandableList(upEl, data.upcoming || [], '<p class="empty-state">Nothing upcoming.</p>');
```

- [ ] **Step 3: Verify in browser.** Start the app (preview_start "ccrm"), open `/dashboard`. With more than 5 items in a list, only 5 render plus a "Show N more" button; clicking shows all with "Show less"; clicking again collapses. With 5 or fewer items no button appears. If the real data has fewer than 6 items in a list, temporarily add company notes / timeline events through the UI or API to exceed 5, and delete them afterward. No console errors.

- [ ] **Step 4: Run tests, commit**

Run: `python -m pytest tests/ -v` (expect all PASS), then:

```bash
git add static/app.js
git commit -m "feat: dashboard recent activity and upcoming show 5 with expand"
```

- [ ] **Step 5: Update `CLAUDE.md`** under "Key behaviors" add: `- **Interactions** can involve multiple contacts (`interaction_contacts` join table; `interactions` has no `contact_id`). API takes `contact_ids` and returns a `contacts` array. Logged/edited from the contact page modal. Deleting a contact removes interactions left with no participants.` Commit: `git commit -am "docs: note multi-contact interactions"`.
