# Meeting Full-Page Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the meeting creation modal with a full `/meetings/new` page and replace the detail-page edit modal with inline edit mode, so create and edit share the same page layout.

**Architecture:** Three-phase change — (1) add a new `/meetings/new` page that POSTs and redirects to the detail page; (2) refactor `renderMeetingDetail` to support an `editMode` parameter and add inline save/cancel; (3) strip out now-dead modal code from `meetings.html` and `app.js`. The API is untouched; only routes, templates, and frontend JS change.

**Tech Stack:** Python Flask 3.x · Jinja2 templates · Vanilla JS fetch API · sqlite3 (unchanged)

---

## File Map

| File | Change |
|------|--------|
| `app.py` | Add `GET /meetings/new` page route |
| `templates/meeting_new.html` | New: create-meeting full page (title, date, company, notes) |
| `templates/meeting.html` | Remove Edit Meeting modal; inline edit is now in `meetingDetailRoot` |
| `templates/meetings.html` | Change `+ Add Meeting` to `<a href="/meetings/new">`; change Edit button to `<a href="/meetings/<id>">`; remove `meetingModal` div |
| `static/app.js` | Add `initNewMeeting()`, `saveNewMeeting()`; refactor `renderMeetingDetail(m, editMode)` to support both display and edit modes; add `enterMeetingEditMode()`, `cancelMeetingEdit()`, `saveMeetingEdit()`; remove `openAddMeeting()`, `openEditMeeting()`, `submitMeeting()`, `openEditMeetingDetail()`, `submitMeetingDetail()` |
| `tests/test_api.py` | Add `test_new_meeting_page` |

---

## Task 1: `/meetings/new` Route and Page

**Files:**
- Modify: `app.py` (add one route after line 106)
- Create: `templates/meeting_new.html`
- Modify: `static/app.js` (add `initNewMeeting` and `saveNewMeeting` before `// ── Meetings List` section)
- Modify: `tests/test_api.py` (add route smoke test)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_api.py`:

```python
def test_new_meeting_page(client):
    r = client.get('/meetings/new')
    assert r.status_code == 200
    assert b'mTitle' in r.data
    assert b'mNotes' in r.data
```

- [ ] **Step 2: Run test to verify it fails**

```
python -m pytest tests/test_api.py::test_new_meeting_page -v
```

Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Add the route to `app.py`**

After line 106 (`return render_template('meeting.html', meeting_id=mid)`), insert:

```python
@app.route('/meetings/new')
def new_meeting_page():
    return render_template('meeting_new.html')
```

- [ ] **Step 4: Create `templates/meeting_new.html`**

```html
{% extends 'base.html' %}
{% block title %}New Meeting — CCRM{% endblock %}
{% block content %}
<a href="/meetings" class="back-link">← All Meetings</a>
<div class="card">
  <div class="page-header" style="margin-bottom:20px">
    <h1 class="page-title">New Meeting</h1>
  </div>
  <div class="form-row">
    <label>Title *</label>
    <input type="text" id="mTitle" required placeholder="Meeting title">
  </div>
  <div class="form-row-2">
    <div class="form-row">
      <label>Date *</label>
      <input type="date" id="mDate" required>
    </div>
    <div class="form-row">
      <label>Company</label>
      <select id="mCompanyId">
        <option value="">— None —</option>
      </select>
    </div>
  </div>
  <div class="form-row">
    <label>Notes</label>
    <textarea id="mNotes" style="min-height:160px" placeholder="Meeting notes…"></textarea>
  </div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
    <a href="/meetings" class="btn btn-secondary">Cancel</a>
    <button class="btn btn-primary" onclick="saveNewMeeting()">Save Meeting</button>
  </div>
</div>
{% endblock %}
{% block scripts %}<script>initNewMeeting();</script>{% endblock %}
```

- [ ] **Step 5: Add JS functions to `static/app.js`**

Find the line `// ── Meetings List ──` and insert this block immediately before it:

```javascript
// ── New Meeting Page ────────────────────────────────────────────────────────

async function initNewMeeting() {
  document.getElementById('mDate').value = new Date().toISOString().slice(0, 10);
  await populateCompanyDropdown('mCompanyId', null);
}

async function saveNewMeeting() {
  const title = document.getElementById('mTitle').value.trim();
  const date  = document.getElementById('mDate').value;
  if (!title || !date) { showToast('Title and date are required.'); return; }
  const data = {
    title,
    meeting_date: date,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  try {
    const meeting = await API.post('/api/meetings', data);
    window.location.href = `/meetings/${meeting.id}`;
  } catch (e) { showToast('Save failed.'); }
}

```

