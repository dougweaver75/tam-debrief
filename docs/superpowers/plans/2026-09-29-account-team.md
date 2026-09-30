# Account Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-company internal account teams, managed on the company page and on a new "Account Teams" menu page grouped by company.

**Architecture:** New `account_team_members` table + REST endpoints in `app.py` (raw sqlite3, same style as company notes). One shared add/edit modal (in `base.html`) and shared row renderer/handlers in `static/app.js` are used by both the company page section and the new `/account-teams` page.

**Tech Stack:** Flask, raw sqlite3, Jinja2, vanilla JS, pytest.

Spec: `docs/superpowers/specs/2026-09-29-account-team-design.md`

## Global Constraints

- No ORM — raw `sqlite3` only.
- Roles (exact values): `account_executive`, `customer_service_manager`, `technical_account_manager`, `solutions_consultant`, `other`.
- Display labels: Account Executive, Customer Service Manager, Technical Account Manager, Solutions Consultant; Other rows display their `custom_title`.
- `custom_title` required when role = `other`; stored as `''` for any other role.
- Multiple members per role allowed; no uniqueness constraint.
- Sort order everywhere: role order (AE, CSM, TAM, SC, Other), then name case-insensitive.
- Menu page lists ALL companies (alphabetical), including those with no members, and supports inline add/edit/delete.
- Match existing conventions: `API.get/post/put/del`, `showToast`, `confirmDelete`, `openModal/closeModal`, `esc()`, `icon()`, `.interaction-item` rows, `.card`/`.section-header`.
- `migrate_db()` re-runs `schema.sql` (`CREATE TABLE IF NOT EXISTS`), so existing DBs pick up the new table automatically; no extra migration code needed.
- Run tests with `python -m pytest tests/ -v`.

---

### Task 1: Backend — table, API, tests

**Files:**
- Modify: `schema.sql` (append table)
- Modify: `app.py` (add page route `/account-teams` after the `/sanitize` route; add API section immediately before the `# ── API: meetings` section header)
- Create: `templates/account_teams.html` (minimal stub so the page route renders; fleshed out in Task 2)
- Test: `tests/test_api.py` (append)

**Interfaces:**
- Produces (used by Task 2):
  - `GET /api/companies/<id>/team` → `[member]`, ordered
  - `POST /api/companies/<id>/team` body `{role, custom_title, name, email, phone}` → 201 member
  - `PUT /api/team/<id>` same body → member
  - `DELETE /api/team/<id>` → `{ok: true}`
  - `GET /api/account-teams` → `[{id, name, members: [member]}]`, companies alphabetical (case-insensitive)
  - member = `{id, company_id, role, custom_title, name, email, phone, created_at, updated_at}`
  - page route `GET /account-teams` renders `account_teams.html`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_api.py`:

```python
# ── Account team ─────────────────────────────────────────────────────────────

def _add_member(client, coid, **kw):
    body = {'role': 'account_executive', 'name': 'Pat Doe'}
    body.update(kw)
    return client.post(f'/api/companies/{coid}/team', json=body)


def test_account_team_table_exists(client):
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert 'account_team_members' in tables


def test_team_member_crud(client):
    coid = _make_company(client)
    r = _add_member(client, coid, email='pat@us.com', phone='555-1')
    assert r.status_code == 201
    m = r.get_json()
    assert m['role'] == 'account_executive'
    assert m['name'] == 'Pat Doe'
    assert m['email'] == 'pat@us.com'
    assert m['custom_title'] == ''

    r2 = client.put(f"/api/team/{m['id']}", json={
        'role': 'technical_account_manager', 'name': 'Pat D.', 'email': '', 'phone': ''})
    assert r2.status_code == 200
    assert r2.get_json()['role'] == 'technical_account_manager'
    assert r2.get_json()['name'] == 'Pat D.'

    assert client.delete(f"/api/team/{m['id']}").status_code == 200
    assert client.get(f'/api/companies/{coid}/team').get_json() == []


def test_team_other_requires_title(client):
    coid = _make_company(client)
    assert _add_member(client, coid, role='other').status_code == 400
    assert _add_member(client, coid, role='other', custom_title='   ').status_code == 400
    r = _add_member(client, coid, role='other', custom_title='Architect')
    assert r.status_code == 201
    assert r.get_json()['custom_title'] == 'Architect'


