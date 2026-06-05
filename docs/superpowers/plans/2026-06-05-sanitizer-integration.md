# Sanitizer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/sanitize` page to CCRM that pre-populates an entity masking registry from meeting context, supports a 4-step pipeline (load → sanitize → external LLM → save summary), and surfaces the saved summary above raw notes on the meeting detail page.

**Architecture:** Three new Flask routes (`GET /sanitize`, `GET /api/sanitize/context`, `PATCH /api/meetings/<id>/summary`), one new `summary` column on `meetings`, one new Jinja2 template (`sanitize.html`), and updates to `app.js` and `base.html`. All sanitization runs client-side in JS ported from the standalone claude-sanitizer.

**Tech Stack:** Python/Flask, SQLite3 (raw), Vanilla JS, Jinja2

---

## File Map

| Action | File |
|--------|------|
| Modify | `schema.sql` — add `summary` column to meetings |
| Modify | `app.py` — `migrate_db()` guard + 3 new routes |
| Modify | `tests/test_api.py` — tests for 2 new API endpoints |
| Modify | `static/app.js` — `API.patch` method + updated `renderMeetingDetail` |
| Modify | `templates/base.html` — Sanitize nav link |
| Create | `templates/sanitize.html` — full sanitize page |

---

## Task 1: Add `summary` column to schema and migration

**Files:**
- Modify: `schema.sql`
- Modify: `app.py` (lines 56-68, `migrate_db` function)

- [ ] **Step 1: Update `schema.sql` to include `summary` column**

In `schema.sql`, replace the meetings CREATE TABLE block:

```sql
CREATE TABLE IF NOT EXISTS meetings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    meeting_date TEXT    NOT NULL,
    company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    notes        TEXT    DEFAULT '',
    summary      TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
```

- [ ] **Step 2: Add migration guard to `migrate_db()` in `app.py`**

Add these lines inside `migrate_db()`, after the existing `reports_to` guard and before `db.commit()`:

```python
    cols_m = {r[1] for r in db.execute("PRAGMA table_info(meetings)")}
    if 'summary' not in cols_m:
        db.execute("ALTER TABLE meetings ADD COLUMN summary TEXT DEFAULT ''")
```

- [ ] **Step 3: Commit**

```bash
git add schema.sql app.py
git commit -m "feat: add summary column to meetings table"
```

---

## Task 2: TDD for `PATCH /api/meetings/<id>/summary`

**Files:**
- Modify: `tests/test_api.py`
- Modify: `app.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api.py`:

```python
def test_update_meeting_summary(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Team Sync', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.patch(f'/api/meetings/{meeting["id"]}/summary',
                     json={'summary': 'Key decisions made.'})
    assert r.status_code == 200
    assert r.get_json()['ok'] is True
    m = client.get(f'/api/meetings/{meeting["id"]}').get_json()
    assert m['summary'] == 'Key decisions made.'

def test_update_meeting_summary_not_found(client):
    r = client.patch('/api/meetings/999/summary', json={'summary': 'nope'})
    assert r.status_code == 404

def test_update_meeting_summary_empty(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Sync', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.patch(f'/api/meetings/{meeting["id"]}/summary', json={'summary': ''})
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_api.py::test_update_meeting_summary tests/test_api.py::test_update_meeting_summary_not_found tests/test_api.py::test_update_meeting_summary_empty -v
```

Expected: all three FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement `PATCH /api/meetings/<id>/summary` in `app.py`**

Add this route after the existing `DELETE /api/meetings/<int:mid>` route (after line ~370):

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_api.py::test_update_meeting_summary tests/test_api.py::test_update_meeting_summary_not_found tests/test_api.py::test_update_meeting_summary_empty -v
```

Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_api.py app.py
git commit -m "feat: add PATCH /api/meetings/<id>/summary endpoint"
```

---

## Task 3: TDD for `GET /api/sanitize/context`

**Files:**
- Modify: `tests/test_api.py`
- Modify: `app.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api.py`:

