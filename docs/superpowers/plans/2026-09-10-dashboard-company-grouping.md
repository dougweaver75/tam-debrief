# Dashboard Company Shortcuts + Company Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add A–Z company chips to the dashboard and group the contacts and meetings lists by company, all client-side.

**Architecture:** Pure frontend changes. Existing APIs already return `company_name`/`company_id` on contact and meeting rows and a name-sorted company list from `/api/companies`. Work is confined to `templates/dashboard.html`, `static/app.js`, and `static/style.css`. A shared `groupByCompany()` helper does the bucketing for both lists.

**Tech Stack:** Flask/Jinja2 templates, vanilla JS, plain CSS with `:root` custom properties.

## Global Constraints

- No ORM / no new dependencies (raw `sqlite3` only) — but this plan touches no backend.
- Match existing `app.js` style: plain functions, template-literal HTML, `esc()` on all interpolated text, `icon()` helper for material icons.
- CSS uses existing tokens: `--border`, `--radius`, `--text-muted`, `--primary`, `--bg` (#f1f5f9), `--fs-sm` (13px), `--fs-xs` (11px).
- Server binds to localhost only; verify via `python app.py` at http://localhost:5000/.

---

### Task 1: Shared `groupByCompany()` helper

**Files:**
- Modify: `static/app.js` (add helper in the Utilities section, after `confirmDelete`, ~line 57)

**Interfaces:**
- Produces: `groupByCompany(rows, keyFn)` → `Array<{ name: string, rows: any[] }>`.
  Named groups first, sorted case-insensitively A–Z by `name`; a trailing
  `{ name: 'No Company', rows }` group appended only if some rows have no company.
  `keyFn(row)` returns the company display name or a falsy value.

- [ ] **Step 1: Add the helper**

In `static/app.js`, immediately after the `confirmDelete` function (before the `document.addEventListener('DOMContentLoaded'` block):

```js
// Buckets rows by company name. Named groups A–Z (case-insensitive),
// then a trailing "No Company" group if any rows lack a company.
// Row order within each group is preserved from the input array.
function groupByCompany(rows, keyFn) {
  const named = new Map();   // lowercase name -> { name, rows }
  const none = [];
  for (const row of rows) {
    const name = keyFn(row);
    if (!name) { none.push(row); continue; }
    const key = name.toLowerCase();
    if (!named.has(key)) named.set(key, { name, rows: [] });
    named.get(key).rows.push(row);
  }
  const groups = [...named.values()].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  if (none.length) groups.push({ name: 'No Company', rows: none });
  return groups;
}
```

- [ ] **Step 2: Syntax check**

Run: `node -c static/app.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: add groupByCompany helper for company-grouped lists"
```

---

### Task 2: Group the contacts list by company

**Files:**
- Modify: `static/app.js` — `renderContacts()` (~line 154)
- Modify: `static/style.css` — add `.group-header` / `.group-count` rules

**Interfaces:**
- Consumes: `groupByCompany()` from Task 1; existing `esc()`, `fmtDate()`.
- Contact rows have `company_name` (from `companies` join) and legacy free-text `company`.

- [ ] **Step 1: Rewrite `renderContacts`**

Replace the body of `renderContacts(contacts)` in `static/app.js` with:

```js
function renderContacts(contacts) {
  const tbody = document.getElementById('contactsBody');
  if (!contacts.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No contacts yet. Add one to get started.</td></tr>`;
    return;
  }
  const groups = groupByCompany(contacts, c => c.company_name || c.company);
  tbody.innerHTML = groups.map(g => `
    <tr class="group-header">
      <td colspan="6">${esc(g.name)} <span class="group-count">(${g.rows.length})</span></td>
    </tr>
    ${g.rows.map(c => `
    <tr>
      <td><a href="/contacts/${c.id}" class="table-link">${esc(c.last_name)}, ${esc(c.first_name)}</a></td>
      <td>${esc(c.company_name || c.company) || '—'}</td>
      <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
      <td>${esc(c.phone) || '—'}</td>
      <td>${fmtDate(c.created_at)}</td>
      <td class="table-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditContact(${c.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Delete</button>
      </td>
    </tr>`).join('')}
  `).join('');
}
```

- [ ] **Step 2: Add CSS**

Append to `static/style.css` (near the `.table-link` / `.badge` block, ~line 367):

```css
.group-header td {
  background: var(--bg);
  font-weight: 700;
  font-size: var(--fs-sm);
  color: var(--text);
  padding: 6px 12px;
}
.group-header td:hover { background: var(--bg); }
.group-count { color: var(--text-muted); font-weight: 400; }
```

- [ ] **Step 3: Syntax check**

Run: `node -c static/app.js`
Expected: exit 0.

- [ ] **Step 4: Manual verify**

Start `python app.py`. On `/contacts`:
- Each distinct company shows a shaded header row with `(N)` count.
- Contacts with no company appear under a "No Company" header, listed last.
- Clicking the Name / Email / Added column headers reorders rows within each group; group order stays A–Z.

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: group contacts list by company"
```

---

### Task 3: Group the meetings list by company