def test_team_title_cleared_when_not_other(client):
    coid = _make_company(client)
    r = _add_member(client, coid, role='solutions_consultant', custom_title='Ignored')
    assert r.get_json()['custom_title'] == ''
    mid = _add_member(client, coid, role='other', custom_title='Architect').get_json()['id']
    r2 = client.put(f'/api/team/{mid}', json={
        'role': 'account_executive', 'name': 'Pat Doe', 'custom_title': 'Architect'})
    assert r2.get_json()['custom_title'] == ''


def test_team_validation(client):
    coid = _make_company(client)
    assert _add_member(client, coid, name='  ').status_code == 400
    assert _add_member(client, coid, role='bogus').status_code == 400
    assert _add_member(client, 999).status_code == 404
    assert client.get('/api/companies/999/team').status_code == 404
    assert client.put('/api/team/999', json={'role': 'other', 'name': 'x', 'custom_title': 't'}).status_code == 404
    assert client.delete('/api/team/999').status_code == 404


def test_team_multiple_per_role_and_ordering(client):
    coid = _make_company(client)
    _add_member(client, coid, role='other', custom_title='Architect', name='Zed')
    _add_member(client, coid, role='solutions_consultant', name='Sam')
    _add_member(client, coid, role='technical_account_manager', name='bob')
    _add_member(client, coid, role='technical_account_manager', name='Alice')
    _add_member(client, coid, role='customer_service_manager', name='Cy')
    _add_member(client, coid, role='account_executive', name='Ann')
    members = client.get(f'/api/companies/{coid}/team').get_json()
    assert [(m['role'], m['name']) for m in members] == [
        ('account_executive', 'Ann'),
        ('customer_service_manager', 'Cy'),
        ('technical_account_manager', 'Alice'),
        ('technical_account_manager', 'bob'),
        ('solutions_consultant', 'Sam'),
        ('other', 'Zed'),
    ]


def test_team_cascades_with_company(client):
    coid = _make_company(client)
    _add_member(client, coid)
    client.delete(f'/api/companies/{coid}')
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    assert conn.execute('SELECT COUNT(*) FROM account_team_members').fetchone()[0] == 0
    conn.close()


def test_account_teams_overview(client):
    b = _make_company(client, 'beta')
    a = _make_company(client, 'Acme')
    _make_company(client, 'Empty Co')
    _add_member(client, b, name='Bee')
    _add_member(client, a, role='technical_account_manager', name='Tam')
    _add_member(client, a, role='account_executive', name='Ace')
    data = client.get('/api/account-teams').get_json()
    assert [c['name'] for c in data] == ['Acme', 'beta', 'Empty Co']
    assert [m['name'] for m in data[0]['members']] == ['Ace', 'Tam']
    assert [m['name'] for m in data[1]['members']] == ['Bee']
    assert data[2]['members'] == []


def test_account_teams_page_renders(client):
    r = client.get('/account-teams')
    assert r.status_code == 200
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `python -m pytest tests/test_api.py -k "team" -v`
Expected: FAIL (404s / missing table).

- [ ] **Step 3: Append table to `schema.sql`:**

```sql

CREATE TABLE IF NOT EXISTS account_team_members (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    role         TEXT    NOT NULL
                 CHECK(role IN ('account_executive','customer_service_manager',
                                'technical_account_manager','solutions_consultant','other')),
    custom_title TEXT    DEFAULT '',
    name         TEXT    NOT NULL,
    email        TEXT    DEFAULT '',
    phone        TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
```

- [ ] **Step 4: Add page route in `app.py`** after `sanitize_page`:

```python
@app.route('/account-teams')
def account_teams_page():
    return render_template('account_teams.html')
```

Create stub `templates/account_teams.html`:

```html
{% extends 'base.html' %}
{% block title %}Account Teams — TAM Debrief{% endblock %}
{% block content %}
<div id="accountTeamsRoot"><p class="empty-state">Loading…</p></div>
{% endblock %}
```

- [ ] **Step 5: Add API section in `app.py`** immediately before the `# ── API: meetings` section header:

```python
# ── API: account team ────────────────────────────────────────────────────────

TEAM_ROLES = ('account_executive', 'customer_service_manager',
              'technical_account_manager', 'solutions_consultant', 'other')

TEAM_ORDER_SQL = (
    "CASE role WHEN 'account_executive' THEN 1 WHEN 'customer_service_manager' THEN 2 "
    "WHEN 'technical_account_manager' THEN 3 WHEN 'solutions_consultant' THEN 4 ELSE 5 END, "
    "LOWER(name), id"
)

def _team_fields(data):
    """Validate a team-member payload. Returns (fields_dict, error_message)."""
    name = (data.get('name') or '').strip()
    role = data.get('role')
    if not name:
        return None, 'name is required'
    if role not in TEAM_ROLES:
        return None, 'invalid role'
    title = (data.get('custom_title') or '').strip()
    if role == 'other':
        if not title:
            return None, 'custom_title is required for role other'
    else:
        title = ''
    return {
        'role': role, 'custom_title': title, 'name': name,
        'email': (data.get('email') or '').strip(),
        'phone': (data.get('phone') or '').strip(),
    }, None


@app.route('/api/companies/<int:coid>/team', methods=['GET'])
def api_list_team(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    rows = query(
        f'SELECT * FROM account_team_members WHERE company_id=? ORDER BY {TEAM_ORDER_SQL}',
        (coid,)
    )
    return jsonify(as_list(rows))


@app.route('/api/companies/<int:coid>/team', methods=['POST'])
def api_create_team_member(coid):
    if not query('SELECT id FROM companies WHERE id=?', (coid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    f, err = _team_fields(request.get_json(force=True) or {})
    if err:
        return jsonify({'error': err}), 400
    ts  = now_iso()
    cur = execute(
        'INSERT INTO account_team_members '
        '(company_id,role,custom_title,name,email,phone,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?)',
        (coid, f['role'], f['custom_title'], f['name'], f['email'], f['phone'], ts, ts)
    )
    return jsonify(as_dict(query('SELECT * FROM account_team_members WHERE id=?',
                                 (cur.lastrowid,), one=True))), 201


@app.route('/api/team/<int:tid>', methods=['PUT'])
def api_update_team_member(tid):
    if not query('SELECT id FROM account_team_members WHERE id=?', (tid,), one=True):
        return jsonify({'error': 'Not found'}), 404
    f, err = _team_fields(request.get_json(force=True) or {})
    if err:
        return jsonify({'error': err}), 400
    execute(
        'UPDATE account_team_members SET role=?,custom_title=?,name=?,email=?,phone=?,updated_at=? '
        'WHERE id=?',
        (f['role'], f['custom_title'], f['name'], f['email'], f['phone'], now_iso(), tid)
    )
    return jsonify(as_dict(query('SELECT * FROM account_team_members WHERE id=?', (tid,), one=True)))


@app.route('/api/team/<int:tid>', methods=['DELETE'])
def api_delete_team_member(tid):
    cur = execute('DELETE FROM account_team_members WHERE id=?', (tid,))
    if cur.rowcount == 0:
        return jsonify({'error': 'Not found'}), 404
    return jsonify({'ok': True})


@app.route('/api/account-teams', methods=['GET'])
def api_account_teams():
    companies = as_list(query('SELECT id, name FROM companies ORDER BY LOWER(name), id'))
    by_company = {c['id']: [] for c in companies}
    for m in query(f'SELECT * FROM account_team_members ORDER BY {TEAM_ORDER_SQL}'):
        by_company[m['company_id']].append(dict(m))
    for c in companies:
        c['members'] = by_company[c['id']]
    return jsonify(companies)
```

- [ ] **Step 6: Run full suite**

Run: `python -m pytest tests/ -v`
Expected: all PASS (new team tests + all existing).

- [ ] **Step 7: Commit**

```bash
git add schema.sql app.py templates/account_teams.html tests/test_api.py
git commit -m "feat: add account team table and API"
```

---

### Task 2: Frontend — shared modal, company section, menu page

**Files:**
- Modify: `templates/base.html` (sidebar item after Companies; shared modal alongside the other shared modals)
- Modify: `templates/company.html` (Account Team section + reveal in scripts block)
- Modify: `templates/account_teams.html` (full page + init call)
- Modify: `static/app.js` (new section before `// ── Dashboard`; hook into `loadCompanyDetail`)
- Modify: `CLAUDE.md` (one-line note)

**Interfaces:**
- Consumes: Task 1 endpoints exactly as listed.
- Produces (JS): `TEAM_ROLE_LABELS`, `teamRoleLabel(m)`, `renderTeamRows(members)` → html string (also registers members in `_teamById`), `openAddTeamMember(companyId, refreshFn)`, `openEditTeamMember(id)`, `deleteTeamMember(id)`, `refreshCompanyTeam()`, `initAccountTeams()`.

- [ ] **Step 1: Sidebar item** in `templates/base.html`, insert after the Companies `<li>`:

```html
      <li>
        <a href="/account-teams" title="Account Teams"
           class="nav-link {% if request.path.startswith('/account-teams') %}active{% endif %}">
          <span class="material-icons-round nav-icon">groups</span>
          <span class="nav-label">Account Teams</span>
        </a>
      </li>
```