```python
def test_sanitize_context_with_attendees_and_company(client):
    co = client.post('/api/companies', json={'name': 'Acme Corp'}).get_json()
    meeting = client.post('/api/meetings', json={
        'title': 'Q2 Review', 'meeting_date': '2026-06-01',
        'company_id': co['id'], 'notes': 'Raw notes here'
    }).get_json()
    c1 = client.post('/api/contacts', json={'first_name': 'Jane', 'last_name': 'Doe'}).get_json()
    c2 = client.post('/api/contacts', json={'first_name': 'Bob', 'last_name': 'Smith'}).get_json()
    client.post(f'/api/meetings/{meeting["id"]}/attendees', json={'contact_id': c1['id']})
    client.post(f'/api/meetings/{meeting["id"]}/attendees', json={'contact_id': c2['id']})

    r = client.get(f'/api/sanitize/context?meeting_id={meeting["id"]}')
    assert r.status_code == 200
    data = r.get_json()
    assert data['meeting_id'] == meeting['id']
    assert data['title'] == 'Q2 Review'
    assert data['notes'] == 'Raw notes here'
    assert data['company']['name'] == 'Acme Corp'
    assert len(data['attendees']) == 2
    first_names = {a['first_name'] for a in data['attendees']}
    assert first_names == {'Jane', 'Bob'}

def test_sanitize_context_no_company_no_attendees(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Solo Meeting', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.get(f'/api/sanitize/context?meeting_id={meeting["id"]}')
    assert r.status_code == 200
    data = r.get_json()
    assert data['company'] is None
    assert data['attendees'] == []

def test_sanitize_context_not_found(client):
    r = client.get('/api/sanitize/context?meeting_id=999')
    assert r.status_code == 404

def test_sanitize_context_missing_param(client):
    r = client.get('/api/sanitize/context')
    assert r.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python -m pytest tests/test_api.py::test_sanitize_context_with_attendees_and_company tests/test_api.py::test_sanitize_context_no_company_no_attendees tests/test_api.py::test_sanitize_context_not_found tests/test_api.py::test_sanitize_context_missing_param -v
```