**Files:**
- Modify: `static/app.js` — `renderMeetings()` (~line 524)

**Interfaces:**
- Consumes: `groupByCompany()` (Task 1), `.group-header`/`.group-count` CSS (Task 2).
- Meeting rows have `company_name` (nullable); API returns them `ORDER BY meeting_date DESC`.

- [ ] **Step 1: Rewrite `renderMeetings`**

Replace the body of `renderMeetings(meetings)` in `static/app.js` with:

```js
function renderMeetings(meetings) {
  const tbody = document.getElementById('meetingsBody');
  if (!meetings.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No meetings yet.</td></tr>`;
    return;
  }
  const groups = groupByCompany(meetings, m => m.company_name);
  tbody.innerHTML = groups.map(g => `
    <tr class="group-header">
      <td colspan="4">${esc(g.name)} <span class="group-count">(${g.rows.length})</span></td>
    </tr>
    ${g.rows.map(m => `
    <tr>
      <td><a href="/meetings/${m.id}" class="table-link">${esc(m.title)}</a></td>
      <td>${fmtDate(m.meeting_date)}</td>
      <td>${m.company_name ? esc(m.company_name) : '—'}</td>
      <td class="table-actions">
        <a href="/meetings/${m.id}" class="btn btn-secondary btn-sm">Edit</a>
        <button class="btn btn-danger btn-sm" onclick="deleteMeeting(${m.id})">Delete</button>
      </td>
    </tr>`).join('')}
  `).join('');
}
```

- [ ] **Step 2: Syntax check**

Run: `node -c static/app.js`
Expected: exit 0.

- [ ] **Step 3: Manual verify**

On `/meetings`: grouped by company, "No Company" last, meetings within a group stay most-recent-first.

- [ ] **Step 4: Commit**

```bash
git add static/app.js
git commit -m "feat: group meetings list by company"
```

---

### Task 4: Dashboard Companies card

**Files:**
- Modify: `templates/dashboard.html`
- Modify: `static/app.js` — `loadDashboard()` (~line 1245) and `renderDashboard()` (~line 1254)
- Modify: `static/style.css` — add `.company-chip` + `#dashCompanies` layout

**Interfaces:**
- Consumes: `API.get`, `esc()`. `GET /api/companies` → `[{ id, name, industry, ... }]` sorted by `name ASC`.
- `renderDashboard` signature changes to `renderDashboard(data, companies)`.

- [ ] **Step 1: Add the card to the template**

In `templates/dashboard.html`, between the closing `</div>` of `.stat-grid` (line 24) and `<div id="dashRoot" class="dash-row">` (line 26), insert:

```html
<div class="card">
  <div class="card-title">Companies</div>
  <div id="dashCompanies"><p class="empty-state">Loading…</p></div>
</div>
```

- [ ] **Step 2: Update `loadDashboard`**

Replace `loadDashboard()` in `static/app.js` with:

```js
async function loadDashboard() {
  try {
    const [data, companies] = await Promise.all([
      API.get('/api/dashboard'),
      API.get('/api/companies'),
    ]);
    renderDashboard(data, companies);
  } catch (e) {
    document.getElementById('dashRoot').innerHTML = '<p class="empty-state">Error loading dashboard.</p>';
    const c = document.getElementById('dashCompanies');
    if (c) c.innerHTML = '<p class="empty-state">Error loading companies.</p>';
  }
}
```

- [ ] **Step 3: Update `renderDashboard`**

Change the signature to `function renderDashboard(data, companies) {` and insert this block immediately after the three `statX` `textContent` assignments (after line 1257):

```js
  const coEl = document.getElementById('dashCompanies');
  if (coEl) {
    coEl.innerHTML = companies.length
      ? companies.map(c =>
          `<a href="/companies/${c.id}" class="company-chip">${esc(c.name)}</a>`
        ).join('')
      : '<p class="empty-state">No companies yet.</p>';
  }
```

- [ ] **Step 4: Add CSS**

Append to `static/style.css`:

```css
#dashCompanies { display: flex; flex-wrap: wrap; gap: 8px; }
.company-chip {
  display: inline-block;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  text-decoration: none;
  transition: background .12s, color .12s;
}
.company-chip:hover { background: var(--bg); color: var(--text); }
```

- [ ] **Step 5: Syntax check**

Run: `node -c static/app.js`
Expected: exit 0.

- [ ] **Step 6: Manual verify**

On `/` (dashboard): a "Companies" card sits below the stat cards; one chip per company, A–Z; each chip links to `/companies/<id>`. With an empty DB it reads "No companies yet."

- [ ] **Step 7: Commit**

```bash
git add templates/dashboard.html static/app.js static/style.css
git commit -m "feat: add company shortcut chips to dashboard"
```

---

### Task 5: Regression check

- [ ] **Step 1: Run backend tests**

Run: `python -m pytest tests/ -v`
Expected: all pass (no backend changed).

- [ ] **Step 2: Browser smoke test**

With `python app.py` running, load `/`, `/contacts`, `/meetings`, click a company chip, click a contact column header. No console errors.

- [ ] **Step 3: Final commit if any fixups were needed** (otherwise skip)