- [ ] **Step 2: Shared modal** in `templates/base.html`. Read the file first and place it inside `<body>`, outside `<main>`, next to the existing shared `confirmModal`:

```html
  <!-- Team Member Modal (shared by company page + account teams page) -->
  <div class="modal" id="teamMemberModal">
    <div class="modal-title" id="teamMemberModalTitle">Add Team Member</div>
    <form id="teamMemberForm" onsubmit="submitTeamMember(event)">
      <input type="hidden" id="tmId">
      <input type="hidden" id="tmCompanyId">
      <div class="form-row">
        <label>Role *</label>
        <select id="tmRole" onchange="toggleTeamTitle()">
          <option value="account_executive">Account Executive</option>
          <option value="customer_service_manager">Customer Service Manager</option>
          <option value="technical_account_manager">Technical Account Manager</option>
          <option value="solutions_consultant">Solutions Consultant</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-row" id="tmTitleRow" style="display:none">
        <label>Title *</label><input type="text" id="tmTitle">
      </div>
      <div class="form-row"><label>Name *</label><input type="text" id="tmName" required></div>
      <div class="form-row-2">
        <div class="form-row"><label>Email</label><input type="email" id="tmEmail"></div>
        <div class="form-row"><label>Phone</label><input type="text" id="tmPhone"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  </div>
```

- [ ] **Step 3: Company page section** in `templates/company.html`: insert before `<div id="companyNotesSection"`:

```html
<div id="companyTeamSection" style="display:none">
  <div class="card">
    <div class="section-header">
      <div class="card-title" style="margin:0">Account Team</div>
      <button class="btn btn-primary btn-sm" onclick="openAddTeamMember(_currentCompany.id, refreshCompanyTeam)">+ Add Member</button>
    </div>
    <div id="companyTeamList"></div>
  </div>
</div>
```

In the scripts block add `document.getElementById('companyTeamSection').style.display = '';` beside the other section reveals.

- [ ] **Step 4: Menu page** — replace `templates/account_teams.html`. First read `templates/companies.html` and copy its page-header markup/classes exactly (the `page-header`/`page-title` names below are placeholders to be replaced by whatever companies.html actually uses):

```html
{% extends 'base.html' %}
{% block title %}Account Teams — TAM Debrief{% endblock %}
{% block content %}
<div class="page-header">
  <h1 class="page-title">Account Teams</h1>
</div>
<div id="accountTeamsRoot"><p class="empty-state">Loading…</p></div>
{% endblock %}
{% block scripts %}<script>initAccountTeams();</script>{% endblock %}
```

- [ ] **Step 5: JS** — insert before `// ── Dashboard ───` in `static/app.js`:

```js
// ── Account Team ──────────────────────────────────────────────────────────

const TEAM_ROLE_LABELS = {
  account_executive: 'Account Executive',
  customer_service_manager: 'Customer Service Manager',
  technical_account_manager: 'Technical Account Manager',
  solutions_consultant: 'Solutions Consultant',
  other: 'Other'
};
let _teamById = {};
let _teamRefresh = null;

function teamRoleLabel(m) {
  return m.role === 'other' ? m.custom_title : (TEAM_ROLE_LABELS[m.role] || m.role);
}

function renderTeamRows(members) {
  if (!members.length) return '<p class="empty-state">No team members yet.</p>';
  members.forEach(m => { _teamById[m.id] = m; });
  return members.map(m => {
    const contact = [m.email ? esc(m.email) : '', m.phone ? esc(m.phone) : '']
      .filter(Boolean).join(' · ');
    return `
    <div class="interaction-item">
      <div style="flex:1">
        <div class="interaction-date">${esc(teamRoleLabel(m))}</div>
        <div class="interaction-summary">${esc(m.name)}</div>
        ${contact ? `<div class="interaction-summary" style="color:var(--text-muted)">${contact}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" onclick="openEditTeamMember(${m.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeamMember(${m.id})" title="Delete">${icon('close')}</button>
      </div>
    </div>`;
  }).join('');
}

function toggleTeamTitle() {
  const isOther = document.getElementById('tmRole').value === 'other';
  document.getElementById('tmTitleRow').style.display = isOther ? '' : 'none';
  document.getElementById('tmTitle').required = isOther;
}

function openAddTeamMember(companyId, refreshFn) {
  _teamRefresh = refreshFn;
  document.getElementById('teamMemberModalTitle').textContent = 'Add Team Member';
  document.getElementById('teamMemberForm').reset();
  document.getElementById('tmId').value = '';
  document.getElementById('tmCompanyId').value = companyId;
  toggleTeamTitle();
  openModal('teamMemberModal');
}

