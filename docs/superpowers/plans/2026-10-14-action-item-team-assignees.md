# Action Items: Team Member Assignees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an action item be assigned to an account team member (one of the meeting's team attendees) as an alternative to a contact.

**Architecture:** A second nullable FK column `action_items.assigned_team_member_id` sits beside the existing `assigned_to` (contact). The API accepts exactly one assignee. List queries LEFT JOIN `account_team_members` and return `team_member_name/role/custom_title`. The UI replaces the contact-only assignee dropdown with a grouped one (Attendees / Account Team) using `c:<id>` / `t:<id>` option values.

**Tech Stack:** Flask + raw `sqlite3`, Jinja2, vanilla JS (`static/app.js`), pytest.

## Global Constraints

- No ORM; raw `sqlite3` only (`ccrm/CLAUDE.md`).
- `assigned_to` (contact) is unchanged. An action item has at most one assignee: sending both `assigned_to` and `assigned_team_member_id` is a 400.
- A team-member assignee must be one of the meeting's team attendees (`meeting_team_attendees`), otherwise 400.
- Removing a team attendee from a meeting leaves existing assignments alone (matches contacts). Changing the meeting's company clears assignments to team members of other companies. Deleting a team member nulls the assignment (FK `ON DELETE SET NULL`).
- Contact page action-item list, and the Redact page, are unchanged (contact-only).
- Follow existing patterns (shared modals, `API.*` helpers, `esc()` on all interpolated strings).
- Existing tests must keep passing. Helpers already in `tests/test_api.py`: `_make_company(client, name)`, `_make_meeting(client)`, `_make_contact(client)`, `_meeting_for(client, coid, title=...)`, `_team(client, coid, name, role, **kw)`.

---

### Task 1: Backend — column, validation, queries, cleanup, tests

**Files:**
- Modify: `schema.sql` (`action_items` table)
- Modify: `app.py` (`migrate_db`; new `_assignee_fields` helper; `api_create_action_item`, `api_update_action_item`; `api_update_meeting`; the meeting, company and dashboard action-item queries)
- Test: `tests/test_api.py`

**Interfaces:**
- Produces: column `action_items.assigned_team_member_id`; action-item JSON from `GET /api/meetings/<id>/action_items`, `GET /api/companies/<id>/action-items` and `GET /api/dashboard` (`action_items`) additionally carries `assigned_team_member_id`, `team_member_name`, `team_member_role`, `team_member_custom_title` (null when the assignee is a contact or none). `POST /api/meetings/<mid>/action_items` and `PUT /api/action_items/<aid>` accept `assigned_team_member_id` (int or null).

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_api.py`:

```python
# ── Action items assigned to team members ────────────────────────────────────

def _team_attendee(client, coid, name='Zed', role='solutions_consultant'):
    mid = _meeting_for(client, coid)
    t = _team(client, coid, name, role)
    client.post(f'/api/meetings/{mid}/team-attendees', json={'team_member_id': t})
    return mid, t


def test_action_item_assign_team_attendee(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid)
    r = client.post(f'/api/meetings/{mid}/action_items',
                    json={'description': 'Send deck', 'assigned_team_member_id': t})
    assert r.status_code == 201
    assert r.get_json()['assigned_team_member_id'] == t
    row = client.get(f'/api/meetings/{mid}/action_items').get_json()[0]
    assert row['team_member_name'] == 'Zed'
    assert row['team_member_role'] == 'solutions_consultant'
    assert row['assigned_to'] is None


def test_action_item_team_member_must_be_meeting_attendee(client):
    coid = _make_company(client)
    mid = _meeting_for(client, coid)
    t = _team(client, coid)  # on the company but not added to the meeting
    r = client.post(f'/api/meetings/{mid}/action_items',
                    json={'description': 'X', 'assigned_team_member_id': t})
    assert r.status_code == 400


def test_action_item_rejects_contact_and_team_member_together(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid)
    cid = _make_contact(client)
    r = client.post(f'/api/meetings/{mid}/action_items',
                    json={'description': 'X', 'assigned_to': cid, 'assigned_team_member_id': t})
    assert r.status_code == 400