- [ ] **Step 6: Run test to verify it passes**

```
python -m pytest tests/test_api.py::test_new_meeting_page -v
```

Expected: PASS

- [ ] **Step 7: Manual smoke test**

```
python app.py
```

Navigate to `http://localhost:5000/meetings/new`. Verify:
- Today's date pre-filled
- Company dropdown populated
- Filling in title + notes and clicking Save Meeting creates the meeting and redirects to its detail page

- [ ] **Step 8: Commit**

```bash
git add app.py templates/meeting_new.html static/app.js tests/test_api.py
git commit -m "feat: add /meetings/new full-page create form"
```

---

## Task 2: Inline Edit on Meeting Detail Page

**Files:**
- Modify: `static/app.js` — refactor `renderMeetingDetail`, remove `openEditMeetingDetail` and `submitMeetingDetail`, add `enterMeetingEditMode`, `cancelMeetingEdit`, `saveMeetingEdit`
- Modify: `templates/meeting.html` — remove the Edit Meeting modal div

- [ ] **Step 1: Replace `renderMeetingDetail` in `static/app.js`**

Find and replace the entire `renderMeetingDetail` function (currently ends just before `async function renderAttendeesWithDropdown`). Replace it with:

```javascript
function renderMeetingDetail(m, editMode = false) {
  if (editMode) {
    document.getElementById('meetingDetailRoot').innerHTML = `
      <a href="/meetings" class="back-link">← All Meetings</a>
      <div class="card">
        <div class="form-row">
          <label>Title *</label>
          <input type="text" id="mTitle" value="${esc(m.title)}" required>
        </div>
        <div class="form-row-2">
          <div class="form-row">
            <label>Date *</label>
            <input type="date" id="mDate" value="${m.meeting_date}" required>
          </div>
          <div class="form-row">
            <label>Company</label>
            <select id="mCompanyId"><option value="">— None —</option></select>
          </div>
        </div>
        <div class="form-row">
          <label>Notes</label>
          <textarea id="mNotes" style="min-height:160px">${esc(m.notes || '')}</textarea>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-secondary" onclick="cancelMeetingEdit()">Cancel</button>
          <button class="btn btn-primary" onclick="saveMeetingEdit()">Save</button>
        </div>
      </div>
    `;
    populateCompanyDropdown('mCompanyId', m.company_id);
  } else {
    document.getElementById('meetingDetailRoot').innerHTML = `
      <a href="/meetings" class="back-link">← All Meetings</a>
      <div class="card">
        <div class="contact-header">
          <div>
            <div class="contact-name">${esc(m.title)}</div>
            <div class="contact-meta">${fmtDate(m.meeting_date)}${m.company_name ? ' · ' + esc(m.company_name) : ''}</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="enterMeetingEditMode()">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMeetingDetail(${m.id})">Delete</button>
          </div>
        </div>
        ${m.summary ? `<div class="contact-fields">
          <div class="field-row" style="grid-column:1/-1">
            <span class="field-label">Summary</span>
            <div class="field-value md-content">${marked.parse(m.summary)}</div>
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
}
```

- [ ] **Step 2: Add the three inline-edit functions after `renderMeetingDetail`**

Insert immediately after the closing `}` of `renderMeetingDetail`, before `async function renderAttendeesWithDropdown`:

```javascript
function enterMeetingEditMode() {
  renderMeetingDetail(_currentMeeting, true);
}

function cancelMeetingEdit() {
  renderMeetingDetail(_currentMeeting, false);
}

async function saveMeetingEdit() {
  const title = document.getElementById('mTitle').value.trim();
  const date  = document.getElementById('mDate').value;
  if (!title || !date) { showToast('Title and date are required.'); return; }
  const data = {
    title,
    meeting_date: date,
    company_id:   document.getElementById('mCompanyId').value || null,
    notes:        document.getElementById('mNotes').value.trim(),
  };
  try {
    const updated = await API.put(`/api/meetings/${_currentMeeting.id}`, data);
    _currentMeeting = updated;
    renderMeetingDetail(updated, false);
    showToast('Meeting saved.');
  } catch (e) { showToast('Save failed.'); }
}

```

- [ ] **Step 3: Remove `openEditMeetingDetail` and `submitMeetingDetail` from `static/app.js`**

Delete these two functions in their entirety (currently around lines 612–639):

```javascript
async function openEditMeetingDetail() {
  // ...entire function body...
}

async function submitMeetingDetail(e) {
  // ...entire function body...
}
```

- [ ] **Step 4: Remove the Edit Meeting modal from `templates/meeting.html`**

Delete the entire modal div (currently lines 36–57):

```html
<!-- Edit Meeting Modal -->
<div class="modal" id="meetingModal">
  <div class="modal-title" id="meetingModalTitle">Edit Meeting</div>
  <form id="meetingForm" onsubmit="submitMeetingDetail(event)">
    ...
  </form>
</div>
```

- [ ] **Step 5: Run the full test suite**

```
python -m pytest tests/test_api.py -v
```

Expected: all tests pass (no API changes were made)

- [ ] **Step 6: Manual verification**

```
python app.py
```

Open any existing meeting. Verify:
- Detail page displays title, date, company, notes, summary, Sanitize button as before
- Clicking Edit replaces the card in-place with editable fields (no modal opens)
- Editing title/date/notes and clicking Save updates the display in-place with a "Meeting saved." toast
- Clicking Cancel reverts to display mode with no changes
- Clicking Edit again re-opens edit mode with current values

- [ ] **Step 7: Commit**

```bash
git add static/app.js templates/meeting.html
git commit -m "feat: inline edit mode on meeting detail page, remove modal"
```

---

## Task 3: Update Meetings List — Remove Modal, Link Buttons to Pages

**Files:**
- Modify: `templates/meetings.html` — `+ Add Meeting` → link to `/meetings/new`; remove `meetingModal` div
- Modify: `static/app.js` — change Edit button in `renderMeetings` to a link; remove `openAddMeeting`, `openEditMeeting`, `submitMeeting`

- [ ] **Step 1: Update `templates/meetings.html`**

Replace the `+ Add Meeting` button:
```html
<button class="btn btn-primary" onclick="openAddMeeting()">+ Add Meeting</button>
```
With:
```html
<a href="/meetings/new" class="btn btn-primary">+ Add Meeting</a>
```

Then delete the entire `<!-- Add/Edit Meeting Modal -->` div (currently lines 27–48):
```html
<!-- Add/Edit Meeting Modal -->
<div class="modal" id="meetingModal">
  ...
</div>
```

- [ ] **Step 2: Update `renderMeetings` in `static/app.js`**

Find the Edit button inside `renderMeetings`:
```javascript
<button class="btn btn-secondary btn-sm" onclick="openEditMeeting(${m.id})">Edit</button>
```

Replace with a link to the detail page:
```javascript
<a href="/meetings/${m.id}" class="btn btn-secondary btn-sm">Edit</a>
```

- [ ] **Step 3: Remove dead JS functions from `static/app.js`**

Delete these three functions in their entirety:

```javascript
async function openAddMeeting() {
  // ...entire function body...
}

async function openEditMeeting(id) {
  // ...entire function body...
}

async function submitMeeting(e) {
  // ...entire function body...
}
```

- [ ] **Step 4: Run the full test suite**

```
python -m pytest tests/test_api.py -v
```

Expected: all tests pass

- [ ] **Step 5: Manual verification**

```
python app.py
```

On the meetings list:
- `+ Add Meeting` navigates to `/meetings/new` (no modal)
- Clicking `Edit` on a row navigates to the meeting detail page
- Clicking the meeting title also navigates to the detail page
- Delete still works (confirm dialog, row removed)

- [ ] **Step 6: Commit**

```bash
git add templates/meetings.html static/app.js
git commit -m "feat: meetings list uses full-page navigation, removes modal"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| `/meetings/new` full-page form (title, date, company, notes) | Task 1 |
| Today's date pre-filled on new meeting | Task 1 Step 5 (`initNewMeeting`) |
| Save new meeting → redirect to detail page | Task 1 Step 5 (`saveNewMeeting`) |
| Detail page Edit button → inline edit mode (no modal) | Task 2 Steps 1–2 |
| Inline Save updates display in-place | Task 2 Step 2 (`saveMeetingEdit`) |
| Inline Cancel reverts to display mode | Task 2 Step 2 (`cancelMeetingEdit`) |
| Meetings list `+ Add Meeting` → `/meetings/new` | Task 3 Step 1 |
| Meetings list Edit button → detail page | Task 3 Step 2 |
| Remove all meeting create/edit modals | Tasks 2 and 3 |
| Existing tests still pass | Tasks 1, 2, 3 (API unchanged) |

### Gaps Found
None. The API is unchanged throughout. The attendees and action items sections on the detail page are untouched — they already work correctly and remain fully functional after saving/cancelling the inline edit.