Expected: all four FAIL with 404 (route doesn't exist yet).

- [ ] **Step 3: Implement `GET /api/sanitize/context` in `app.py`**

Add this route after the `api_update_meeting_summary` route you just added:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python -m pytest tests/test_api.py::test_sanitize_context_with_attendees_and_company tests/test_api.py::test_sanitize_context_no_company_no_attendees tests/test_api.py::test_sanitize_context_not_found tests/test_api.py::test_sanitize_context_missing_param -v
```

Expected: all four PASS.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
python -m pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/test_api.py app.py
git commit -m "feat: add GET /api/sanitize/context endpoint"
```

---

## Task 4: Add page route and nav link

**Files:**
- Modify: `app.py`
- Modify: `templates/base.html`

- [ ] **Step 1: Add `GET /sanitize` page route to `app.py`**

Add after the existing `meetings_page` route (around line 103):

```python
@app.route('/sanitize')
def sanitize_page():
    return render_template('sanitize.html')
```

- [ ] **Step 2: Add Sanitize link to nav in `templates/base.html`**

After the existing Meetings `<li>` block, add:

```html
      <li>
        <a href="/sanitize"
           class="nav-link {% if request.path.startswith('/sanitize') %}active{% endif %}">
          🔒 Sanitize
        </a>
      </li>
```

- [ ] **Step 3: Commit**

```bash
git add app.py templates/base.html
git commit -m "feat: add /sanitize page route and nav link"
```

---

## Task 5: Update `app.js` — `API.patch` + `renderMeetingDetail`

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Add `patch` method to the `API` object**

Inside the `API` object in `static/app.js`, add after the `del` method (before the closing `}`):

```javascript
  async patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }
```

- [ ] **Step 2: Update `renderMeetingDetail` to show summary first and add Sanitize button**

Replace the entire `renderMeetingDetail` function (lines 501-523) with:

```javascript
function renderMeetingDetail(m) {
  document.getElementById('meetingDetailRoot').innerHTML = `
    <a href="/meetings" class="back-link">← All Meetings</a>
    <div class="card">
      <div class="contact-header">
        <div>
          <div class="contact-name">${esc(m.title)}</div>
          <div class="contact-meta">${fmtDate(m.meeting_date)}${m.company_name ? ' · ' + esc(m.company_name) : ''}</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditMeetingDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMeetingDetail(${m.id})">Delete</button>
        </div>
      </div>
      ${m.summary ? `<div class="contact-fields">
        <div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Summary</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(m.summary)}</span>
        </div>
      </div>` : ''}
      ${m.notes ? `<div class="contact-fields">
        <div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(m.notes)}</span>
        </div>
      </div>` : ''}
      <div style="padding:12px 16px 8px;text-align:right">
        <a href="/sanitize?meeting_id=${m.id}" class="btn btn-secondary btn-sm">🔒 Sanitize Notes</a>
      </div>
    </div>
  `;
}
```

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: add API.patch and update meeting detail to show summary"
```

---

## Task 6: Create `templates/sanitize.html`

**Files:**
- Create: `templates/sanitize.html`

- [ ] **Step 1: Create the file with full content**

Create `templates/sanitize.html`:

```html
{% extends 'base.html' %}
{% block title %}Sanitize Notes — CCRM{% endblock %}
{% block content %}
<div style="display:flex;gap:20px;height:calc(100vh - 60px);overflow:hidden">

  <!-- Left: Context panel -->
  <div style="width:340px;flex-shrink:0;display:flex;flex-direction:column;gap:16px;overflow-y:auto;padding-bottom:16px">

    <div class="card">
      <div class="card-title">Meeting</div>
      <select id="meetingPicker" onchange="onMeetingChange()" style="width:100%">
        <option value="">— Select a meeting —</option>
      </select>
    </div>

    <div class="card" style="flex:1">
      <div class="card-title">Entity Registry</div>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input type="text" id="eName" placeholder="Name to mask"
               style="flex:1;min-width:0"
               onkeydown="if(event.key==='Enter')addEntity()">
        <select id="eType" style="width:96px">
          <option value="person">Person</option>
          <option value="company">Company</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="addEntity()">Add</button>
      </div>
      <div id="entityList"><p class="empty-state">No entities registered.</p></div>
    </div>

  </div>

  <!-- Right: Pipeline panels -->
  <div style="flex:1;display:flex;flex-direction:column;gap:16px;overflow-y:auto;padding-bottom:16px">

    <div class="card">
      <div class="card-title">Raw Notes</div>
      <textarea id="rawNotes" placeholder="Paste raw meeting notes here…"
                style="width:100%;min-height:150px;font-family:inherit;resize:vertical"></textarea>
      <div style="margin-top:8px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary" onclick="sanitize()">&#9654;&nbsp;Sanitize</button>
      </div>
    </div>

    <div class="card">
      <div class="section-header">
        <div class="card-title" style="margin:0">Sanitized Output</div>
        <button class="btn btn-secondary btn-sm" id="copyBtn" onclick="copyOutput()" disabled>Copy</button>
      </div>
      <textarea id="sanitizedOut" readonly placeholder="Sanitized text appears here…"
                style="width:100%;min-height:150px;font-family:inherit;resize:vertical;background:var(--bg,#f1f5f9)"></textarea>
    </div>

    <div class="card">
      <div class="card-title">LLM Response</div>
      <p style="font-size:0.8rem;color:var(--text-muted,#64748b);margin-bottom:8px">
        Copy the sanitized output above, run it through your LLM, then paste the result here.
      </p>
      <textarea id="llmResponse" placeholder="Paste the LLM's organized summary here…"
                style="width:100%;min-height:150px;font-family:inherit;resize:vertical"></textarea>
      <div style="margin-top:8px;display:flex;justify-content:flex-end">
        <button class="btn btn-primary" id="saveSummaryBtn" onclick="saveSummary()" disabled>
          Save Summary to Meeting
        </button>
      </div>
    </div>

  </div>
</div>
{% endblock %}
{% block scripts %}
<script>
'use strict';

let entities         = [];
let nextId           = 1;
let currentMeetingId = null;

// ── Init ──────────────────────────────────────────────────────────────────────
async function initSanitize() {
  await populateMeetingPicker();
  const params = new URLSearchParams(window.location.search);
  const mid    = parseInt(params.get('meeting_id'));
  if (mid) {
    document.getElementById('meetingPicker').value = String(mid);
    await loadMeetingContext(mid);
  }
}

async function populateMeetingPicker() {
  try {
    const meetings = await API.get('/api/meetings');
    const sel = document.getElementById('meetingPicker');
    sel.innerHTML = '<option value="">— Select a meeting —</option>' +
      meetings.map(m =>
        `<option value="${m.id}">${esc(m.title)} (${fmtDate(m.meeting_date)})</option>`
      ).join('');
  } catch (e) { showToast('Failed to load meetings.'); }
}

async function onMeetingChange() {
  const mid = parseInt(document.getElementById('meetingPicker').value);
  if (!mid) { resetPage(); return; }
  await loadMeetingContext(mid);
}

async function loadMeetingContext(mid) {
  try {
    const ctx = await API.get(`/api/sanitize/context?meeting_id=${mid}`);
    currentMeetingId = ctx.meeting_id;

    document.getElementById('rawNotes').value      = ctx.notes;
    document.getElementById('sanitizedOut').value  = '';
    document.getElementById('llmResponse').value   = '';
    document.getElementById('copyBtn').disabled    = true;
    document.getElementById('saveSummaryBtn').disabled = false;

    entities = [];
    nextId   = 1;
    ctx.attendees.forEach(a => {
      addEntityToList(`${a.first_name} ${a.last_name}`.trim(), 'person');
    });
    if (ctx.company) {
      addEntityToList(ctx.company.name, 'company');
    }
    renderEntityList();
    if (entities.length === 0) {
      showToast('No entities auto-loaded — add them manually.');
    }
  } catch (e) {
    showToast('Meeting not found.');
    resetPage();
  }
}

function resetPage() {
  currentMeetingId = null;
  entities = [];
  nextId   = 1;
  document.getElementById('rawNotes').value      = '';
  document.getElementById('sanitizedOut').value  = '';
  document.getElementById('llmResponse').value   = '';
  document.getElementById('copyBtn').disabled    = true;
  document.getElementById('saveSummaryBtn').disabled = true;
  renderEntityList();
}

// ── Entity registry ───────────────────────────────────────────────────────────
function addEntity() {
  const nameEl = document.getElementById('eName');
  const name   = nameEl.value.trim();
  if (!name) { nameEl.focus(); return; }
  if (entities.some(e => e.name.toLowerCase() === name.toLowerCase())) {
    showToast('Already registered: ' + name);
    nameEl.select();
    return;
  }
  const type = document.getElementById('eType').value;
  addEntityToList(name, type);
  name.split(/\s+/).forEach(word => {
    if (!entities.some(e => e.name.toLowerCase() === word.toLowerCase())) {
      addEntityToList(word, type);
    }
  });
  nameEl.value = '';
  nameEl.focus();
  renderEntityList();
}

function addEntityToList(name, type) {
  entities.push({ id: nextId++, name, type });
}

function deleteEntity(id) {
  entities = entities.filter(e => e.id !== id);
  renderEntityList();
}

function renderEntityList() {
  const el = document.getElementById('entityList');
  if (!entities.length) {
    el.innerHTML = '<p class="empty-state">No entities registered.</p>';
    return;
  }
  el.innerHTML = entities.map(e =>
    `<div class="interaction-item">
      <div style="flex:1;display:flex;align-items:center;gap:6px;min-width:0">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)}</span>
        <span class="badge badge-${e.type === 'person' ? 'note' : 'email'}">${e.type}</span>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteEntity(${e.id})">&#x2715;</button>
    </div>`
  ).join('');
}

// ── Sanitization engine (ported from claude-sanitizer) ────────────────────────
function rxEsc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function maskWord(w) {
  return w.length <= 1 ? w : w[0] + '*'.repeat(w.length - 1);
}
function maskPhrase(match) {
  return '[' + match.split(/\s+/).map(maskWord).join(' ') + ']';
}

function sanitize() {
  const raw = document.getElementById('rawNotes').value;
  if (!raw.trim())       { showToast('Paste some notes first.');        return; }
  if (!entities.length)  { showToast('Add at least one entity first.'); return; }

  const sorted   = [...entities].sort((a, b) => b.name.length - a.name.length);
  const alts     = sorted.map(e =>
    '(?:' + e.name.trim().split(/\s+/).map(rxEsc).join('\\s+') + ')'
  );
  const combined = new RegExp('\\b(?:' + alts.join('|') + ')\\b', 'gi');
  const result   = raw.replace(combined, match => maskPhrase(match));

  document.getElementById('sanitizedOut').value = result;
  document.getElementById('copyBtn').disabled   = false;
}

function copyOutput() {
  const text = document.getElementById('sanitizedOut').value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(
    ()  => showToast('Copied to clipboard.'),
    ()  => { document.getElementById('sanitizedOut').select(); document.execCommand('copy'); showToast('Copied.'); }
  );
}

// ── Save summary ──────────────────────────────────────────────────────────────
async function saveSummary() {
  if (!currentMeetingId) { showToast('Select a meeting first.'); return; }
  const summary = document.getElementById('llmResponse').value.trim();
  if (!summary) { showToast('Nothing to save.'); return; }
  try {
    await API.patch(`/api/meetings/${currentMeetingId}/summary`, { summary });
    showToast('Summary saved.');
  } catch (e) { showToast('Save failed, try again.'); }
}

initSanitize();
</script>
{% endblock %}
```

- [ ] **Step 2: Start the dev server and verify the page loads**

```bash
python app.py
```

Navigate to http://localhost:5000/sanitize — the page should load with the two-column layout, meeting picker, and entity registry panel.

- [ ] **Step 3: Verify the full pipeline manually**

1. Select a meeting that has attendees and a company assigned.
2. Confirm the entity registry auto-populates with attendee names and company.
3. Paste some text containing an attendee name into Raw Notes.
4. Click Sanitize — confirm names are masked as `[F***]` / `[F*** L***]`.
5. Click Copy — confirm clipboard contains the masked text.
6. Paste something into the LLM Response box and click Save Summary.
7. Navigate to the meeting detail page — confirm the Summary section appears above Notes.

- [ ] **Step 4: Run full test suite**

```bash
python -m pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add templates/sanitize.html
git commit -m "feat: add sanitize page with meeting context pre-population"
```