def test_action_item_update_switches_assignee(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid)
    cid = _make_contact(client)
    aid = client.post(f'/api/meetings/{mid}/action_items',
                      json={'description': 'X', 'assigned_to': cid}).get_json()['id']
    r = client.put(f'/api/action_items/{aid}',
                   json={'description': 'X', 'assigned_team_member_id': t})
    assert r.status_code == 200
    assert r.get_json()['assigned_team_member_id'] == t
    assert r.get_json()['assigned_to'] is None
    r = client.put(f'/api/action_items/{aid}', json={'description': 'X', 'assigned_to': cid})
    assert r.get_json()['assigned_to'] == cid
    assert r.get_json()['assigned_team_member_id'] is None
    bad = client.put(f'/api/action_items/{aid}',
                     json={'description': 'X', 'assigned_team_member_id': 99999})
    assert bad.status_code == 400


def test_action_item_assignment_nulled_when_team_member_deleted(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid)
    client.post(f'/api/meetings/{mid}/action_items',
                json={'description': 'X', 'assigned_team_member_id': t})
    client.delete(f'/api/team/{t}')
    row = client.get(f'/api/meetings/{mid}/action_items').get_json()[0]
    assert row['assigned_team_member_id'] is None
    assert row['team_member_name'] is None


def test_action_item_team_assignment_cleared_when_company_changes(client):
    co1 = _make_company(client, 'One Co')
    co2 = _make_company(client, 'Two Co')
    mid, t = _team_attendee(client, co1)
    client.post(f'/api/meetings/{mid}/action_items',
                json={'description': 'X', 'assigned_team_member_id': t})
    base = {'title': 'Co Meeting', 'meeting_date': '2026-06-01', 'notes': ''}
    client.put(f'/api/meetings/{mid}', json=dict(base, company_id=co1))
    assert client.get(f'/api/meetings/{mid}/action_items').get_json()[0]['assigned_team_member_id'] == t
    client.put(f'/api/meetings/{mid}', json=dict(base, company_id=co2))
    assert client.get(f'/api/meetings/{mid}/action_items').get_json()[0]['assigned_team_member_id'] is None


def test_removing_team_attendee_keeps_assignment(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid)
    client.post(f'/api/meetings/{mid}/action_items',
                json={'description': 'X', 'assigned_team_member_id': t})
    client.delete(f'/api/meetings/{mid}/team-attendees/{t}')
    row = client.get(f'/api/meetings/{mid}/action_items').get_json()[0]
    assert row['assigned_team_member_id'] == t
    assert row['team_member_name'] == 'Zed'


def test_company_and_dashboard_action_items_include_team_member_name(client):
    coid = _make_company(client)
    mid, t = _team_attendee(client, coid, 'Zed')
    client.post(f'/api/meetings/{mid}/action_items',
                json={'description': 'X', 'assigned_team_member_id': t})
    co_rows = client.get(f'/api/companies/{coid}/action-items').get_json()
    assert co_rows[0]['team_member_name'] == 'Zed'
    dash = client.get('/api/dashboard').get_json()
    assert dash['action_items'][0]['team_member_name'] == 'Zed'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_api.py -k "action_item and (team or assignee or assignment)" -q`
Expected: FAIL (`assigned_team_member_id` not accepted/returned).

- [ ] **Step 3: Schema and migration**

In `schema.sql`, add the column to the `action_items` table, after `assigned_to`:

```sql
    assigned_to  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    assigned_team_member_id INTEGER REFERENCES account_team_members(id) ON DELETE SET NULL,
```

In `app.py` `migrate_db()`, right after the existing `due_date_text` guard:

```python
    if 'assigned_team_member_id' not in cols_ai:
        db.execute("ALTER TABLE action_items ADD COLUMN assigned_team_member_id INTEGER "
                   "REFERENCES account_team_members(id) ON DELETE SET NULL")
```

- [ ] **Step 4: Validation helper and create/update routes**

In `app.py`, add this helper immediately above `api_list_action_items` (in the "API: action items" section):

```python
def _assignee_fields(data, meeting_id):
    """Return ((contact_id, team_member_id), error). At most one assignee; a team
    member must be one of the meeting's team attendees."""
    contact_id = data.get('assigned_to') or None
    team_id    = data.get('assigned_team_member_id') or None
    if contact_id and team_id:
        return None, 'assign to a contact or a team member, not both'
    if team_id is not None:
        if not isinstance(team_id, int) or isinstance(team_id, bool):
            return None, 'assigned_team_member_id must be an integer'
        attending = query(
            'SELECT 1 FROM meeting_team_attendees WHERE meeting_id=? AND team_member_id=?',
            (meeting_id, team_id), one=True)
        if not attending:
            return None, 'team member is not a team attendee of this meeting'
    return (contact_id, team_id), None
