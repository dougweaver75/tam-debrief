# Account Team Members as Meeting Attendees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a meeting's company's account team members be added as meeting attendees, without creating contact/company records.

**Architecture:** New join table `meeting_team_attendees` + three API routes; existing `meeting_attendees` and `GET /api/meetings/<id>/attendees` stay contacts-only. The meeting page dropdown gains an "Account Team" optgroup and the attendee list shows team members with a badge.

**Tech Stack:** Flask, raw sqlite3, Jinja2, vanilla JS, pytest.

Spec: `docs/superpowers/specs/2026-10-02-team-meeting-attendees-design.md`

## Global Constraints

- No ORM — raw `sqlite3` only.
- Do NOT change `meeting_attendees`, `GET /api/meetings/<id>/attendees`, action-item assignment, or the Redact/sanitize context (all stay contact-only).
- A team attendee must belong to the meeting's company; a meeting with no company can have none.
- Match existing conventions: `API.get/post/put/del`, `showToast`, `confirmDelete`, `esc()`, `icon()`, `badgeHtml`, `.interaction-item`.
- Reuse the existing `TEAM_ORDER_SQL`, `teamRoleLabel(m)` helpers (account team feature).
- Run tests with `python -m pytest tests/ -v`.

---

### Task 1: Backend — join table, API, tests

**Files:**
- Modify: `schema.sql` (append table)
- Modify: `app.py` (new routes after `api_remove_attendee`; `api_update_meeting`; `api_company_meetings`)
- Test: `tests/test_api.py` (append)

**Interfaces:**
- Produces (used by Task 2):
  - `GET /api/meetings/<id>/team-attendees` → `[{id, company_id, role, custom_title, name, email, phone, created_at, updated_at}]`
  - `POST /api/meetings/<id>/team-attendees` body `{team_member_id}` → 201 `{ok:true}`
  - `DELETE /api/meetings/<id>/team-attendees/<tid>` → `{ok:true}`
  - Meeting objects from `GET/PUT /api/meetings/<id>` already include `company_id` and `company_name` (unchanged).

- [ ] **Step 1: Write failing tests** — append to `tests/test_api.py`:

