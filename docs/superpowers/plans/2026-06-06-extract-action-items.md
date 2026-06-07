# Extract Action Items from Summary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Extract from Summary" button on the meeting detail page that parses the LLM-generated markdown summary for its action items table and presents candidates as a modal checklist — each with an editable description, attendee dropdown, free-text due date, and optional date picker — so the user can bulk-add confirmed items in one click.

**Architecture:** Three tasks. (1) Add `due_date_text TEXT` column to `action_items` — schema, migration, and both API endpoints. (2) Plumb `due_date_text` into the existing add/edit modal and the action items list renderer. (3) Add the "Extract from Summary" button + extraction modal + all JS logic. The markdown is parsed client-side using a line-by-line table scanner — no new server routes.

**Tech Stack:** Python Flask 3.x · sqlite3 · Vanilla JS · Jinja2 templates

---

## File Map

| File | Change |
|------|--------|
| `schema.sql` | Add `due_date_text TEXT` column to `action_items` |
| `app.py` | `migrate_db`: add `due_date_text` ALTER; `api_create_action_item` + `api_update_action_item`: accept `due_date_text` |
| `templates/meeting.html` | Add `aiDueDateText` input to action item modal; add hidden `extractFromSummaryBtn`; add `extractModal` div |
| `static/app.js` | Update `openEditActionItem`, `submitActionItem`, `renderActionItems`; add `parseActionItemsFromSummary`, `openExtractModal`, `submitExtractedItems`; show/hide extract button in `loadMeetingDetail` |
| `tests/test_api.py` | Add two tests: create action item with `due_date_text`, update action item preserves `due_date_text` |

---

## Task 1: `due_date_text` — Schema, Migration, API

**Files:**
- Modify: `schema.sql`
- Modify: `app.py` (`migrate_db`, `api_create_action_item`, `api_update_action_item`)
- Modify: `tests/test_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api.py`:

```python
def test_create_action_item_with_due_date_text(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={
        'description': 'Schedule follow-up',
        'due_date_text': 'within a couple of weeks',
    })
    assert r.status_code == 201
    assert r.get_json()['due_date_text'] == 'within a couple of weeks'

def test_update_action_item_due_date_text(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Do X'})
    aid = r.get_json()['id']
    r2 = client.put(f'/api/action_items/{aid}', json={
        'description': 'Do X',
        'due_date_text': 'end of Q3',
    })
    assert r2.status_code == 200
    assert r2.get_json()['due_date_text'] == 'end of Q3'
```

- [ ] **Step 2: Run tests to verify they fail**

```
python -m pytest tests/test_api.py::test_create_action_item_with_due_date_text tests/test_api.py::test_update_action_item_due_date_text -v
```