```

Replace the body of `api_create_action_item` from `ts = now_iso()` through the INSERT with:

```python
    fields, err = _assignee_fields(data, mid)
    if err:
        return jsonify({'error': err}), 400
    contact_id, team_id = fields
    ts  = now_iso()
    cur = execute(
        'INSERT INTO action_items (meeting_id,assigned_to,assigned_team_member_id,description,'
        'due_date,due_date_text,completed,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,0,?,?)',
        (mid, contact_id, team_id, description,
         data.get('due_date') or None, data.get('due_date_text') or None, ts, ts)
    )
```

In `api_update_action_item`, change the existence check to also fetch the meeting, and replace the UPDATE:

```python
    item = query('SELECT id, meeting_id FROM action_items WHERE id=?', (aid,), one=True)
    if not item:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    description = data.get('description', '').strip()
    if not description:
        return jsonify({'error': 'description is required'}), 400
    fields, err = _assignee_fields(data, item['meeting_id'])
    if err:
        return jsonify({'error': err}), 400
    contact_id, team_id = fields
    execute(
        'UPDATE action_items SET description=?,due_date=?,due_date_text=?,assigned_to=?,'
        'assigned_team_member_id=?,updated_at=? WHERE id=?',
        (description, data.get('due_date') or None, data.get('due_date_text') or None,
         contact_id, team_id, now_iso(), aid)
    )
```

(Keep the existing `return jsonify(as_dict(query('SELECT * FROM action_items ...')))` line.)

- [ ] **Step 5: Company-change cleanup**

In `api_update_meeting`, directly after the existing `DELETE FROM meeting_team_attendees ...` statement, add:

```python
    execute(
        'UPDATE action_items SET assigned_team_member_id=NULL '
        'WHERE meeting_id=? AND assigned_team_member_id IS NOT NULL AND assigned_team_member_id NOT IN '
        '(SELECT id FROM account_team_members WHERE company_id=?)',
        (mid, data.get('company_id') or None)
    )
```

- [ ] **Step 6: Return the team member in the three list queries**

Meeting list (`api_list_action_items`):

```python
    rows = query(
        'SELECT a.*, c.first_name, c.last_name, '
        't.name AS team_member_name, t.role AS team_member_role, '
        't.custom_title AS team_member_custom_title '
        'FROM action_items a '
        'LEFT JOIN contacts c ON c.id=a.assigned_to '
        'LEFT JOIN account_team_members t ON t.id=a.assigned_team_member_id '
        'WHERE a.meeting_id=? '
        'ORDER BY CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END ASC, a.due_date ASC',
        (mid,)
    )
```

Company list (`api_company_action_items`): add to the SELECT list
`ai.assigned_team_member_id, t.name AS team_member_name, t.role AS team_member_role, t.custom_title AS team_member_custom_title`
and add `LEFT JOIN account_team_members t ON t.id = ai.assigned_team_member_id` after the contacts join.

Dashboard (`api_dashboard`, the `action_items = query(...)`): add
`, t.name AS team_member_name, t.role AS team_member_role, t.custom_title AS team_member_custom_title`
to the SELECT list and `'LEFT JOIN account_team_members t ON t.id=a.assigned_team_member_id '` after the contacts join.

- [ ] **Step 7: Run tests**

Run: `python -m pytest tests/ -q`
Expected: all pass (existing + 8 new).

- [ ] **Step 8: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: allow action items to be assigned to account team members"
```

---

### Task 2: Frontend — grouped assignee dropdown, rendering, docs

**Files:**
- Modify: `static/app.js` (assignee dropdown helper and its 3 call sites, submit payloads, three render sites)
- Modify: `CLAUDE.md` (project notes bullet)

**Interfaces:**
- Consumes: Task 1 API fields (`assigned_team_member_id`, `team_member_name`, `team_member_role`, `team_member_custom_title`); `GET /api/meetings/<id>/team-attendees` (returns members with `id, name, role, custom_title`); existing `teamRoleLabel(m)` (`m.role`, `m.custom_title`).
- Produces: `populateAssigneeDropdown(selectId, selected, meetingId)` where `selected` is `'c:<id>'`, `'t:<id>'` or null (replaces `populateAttendeeDropdown`); `assigneePayload(value)` → `{assigned_to, assigned_team_member_id}`; `teamAssigneeHtml(a)`.

- [ ] **Step 1: Replace the dropdown helper**

In `static/app.js`, replace `populateAttendeeDropdown` (near line 192) with:

```js
async function populateAssigneeDropdown(selectId, selected, meetingId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const [attendees, team] = await Promise.all([
      API.get(`/api/meetings/${meetingId}/attendees`),
      API.get(`/api/meetings/${meetingId}/team-attendees`)
    ]);
    const opt = (v, label) =>
      `<option value="${v}"${v === selected ? ' selected' : ''}>${label}</option>`;
    let html = '<option value="">— Unassigned —</option>';
    if (attendees.length) {
      html += '<optgroup label="Attendees">' +
        attendees.map(c => opt(`c:${c.id}`, `${esc(c.last_name)}, ${esc(c.first_name)}`)).join('') +
        '</optgroup>';
    }
    if (team.length) {
      html += '<optgroup label="Account Team">' +
        team.map(t => opt(`t:${t.id}`, `${esc(t.name)} — ${esc(teamRoleLabel(t))}`)).join('') +
        '</optgroup>';
    }
    sel.innerHTML = html;
  } catch (e) { /* leave dropdown */ }
}

function assigneePayload(v) {
  if (v && v.startsWith('t:')) return { assigned_to: null, assigned_team_member_id: parseInt(v.slice(2), 10) };
  if (v && v.startsWith('c:')) return { assigned_to: parseInt(v.slice(2), 10), assigned_team_member_id: null };
  return { assigned_to: null, assigned_team_member_id: null };
}

function teamAssigneeHtml(a) {
  if (!a.team_member_name) return '';
  const role = teamRoleLabel({ role: a.team_member_role, custom_title: a.team_member_custom_title });
  return `<span>${icon('badge', '13px')} ${esc(a.team_member_name)}` +
         `${role ? ` <span style="color:var(--text-muted)">· ${esc(role)}</span>` : ''}</span>`;
}
```

- [ ] **Step 2: Update the three dropdown call sites and payloads**

- Extract modal: `populateAttendeeDropdown(\`extractAssignee_${i}\`, null, _currentMeeting.id)` → `populateAssigneeDropdown(...)`.
- `openAddActionItem`: `populateAttendeeDropdown('aiAssignedTo', null, _currentMeeting.id)` → `populateAssigneeDropdown('aiAssignedTo', null, _currentMeeting.id)`.
- `openEditActionItem`: replace the dropdown line with:
  ```js
  const sel = a.assigned_team_member_id ? `t:${a.assigned_team_member_id}`
            : (a.assigned_to ? `c:${a.assigned_to}` : null);
  await populateAssigneeDropdown('aiAssignedTo', sel, _currentMeeting.id);
  ```
- `submitActionItem`: replace `assigned_to: document.getElementById('aiAssignedTo').value || null,` with `...assigneePayload(document.getElementById('aiAssignedTo').value),` (inside the `data` object literal).
- `submitExtractedItems`: replace `assigned_to: document.getElementById(\`extractAssignee_${i}\`).value || null,` with `...assigneePayload(document.getElementById(\`extractAssignee_${i}\`).value),`.

Then `grep -n "populateAttendeeDropdown" static/app.js` must return nothing.

- [ ] **Step 3: Show team assignees in the three lists**

In each of these, add `${teamAssigneeHtml(a)}` immediately after the existing contact-name span in the `ai-meta` block:
- `renderActionItems` (meeting page)
- `renderCompanyActionItems` (company page)
- the `dashActionItems` rendering in `renderDashboard`

(A row has either a contact name or a team member name, never both, so no extra conditionals are needed.)

- [ ] **Step 4: Update project notes**

In `CLAUDE.md`, in the "Meeting attendees" bullet, replace "Action-item assignment and Redact remain contact-only." with: "Action items can be assigned to a contact (`assigned_to`) or to one of the meeting's team attendees (`assigned_team_member_id`), never both; the assignee dropdown groups them as Attendees / Account Team. Redact remains contact-only."

- [ ] **Step 5: Verify**

Run `node --check static/app.js` and `python -m pytest tests/ -q` (both must pass). Then start the app (`preview_start` with name `ccrm`), and in the browser using a throwaway company/contact/meeting/team member that you delete afterward: add the team member as a meeting team attendee, open Add Action Item and confirm the dropdown shows an "Account Team" group, assign the team member, save, and confirm the name and role appear in the meeting's action-item list, the company page's list, and the dashboard's Open Action Items. Edit the item and confirm the team member is pre-selected; switch it to a contact and confirm the team name disappears. Check the console for errors. Delete all test data and stop the server.

- [ ] **Step 6: Commit**

```bash
git add static/app.js CLAUDE.md
git commit -m "feat: assign action items to account team members in the UI"
```