```python
# ── Team members as meeting attendees ────────────────────────────────────────

def _meeting_for(client, coid, title='Co Meeting'):
    r = client.post('/api/meetings', json={'title': title, 'meeting_date': '2026-06-01',
                                           'company_id': coid})
    return r.get_json()['id']


def _team(client, coid, name='Pat Doe', role='account_executive', **kw):
    body = {'role': role, 'name': name}
    body.update(kw)
    return client.post(f'/api/companies/{coid}/team', json=body).get_json()['id']


def test_team_attendee_add_list_remove(client):
    coid = _make_company(client)
    mid = _meeting_for(client, coid)
    t1 = _team(client, coid, 'Zed', 'solutions_consultant')
    t2 = _team(client, coid, 'Amy', 'account_executive')
    assert client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t1}).status_code == 201
    assert client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t2}).status_code == 201
    # idempotent
    assert client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t1}).status_code == 201
    rows = client.get(f'/api/meetings/{mid}/team-attendees').get_json()
    assert [r['id'] for r in rows] == [t2, t1]          # role order: AE before SC
    assert rows[0]['name'] == 'Amy' and rows[0]['role'] == 'account_executive'
    assert client.delete(f'/api/meetings/{mid}/team-attendees/{t1}').status_code == 200
    assert [r['id'] for r in client.get(f'/api/meetings/{mid}/team-attendees').get_json()] == [t2]
    assert client.delete(f'/api/meetings/{mid}/team-attendees/{t1}').status_code == 404


def test_team_attendee_validation(client):
    co1 = _make_company(client, 'One Co')
    co2 = _make_company(client, 'Two Co')
    mid = _meeting_for(client, co1)
    other = _team(client, co2, 'Elsewhere')
    mine = _team(client, co1, 'Here')
    url = f'/api/meetings/{mid}/team-attendees'
    assert client.post(url, json={'team_member_id': other}).status_code == 400   # wrong company
    assert client.post(url, json={'team_member_id': 999}).status_code == 400     # unknown
    assert client.post(url, json={'team_member_id': 'x'}).status_code == 400     # not an int
    assert client.post(url, json={}).status_code == 400
    assert client.post('/api/meetings/999/team-attendees', json={'team_member_id': mine}).status_code == 404
    assert client.get('/api/meetings/999/team-attendees').status_code == 404
    nocompany = _make_meeting(client)
    assert client.post(f'/api/meetings/{nocompany}/team-attendees',
                       json={'team_member_id': mine}).status_code == 400
    assert client.get(url).get_json() == []


def test_team_attendee_cascade_on_team_member_delete(client):
    coid = _make_company(client)
    mid = _meeting_for(client, coid)
    t = _team(client, coid)
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t})
    client.delete(f'/api/team/{t}')
    assert client.get(f'/api/meetings/{mid}/team-attendees').get_json() == []


def test_team_attendees_dropped_when_company_changes(client):
    co1 = _make_company(client, 'One Co')
    co2 = _make_company(client, 'Two Co')
    mid = _meeting_for(client, co1)
    t = _team(client, co1)
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t})
    base = {'title': 'Co Meeting', 'meeting_date': '2026-06-01', 'notes': ''}
    # same company: kept
    client.put(f'/api/meetings/{mid}', json=dict(base, company_id=co1))
    assert len(client.get(f'/api/meetings/{mid}/team-attendees').get_json()) == 1
    # different company: dropped
    client.put(f'/api/meetings/{mid}', json=dict(base, company_id=co2))
    assert client.get(f'/api/meetings/{mid}/team-attendees').get_json() == []
    # cleared company: dropped too
    co3_member = _team(client, co2, 'Two Member')
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': co3_member})
    client.put(f'/api/meetings/{mid}', json=dict(base, company_id=None))
    assert client.get(f'/api/meetings/{mid}/team-attendees').get_json() == []


def test_company_meetings_attendee_count_includes_team(client):
    coid = _make_company(client)
    mid = _meeting_for(client, coid)
    cid = _make_contact(client)
    client.post(f'/api/meetings/{mid}/attendees', json={'contact_id': cid})
    t = _team(client, coid)
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t})
    rows = client.get(f'/api/companies/{coid}/meetings').get_json()
    assert rows[0]['attendee_count'] == 2


def test_contact_attendees_endpoint_excludes_team(client):
    coid = _make_company(client)
    mid = _meeting_for(client, coid)
    t = _team(client, coid)
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t})
    assert client.get(f'/api/meetings/{mid}/attendees').get_json() == []
```

- [ ] **Step 2: Run, confirm failure**

Run: `python -m pytest tests/test_api.py -v -k "team_attendee or attendee_count_includes or attendees_endpoint_excludes"`
Expected: FAIL (404s / missing table).

- [ ] **Step 3: Schema** — append to `schema.sql`:

```sql

CREATE TABLE IF NOT EXISTS meeting_team_attendees (
    meeting_id     INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    team_member_id INTEGER NOT NULL REFERENCES account_team_members(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, team_member_id)
);
```

- [ ] **Step 4: Routes** — in `app.py`, directly after `api_remove_attendee` add:

```python
@app.route('/api/meetings/<int:mid>/team-attendees', methods=['GET'])
def api_list_team_attendees(mid):
    if not query('SELECT id FROM meetings WHERE id=?', (mid,), one=True):
        return jsonify({'error': 'Meeting not found'}), 404
    rows = query(
        'SELECT t.* FROM account_team_members t '
        'JOIN meeting_team_attendees mta ON mta.team_member_id = t.id '
        f'WHERE mta.meeting_id=? ORDER BY {TEAM_ORDER_SQL}',
        (mid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/meetings/<int:mid>/team-attendees', methods=['POST'])
def api_add_team_attendee(mid):
    meeting = query('SELECT id, company_id FROM meetings WHERE id=?', (mid,), one=True)
    if not meeting:
        return jsonify({'error': 'Meeting not found'}), 404
    data = request.get_json(force=True) or {}
    tid = data.get('team_member_id')
    if not isinstance(tid, int) or isinstance(tid, bool):
        return jsonify({'error': 'team_member_id must be an integer'}), 400
    member = query('SELECT id, company_id FROM account_team_members WHERE id=?', (tid,), one=True)
    if not member:
        return jsonify({'error': 'unknown team member'}), 400
    if meeting['company_id'] is None or member['company_id'] != meeting['company_id']:
        return jsonify({'error': "team member does not belong to the meeting's company"}), 400
    execute('INSERT OR IGNORE INTO meeting_team_attendees (meeting_id, team_member_id) VALUES (?,?)',
            (mid, tid))
    return jsonify({'ok': True}), 201


@app.route('/api/meetings/<int:mid>/team-attendees/<int:tid>', methods=['DELETE'])
def api_remove_team_attendee(mid, tid):
    cur = execute('DELETE FROM meeting_team_attendees WHERE meeting_id=? AND team_member_id=?',
                  (mid, tid))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})
```