Expected: both FAIL (column doesn't exist yet)

- [ ] **Step 3: Add `due_date_text` to `schema.sql`**

In `schema.sql`, find the `action_items` table definition. Replace:

```sql
    due_date     TEXT,
    completed    INTEGER NOT NULL DEFAULT 0,
```

With:

```sql
    due_date      TEXT,
    due_date_text TEXT,
    completed     INTEGER NOT NULL DEFAULT 0,
```

- [ ] **Step 4: Add migration to `migrate_db()` in `app.py`**

In `app.py`, find `migrate_db()`. After the block that checks for `summary` in meetings (ending around line 70), insert before `db.commit()`:

```python
    cols_ai = {r[1] for r in db.execute("PRAGMA table_info(action_items)")}
    if 'due_date_text' not in cols_ai:
        db.execute("ALTER TABLE action_items ADD COLUMN due_date_text TEXT")
```

- [ ] **Step 5: Update `api_create_action_item` in `app.py`**

Find `api_create_action_item`. Replace:

```python
    cur = execute(
        'INSERT INTO action_items (meeting_id,assigned_to,description,due_date,completed,created_at,updated_at) '
        'VALUES (?,?,?,?,0,?,?)',
        (mid, data.get('assigned_to') or None, description,
         data.get('due_date') or None, ts, ts)
    )
```

With:

```python
    cur = execute(
        'INSERT INTO action_items (meeting_id,assigned_to,description,due_date,due_date_text,completed,created_at,updated_at) '
        'VALUES (?,?,?,?,?,0,?,?)',
        (mid, data.get('assigned_to') or None, description,
         data.get('due_date') or None, data.get('due_date_text') or None, ts, ts)
    )
```

- [ ] **Step 6: Update `api_update_action_item` in `app.py`**

Find `api_update_action_item`. Replace:

```python
    execute(
        'UPDATE action_items SET description=?,due_date=?,assigned_to=?,updated_at=? WHERE id=?',
        (description, data.get('due_date') or None,
         data.get('assigned_to') or None, now_iso(), aid)
    )
```

With:

```python
    execute(
        'UPDATE action_items SET description=?,due_date=?,due_date_text=?,assigned_to=?,updated_at=? WHERE id=?',
        (description, data.get('due_date') or None, data.get('due_date_text') or None,
         data.get('assigned_to') or None, now_iso(), aid)
    )
```

- [ ] **Step 7: Run the new tests to verify they pass**

```
python -m pytest tests/test_api.py::test_create_action_item_with_due_date_text tests/test_api.py::test_update_action_item_due_date_text -v
```

Expected: both PASS

- [ ] **Step 8: Run the full suite to verify no regressions**

```
python -m pytest tests/test_api.py -v
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: add due_date_text to action_items schema and API"
```

---

## Task 2: Plumb `due_date_text` into the Existing Add/Edit Modal and Renderer

**Files:**
- Modify: `templates/meeting.html`
- Modify: `static/app.js`

No new API calls — this is pure frontend wiring.

- [ ] **Step 1: Add `aiDueDateText` input to the action item modal in `templates/meeting.html`**

Find the action item modal in `meeting.html`:

```html
    <div class="form-row"><label>Description *</label><textarea id="aiDescription" required placeholder="What needs to be done?"></textarea></div>
    <div class="form-row-2">
      <div class="form-row"><label>Due Date</label><input type="date" id="aiDueDate"></div>
```

Replace with:

```html
    <div class="form-row"><label>Description *</label><textarea id="aiDescription" required placeholder="What needs to be done?"></textarea></div>
    <div class="form-row"><label>Due Date Note</label><input type="text" id="aiDueDateText" placeholder="e.g. within a couple of weeks"></div>
    <div class="form-row-2">
      <div class="form-row"><label>Hard Due Date</label><input type="date" id="aiDueDate"></div>
```

- [ ] **Step 2: Update `openEditActionItem` in `static/app.js` to populate `aiDueDateText`**

Find in `openEditActionItem`:

```javascript
    document.getElementById('aiDescription').value = a.description || '';
    document.getElementById('aiDueDate').value      = a.due_date    || '';
```

Replace with:

```javascript
    document.getElementById('aiDescription').value  = a.description    || '';
    document.getElementById('aiDueDateText').value  = a.due_date_text  || '';
    document.getElementById('aiDueDate').value       = a.due_date       || '';
```

- [ ] **Step 3: Update `submitActionItem` in `static/app.js` to send `due_date_text`**

Find in `submitActionItem`:

```javascript
  const data = {
    description:  document.getElementById('aiDescription').value.trim(),
    due_date:     document.getElementById('aiDueDate').value || null,
```

Replace with:

```javascript
  const data = {
    description:   document.getElementById('aiDescription').value.trim(),
    due_date_text: document.getElementById('aiDueDateText').value.trim() || null,
    due_date:      document.getElementById('aiDueDate').value || null,
```

- [ ] **Step 4: Update `renderActionItems` in `static/app.js` to show `due_date_text`**

Find in `renderActionItems`:

```javascript
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : ''}
```

Replace with:

```javascript
          ${a.due_date ? `<span>Due: ${fmtDate(a.due_date)}</span>` : (a.due_date_text ? `<span>${esc(a.due_date_text)}</span>` : '')}
```

- [ ] **Step 5: Manual smoke test**

```
python app.py
```

Open any meeting. Add a new action item — fill in Description, a Due Date Note (text), and a Hard Due Date. Save. Verify the list shows the note when no hard date, or the formatted hard date when one is set. Open the item to edit — verify all three fields are pre-populated correctly.

- [ ] **Step 6: Commit**

```bash
git add templates/meeting.html static/app.js
git commit -m "feat: add due_date_text field to action item add/edit modal and renderer"
```

---

## Task 3: "Extract from Summary" Button, Modal, and JS Logic

**Files:**
- Modify: `templates/meeting.html`
- Modify: `static/app.js`

- [ ] **Step 1: Add the extract button and modal to `templates/meeting.html`**

In `meeting.html`, find the Action Items section header:

```html
<!-- Action Items section -->
<div id="actionItemsSection" style="display:none">
  <div class="card">
    <div class="section-header">
      <div class="card-title" style="margin:0">Action Items</div>
      <button class="btn btn-primary btn-sm" onclick="openAddActionItem()">+ Add</button>
    </div>
```

Replace with:

```html
<!-- Action Items section -->
<div id="actionItemsSection" style="display:none">
  <div class="card">
    <div class="section-header">
      <div class="card-title" style="margin:0">Action Items</div>
      <div style="display:flex;gap:8px">
        <button id="extractFromSummaryBtn" class="btn btn-secondary btn-sm" style="display:none" onclick="openExtractModal()">Extract from Summary</button>
        <button class="btn btn-primary btn-sm" onclick="openAddActionItem()">+ Add</button>
      </div>
    </div>
```

Then, at the bottom of `meeting.html` before `{% endblock %}`, add the extract modal (after the existing `actionItemModal` closing `</div>`):

```html
<!-- Extract Action Items Modal -->
<div class="modal" id="extractModal" style="max-width:620px;max-height:80vh;overflow-y:auto">
  <div class="modal-title">Extract Action Items from Summary</div>
  <p style="color:var(--text-secondary);font-size:0.87em;margin:0 0 12px">Uncheck any items you don't want to add. Edit descriptions as needed.</p>
  <div id="extractCandidatesList"></div>
  <div class="modal-footer">
    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
    <button type="button" class="btn btn-primary" onclick="submitExtractedItems()">Add Selected</button>
  </div>
</div>
```

- [ ] **Step 2: Add `parseActionItemsFromSummary` to `static/app.js`**

Insert this function in `static/app.js` immediately before the `// ── Action Items` section comment:

```javascript
function parseActionItemsFromSummary(markdown) {
  const lines = markdown.split('\n');
  const candidates = [];
  let inActionSection = false;
  let headerSeen = false;
  let separatorSeen = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s+.*(action|to.?do)/i.test(trimmed)) {
      inActionSection = true;
      headerSeen = false;
      separatorSeen = false;
      continue;
    }
    if (!inActionSection) continue;
    if (/^#{1,4}\s+/.test(trimmed) && !/action|to.?do/i.test(trimmed)) break;
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;
    const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '');
    if (!headerSeen) { headerSeen = true; continue; }
    if (!separatorSeen && cells.every(c => /^[-: ]+$/.test(c))) { separatorSeen = true; continue; }
    const description = cells[0] ? cells[0].replace(/\*+/g, '').trim() : '';
    if (!description || /^[-:]+$/.test(description)) continue;
    const ownerHint   = cells[1] ? cells[1].replace(/\*+/g, '').trim() : '';
    const dueDateHint = cells[2] ? cells[2].replace(/\*+/g, '').trim() : '';
    candidates.push({ description, ownerHint, dueDateHint });
  }
  return candidates;
}
```

- [ ] **Step 3: Add `openExtractModal` to `static/app.js`**

Insert immediately after `parseActionItemsFromSummary`:

```javascript
async function openExtractModal() {
  if (!_currentMeeting || !_currentMeeting.summary) {
    showToast('No summary available to extract from.');
    return;
  }
  const candidates = parseActionItemsFromSummary(_currentMeeting.summary);
  if (!candidates.length) {
    showToast('No action items found in summary.');
    return;
  }

  const listEl = document.getElementById('extractCandidatesList');
  listEl.innerHTML = candidates.map((c, i) => `
    <div class="extract-candidate" style="border-bottom:1px solid var(--border);padding:12px 0">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <input type="checkbox" data-idx="${i}" checked style="margin-top:4px;flex-shrink:0;cursor:pointer">
        <div style="flex:1">
          <textarea class="extract-desc" data-idx="${i}"
            style="width:100%;min-height:48px;resize:vertical;font-size:0.9em;padding:6px;border:1px solid var(--border);border-radius:4px;background:var(--bg-primary);color:var(--text-primary)"
          >${esc(c.description)}</textarea>
          <div class="form-row-2" style="margin-top:8px">
            <div class="form-row">
              <label style="font-size:0.82em">Assign To</label>
              <select id="extractAssignee_${i}" style="font-size:0.87em">
                <option value="">— Unassigned —</option>
              </select>
            </div>
            <div class="form-row">
              <label style="font-size:0.82em">Due Date</label>
              <input type="text" id="extractDueText_${i}" value="${esc(c.dueDateHint)}"
                placeholder="e.g. end of Q3"
                style="margin-bottom:4px;font-size:0.87em">
              <input type="date" id="extractDueDate_${i}" style="font-size:0.87em">
            </div>
          </div>
          ${c.ownerHint ? `<div style="color:var(--text-secondary);font-size:0.79em;margin-top:4px">Owner hint: ${esc(c.ownerHint)}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  await Promise.all(
    candidates.map((_, i) => populateAttendeeDropdown(`extractAssignee_${i}`, null, _currentMeeting.id))
  );

  openModal('extractModal');
}
```

- [ ] **Step 4: Add `submitExtractedItems` to `static/app.js`**

Insert immediately after `openExtractModal`:

```javascript
async function submitExtractedItems() {
  const btn = document.querySelector('#extractModal .btn-primary');
  const rows = document.querySelectorAll('.extract-candidate');
  const selected = [];
  rows.forEach((row, i) => {
    const cb = row.querySelector('input[type=checkbox]');
    if (!cb || !cb.checked) return;
    const desc = row.querySelector('.extract-desc').value.trim();
    if (!desc) return;
    selected.push({
      description:   desc,
      assigned_to:   document.getElementById(`extractAssignee_${i}`).value || null,
      due_date_text: document.getElementById(`extractDueText_${i}`).value.trim() || null,
      due_date:      document.getElementById(`extractDueDate_${i}`).value || null,
    });
  });
  if (!selected.length) { showToast('No items selected.'); return; }
  btn.disabled = true;
  try {
    await Promise.all(
      selected.map(data => API.post(`/api/meetings/${_currentMeeting.id}/action_items`, data))
    );
    closeModal();
    const items = await API.get(`/api/meetings/${_currentMeeting.id}/action_items`);
    renderActionItems(items);
    showToast(`${selected.length} action item${selected.length > 1 ? 's' : ''} added.`);
  } catch (e) {
    showToast('Failed to add items.');
    btn.disabled = false;
  }
}
```

- [ ] **Step 5: Show/hide the extract button in `loadMeetingDetail` in `static/app.js`**

Find `loadMeetingDetail`. After the line `renderMeetingDetail(meeting);`, add:

```javascript
    const extractBtn = document.getElementById('extractFromSummaryBtn');
    if (extractBtn) extractBtn.style.display = meeting.summary ? '' : 'none';
```

- [ ] **Step 6: Run the full test suite**

```
python -m pytest tests/test_api.py -v
```

Expected: all tests pass (no API changes in this task)

- [ ] **Step 7: Manual verification**

```
python app.py
```

Open a meeting that **has a summary** (one that's gone through the LLM pipeline). Verify:
- "Extract from Summary" button appears in the Action Items header
- Clicking it opens the modal with one row per action item found in the summary's action items table
- Each row has: editable description (pre-filled), owner hint text at the bottom, due date text pre-filled from the summary, attendee dropdown, date picker
- Uncheck one item, click "Add Selected" — only checked items are added
- Toast confirms count; list refreshes with the new items
- New items show due date text in the list when no hard date is set

Open a meeting that has **no summary**. Verify the "Extract from Summary" button is hidden.

- [ ] **Step 8: Commit**

```bash
git add templates/meeting.html static/app.js
git commit -m "feat: extract action items from LLM summary with editable candidate modal"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Parse LLM markdown summary for action items table | Task 3 Step 2 (`parseActionItemsFromSummary`) |
| Show candidates as checkboxes (uncheck to exclude) | Task 3 Step 3 (`openExtractModal`) |
| Editable description per candidate | Task 3 Step 3 (textarea) |
| Attendee dropdown per candidate for owner assignment | Task 3 Steps 3–5 (`populateAttendeeDropdown`) |
| Free-text due date field | Tasks 1–3 (`due_date_text` column + modal input) |
| Hard date picker per candidate | Task 3 Step 3 |
| Owner hint displayed (masked names kept out of assignee dropdown) | Task 3 Step 3 (hint div) |
| "Add Selected" bulk-creates checked items | Task 3 Step 4 (`submitExtractedItems`) |
| Button hidden when no summary | Task 3 Step 5 |
| `due_date_text` persists in existing add/edit modal too | Task 2 |
| `due_date_text` shown in action items list when no hard date | Task 2 Step 4 |
| All existing tests continue to pass | Tasks 1, 2, 3 (full suite runs after each task) |

### Gaps Found

None. The `api_list_action_items` endpoint uses `SELECT a.*` so it returns `due_date_text` automatically once the column exists — no change needed there. The `dashboard` action items query also uses `SELECT a.*` and the dashboard renderer doesn't show due date at all, so no dashboard changes are needed.