function openEditTeamMember(id) {
  const m = _teamById[id];
  if (!m) return;
  document.getElementById('teamMemberModalTitle').textContent = 'Edit Team Member';
  document.getElementById('tmId').value = m.id;
  document.getElementById('tmCompanyId').value = m.company_id;
  document.getElementById('tmRole').value = m.role;
  document.getElementById('tmTitle').value = m.custom_title || '';
  document.getElementById('tmName').value = m.name;
  document.getElementById('tmEmail').value = m.email || '';
  document.getElementById('tmPhone').value = m.phone || '';
  toggleTeamTitle();
  openModal('teamMemberModal');
}

async function submitTeamMember(e) {
  e.preventDefault();
  const id = document.getElementById('tmId').value;
  const data = {
    role:         document.getElementById('tmRole').value,
    custom_title: document.getElementById('tmTitle').value.trim(),
    name:         document.getElementById('tmName').value.trim(),
    email:        document.getElementById('tmEmail').value.trim(),
    phone:        document.getElementById('tmPhone').value.trim(),
  };
  try {
    if (id) {
      await API.put(`/api/team/${id}`, data);
      showToast('Team member updated.');
    } else {
      await API.post(`/api/companies/${document.getElementById('tmCompanyId').value}/team`, data);
      showToast('Team member added.');
    }
    closeModal();
    if (_teamRefresh) await _teamRefresh();
  } catch (err) { showToast('Save failed.'); }
}

function deleteTeamMember(id) {
  confirmDelete('Remove this team member?', async () => {
    try {
      await API.del(`/api/team/${id}`);
      showToast('Team member removed.');
      if (_teamRefresh) await _teamRefresh();
    } catch (err) { showToast('Delete failed.'); }
  });
}

// Company page
async function refreshCompanyTeam() {
  const members = await API.get(`/api/companies/${_currentCompany.id}/team`);
  document.getElementById('companyTeamList').innerHTML = renderTeamRows(members);
}

// Account Teams page
async function refreshAccountTeams() {
  const root = document.getElementById('accountTeamsRoot');
  try {
    const companies = await API.get('/api/account-teams');
    if (!companies.length) {
      root.innerHTML = '<p class="empty-state">No companies yet. Add a company first.</p>';
      return;
    }
    root.innerHTML = companies.map(c => `
      <div class="card">
        <div class="section-header">
          <div class="card-title" style="margin:0"><a href="/companies/${c.id}" class="table-link">${esc(c.name)}</a></div>
          <button class="btn btn-primary btn-sm" onclick="openAddTeamMember(${c.id}, refreshAccountTeams)">+ Add Member</button>
        </div>
        ${renderTeamRows(c.members)}
      </div>`).join('');
  } catch (err) {
    root.innerHTML = '<p class="empty-state">Failed to load account teams.</p>';
  }
}

function initAccountTeams() {
  _teamRefresh = refreshAccountTeams;
  refreshAccountTeams();
}
```

- [ ] **Step 6: Hook into `loadCompanyDetail`.** Add `API.get(`/api/companies/${companyId}/team`)` as a 7th entry of the `Promise.all` (destructure it as `team`), and after `renderCompanyTimeline(timeline);` add:

```js
    document.getElementById('companyTeamList').innerHTML = renderTeamRows(team);
```

- [ ] **Step 7: Verify in the browser.** Check for orphaned Flask processes on :5000 first (see CLAUDE.md), then start the app. Confirm: sidebar shows "Account Teams"; on a company page add an AE, two TAMs, and an Other (Title field appears only for Other and is required); rows appear in role order; edit and delete work; `/account-teams` lists all companies alphabetically, empty ones show "No team members yet." plus an Add button; add/edit/delete on the menu page work and re-render; company name links to the company page; no console errors.

- [ ] **Step 8: Run full test suite**

Run: `python -m pytest tests/ -v`
Expected: all PASS.

- [ ] **Step 9: Update `CLAUDE.md`** — under "Key behaviors" add: `- **Account teams**: internal team per company (`account_team_members` table). Managed on the company page and at `/account-teams`; both share one add/edit modal (`teamMemberModal` in `base.html`) and `renderTeamRows` in `app.js`. Role `other` requires a `custom_title`.`

- [ ] **Step 10: Commit**

```bash
git add templates static CLAUDE.md
git commit -m "feat: add account team UI on company page and Account Teams menu page"
```