`TEAM_ORDER_SQL` is defined later in the file (module level, above the account-team routes); it is only used at request time, so the order of definition does not matter, but confirm it is a module-level name.

- [ ] **Step 5: Company change cleanup** — in `api_update_meeting`, immediately after the `execute('UPDATE meetings SET ...')` call and before the `return`, add:

```python
    # Team attendees must belong to the meeting's (new) company.
    execute(
        'DELETE FROM meeting_team_attendees WHERE meeting_id=? AND team_member_id NOT IN '
        '(SELECT id FROM account_team_members WHERE company_id=?)',
        (mid, data.get('company_id') or None)
    )
```

(With a NULL company the subquery returns no rows, so all team attendees are removed.)

- [ ] **Step 6: attendee_count** — in `api_company_meetings` replace the query with:

```python
    rows = query('''
        SELECT m.id, m.title, m.meeting_date,
               (SELECT COUNT(*) FROM meeting_attendees      WHERE meeting_id = m.id)
             + (SELECT COUNT(*) FROM meeting_team_attendees WHERE meeting_id = m.id) AS attendee_count
        FROM meetings m
        WHERE m.company_id = ?
        ORDER BY m.meeting_date DESC
    ''', (coid,))
```

- [ ] **Step 7: Run full suite**

Run: `python -m pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: team members as meeting attendees (join table + API)"
```

---

### Task 2: Meeting page UI

**Files:**
- Modify: `static/app.js` (`renderAttendeesWithDropdown`, `addAttendee`, add `removeTeamAttendee`, `saveMeetingEdit`)
- Modify: `CLAUDE.md` (one-line note)

**Interfaces:**
- Consumes: Task 1 endpoints exactly as listed; existing `teamRoleLabel(m)`, `badgeHtml(cls, text)`, `_currentMeeting` (has `id`, `company_id`, `company_name`).
- Produces: none.

- [ ] **Step 1: Read first.** Read `renderAttendeesWithDropdown`, `addAttendee`, `removeAttendee`, `submitNewPerson`, `saveMeetingEdit` in `static/app.js`, and check `static/style.css` for an existing badge class suitable for an "Account Team" badge (e.g. `.badge-other`); use an existing class, do not add new CSS unless none fits.

- [ ] **Step 2: Replace `renderAttendeesWithDropdown`** with:

```js
async function renderAttendeesWithDropdown(meetingId, attendees) {
  let teamAttendees = [];
  let companyTeam = [];
  try {
    teamAttendees = await API.get(`/api/meetings/${meetingId}/team-attendees`);
    if (_currentMeeting && _currentMeeting.company_id) {
      companyTeam = await API.get(`/api/companies/${_currentMeeting.company_id}/team`);
    }
  } catch (e) {}

  const attending_ids = new Set(attendees.map(a => a.id));
  const attendingTeam = new Set(teamAttendees.map(t => t.id));
  try {
    const all = await API.get('/api/contacts');
    const available = all.filter(c => !attending_ids.has(c.id));
    const teamAvail = companyTeam.filter(t => !attendingTeam.has(t.id));
    const sel = document.getElementById('attendeeSelect');
    if (sel) {
      sel.innerHTML = '<option value="">— Add attendee —</option>' +
        available.map(c => `<option value="c:${c.id}">${esc(c.last_name)}, ${esc(c.first_name)}</option>`).join('') +
        (teamAvail.length
          ? `<optgroup label="Account Team — ${esc(_currentMeeting.company_name || 'Company')}">` +
            teamAvail.map(t => `<option value="t:${t.id}">${esc(t.name)} — ${esc(teamRoleLabel(t))}</option>`).join('') +
            '</optgroup>'
          : '');
    }
  } catch (e) {}

  const el = document.getElementById('attendeesList');
  if (!el) return;
  if (!attendees.length && !teamAttendees.length) {
    el.innerHTML = '<p class="empty-state">No attendees yet.</p>';
    return;
  }
  const contactRows = attendees.map(c => `
    <div class="interaction-item">
      <div style="flex:1">
        <a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a>
        ${c.title ? `<span style="color:var(--text-muted);margin-left:8px">${esc(c.title)}</span>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeAttendee(${c.id})" title="Remove">${icon('close')}</button>
    </div>
  `).join('');
  const teamRows = teamAttendees.map(t => `
    <div class="interaction-item">
      <div style="flex:1">
        ${esc(t.name)}
        ${badgeHtml('other', 'Account Team')}
        <span style="color:var(--text-muted);margin-left:8px">${esc(teamRoleLabel(t))}</span>
      </div>
      <button class="btn btn-danger btn-sm" onclick="removeTeamAttendee(${t.id})" title="Remove">${icon('close')}</button>
    </div>
  `).join('');
  el.innerHTML = contactRows + teamRows;
}
```

(If `'other'` is not a suitable existing badge class per Step 1, substitute the best existing one.)

- [ ] **Step 3: Replace `addAttendee`** and add `removeTeamAttendee`:

```js
async function addAttendee() {
  const sel = document.getElementById('attendeeSelect');
  const val = sel?.value;
  if (!val) return;
  const [kind, rawId] = val.split(':');
  const id = parseInt(rawId, 10);
  try {
    if (kind === 't') {
      await API.post(`/api/meetings/${_currentMeeting.id}/team-attendees`, { team_member_id: id });
    } else {
      await API.post(`/api/meetings/${_currentMeeting.id}/attendees`, { contact_id: id });
    }
    showToast('Attendee added.');
    const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
    await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
  } catch (e) { showToast('Failed to add attendee.'); }
}

function removeTeamAttendee(teamId) {
  confirmDelete('Remove this attendee from the meeting?', async () => {
    try {
      await API.del(`/api/meetings/${_currentMeeting.id}/team-attendees/${teamId}`);
      showToast('Attendee removed.');
      const attendees = await API.get(`/api/meetings/${_currentMeeting.id}/attendees`);
      await renderAttendeesWithDropdown(_currentMeeting.id, attendees);
    } catch (e) { showToast('Failed to remove attendee.'); }
  });
}
```

- [ ] **Step 4: Refresh after meeting save.** In `saveMeetingEdit`, inside the `try`, directly after `renderMeetingDetail(updated, false);` add:

```js
    const attendees = await API.get(`/api/meetings/${updated.id}/attendees`);
    await renderAttendeesWithDropdown(updated.id, attendees);
```

(The server drops team attendees that no longer match the company; this re-render reflects that and rebuilds the dropdown for the new company.)

- [ ] **Step 5: Verify in browser.** Check for orphaned Flask processes on :5000 (CLAUDE.md), start the app (preview_start name "ccrm"). The app uses the real `ccrm.db` (no schema migration risk: only a new table is added). Use the existing data: Big Top Inc (company 4) has team members Doug Weaver (TAM) and Bill Todd (AE), and meeting 7 "Big Top Kickoff" belongs to it. Confirm on `/meetings/7`: the dropdown has an "Account Team — Big Top Inc" group; add one team member → appears in the list with the "Account Team" badge and role, and disappears from the dropdown; add a regular contact too; remove the team member → returns to the dropdown; change the meeting's company via Edit → Save → the team attendee is dropped and the dropdown group updates (or disappears for a company with no team); the action item "Assigned to" dropdown does NOT list team members; a meeting with no company (or Kickoff Meeting for Acme Corp, which has no team) shows no Account Team group; no console errors. IMPORTANT: leave real data as you found it — remove any attendees you added and restore any meeting company you changed (note the original values first; ideally do the company-change test on a temporary meeting you create and delete afterward). Do not commit any .db file.

- [ ] **Step 6: Run tests, update CLAUDE.md, commit**

Run: `python -m pytest tests/ -v` (expect all PASS). In `CLAUDE.md` under "Key behaviors" add: `- **Meeting attendees** are contacts (`meeting_attendees`) plus, optionally, the meeting company's account team members (`meeting_team_attendees`, API `/api/meetings/<id>/team-attendees`). Team attendees are dropped if the meeting's company changes. Action-item assignment and Redact remain contact-only.` Then:

```bash
git add static/app.js CLAUDE.md
git commit -m "feat: add account team members as meeting attendees in the meeting page"
```
