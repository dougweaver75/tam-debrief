# Company Logos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-company logo, editable in the Add/Edit Company modal, shown on the company detail header and the dashboard company cards.

**Architecture:** New `companies.logo` TEXT column holding a data-URI string. No new routes — logo rides the existing JSON `POST`/`PUT`. Client downscales raster images to a 256px canvas and base64-encodes them; SVGs pass through. Dashboard cards grow and gain a left logo slot.

**Tech Stack:** Flask, raw `sqlite3`, Jinja2, vanilla JS, plain CSS. No new dependencies.

## Global Constraints

- No ORM — raw `sqlite3` only.
- No new Python/JS dependencies.
- Offline-first / local-only — logos stored in the DB, no external fetches.
- Match existing `app.js` conventions: plain functions, template-literal HTML, `esc()` on every interpolation, `icon()` helper.
- Migrations go in `migrate_db()` guarded by a `PRAGMA table_info` check (see `app.py:57`).
- Data-URI size cap: 262144 chars (256 KB). Over that → toast + abort, logo unchanged.

---

### Task 1: Schema + migration + API columns

**Files:**
- Modify: `schema.sql` — `companies` table
- Modify: `app.py:57` `migrate_db()`; `app.py:292` `api_create_company`; `app.py:316` `api_update_company`; the dashboard `companies = query(...)` block in `api_dashboard`
- Test: `tests/test_api.py`

**Interfaces:**
- Produces: `companies` rows now have a `logo` field (`''` default). `POST /api/companies` and `PUT /api/companies/<id>` accept an optional `logo` string. `PUT` **preserves** the existing logo when the `logo` key is absent from the body. `GET /api/dashboard` `companies[]` entries include `logo`.

- [ ] **Step 1: Write failing tests**

Add to `tests/test_api.py`:

```python
def test_company_logo_defaults_empty(client):
    co = client.post('/api/companies', json={'name': 'NoLogo Co'}).get_json()
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == ''

def test_company_logo_roundtrip(client):
    uri = 'data:image/png;base64,iVBORw0KGgo='
    co = client.post('/api/companies', json={'name': 'Logo Co', 'logo': uri}).get_json()
    assert co['logo'] == uri
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == uri
    client.put(f"/api/companies/{co['id']}", json={'name': 'Logo Co', 'logo': ''})
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == ''

def test_company_logo_preserved_when_key_absent(client):
    uri = 'data:image/png;base64,iVBORw0KGgo='
    co = client.post('/api/companies', json={'name': 'Keep Co', 'logo': uri}).get_json()
    client.put(f"/api/companies/{co['id']}", json={'name': 'Keep Co Renamed'})
    got = client.get(f"/api/companies/{co['id']}").get_json()
    assert got['name'] == 'Keep Co Renamed'
    assert got['logo'] == uri
```

Also extend `test_dashboard_company_counts` — add after the existing asserts:

```python
    assert 'logo' in row
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `python -m pytest tests/test_api.py -q -k "logo or company_counts"`
Expected: FAIL (`KeyError: 'logo'` / logo not preserved).

- [ ] **Step 3: schema.sql**

In the `companies` CREATE TABLE, add the column after `notes`:

```sql
    notes      TEXT    DEFAULT '',
    logo       TEXT    DEFAULT '',
```

- [ ] **Step 4: migrate_db()**

In `app.py` `migrate_db()`, after the `action_items` block and before `db.commit()`:

```python
    cols_co = {r[1] for r in db.execute("PRAGMA table_info(companies)")}
    if 'logo' not in cols_co:
        db.execute("ALTER TABLE companies ADD COLUMN logo TEXT DEFAULT ''")
```

- [ ] **Step 5: api_create_company**

Replace the INSERT in `api_create_company` (`app.py:299`):

```python
    cur = execute(
        'INSERT INTO companies (name,industry,website,address,notes,logo,created_at,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?)',
        (name, data.get('industry',''), data.get('website',''),
         data.get('address',''), data.get('notes',''), data.get('logo',''), ts, ts)
    )
```

- [ ] **Step 6: api_update_company**

Replace the body of `api_update_company` from the existence check through the UPDATE:

```python
    row = query('SELECT * FROM companies WHERE id=?', (coid,), one=True)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    data = request.get_json(force=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    logo = data['logo'] if 'logo' in data else row['logo']
    execute(
        'UPDATE companies SET name=?,industry=?,website=?,address=?,notes=?,logo=?,updated_at=? WHERE id=?',
        (name, data.get('industry',''), data.get('website',''),
         data.get('address',''), data.get('notes',''), logo, now_iso(), coid)
    )
```

- [ ] **Step 7: dashboard companies query**

In `api_dashboard`, change the `companies = query(...)` SELECT to include `co.logo`:

```python
    companies = query(
        'SELECT co.id, co.name, co.logo, '
        '(SELECT COUNT(*) FROM contacts WHERE company_id=co.id) AS contact_count, '
        '(SELECT COUNT(*) FROM meetings  WHERE company_id=co.id) AS meeting_count '
        'FROM companies co ORDER BY co.name COLLATE NOCASE ASC'
    )
```

- [ ] **Step 8: Run tests**

Run: `python -m pytest tests/ -q`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add schema.sql app.py tests/test_api.py
git commit -m "feat: add companies.logo column and API support"
```

---

### Task 2: Client image helper + logo inputs in both company modals

**Files:**
- Modify: `static/app.js` — new `readImageAsDataUri` in Utilities; new `wireCompanyLogoInputs`, `_coLogo` state, updates to `openAddCompany`/`openEditCompany`/`submitCompany` and `openEditCompanyDetail`/`submitCompanyDetail`/`initCompanies`/`initCompanyDetail`
- Modify: `templates/companies.html` and `templates/company.html` — add the Logo form row to `#companyModal`
- Modify: `static/style.css` — `.logo-edit`, `.logo-preview`, `.logo-preview-empty`

**Interfaces:**
- Consumes: `showToast`, `esc`.
- Produces: `readImageAsDataUri(file, maxPx=256) -> Promise<string>` (throws `Error('too-large')`); `_coLogo` module variable = current logo data URI or `''`; `wireCompanyLogoInputs()` attaches change/click handlers and is safe to call once per page.

- [ ] **Step 1: Add `readImageAsDataUri` helper**

In `static/app.js`, after the `groupByCompany` helper:

```js
// Reads an image File to a data-URI string. Rasters are drawn onto a canvas
// scaled so the longest side is <= maxPx (never upscaled); SVGs pass through.
// Throws Error('too-large') if the encoded string exceeds 256 KB.
function readImageAsDataUri(file, maxPx = 256) {
  const MAX = 262144;
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      const fr = new FileReader();
      fr.onload = () => {
        if (fr.result.length > MAX) reject(new Error('too-large'));
        else resolve(fr.result);
      };
      fr.onerror = () => reject(new Error('read-failed'));
      fr.readAsDataURL(file);
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const uri = canvas.toDataURL('image/png');
        if (uri.length > MAX) reject(new Error('too-large'));
        else resolve(uri);
      };
      img.onerror = () => reject(new Error('decode-failed'));
      img.src = fr.result;
    };
    fr.onerror = () => reject(new Error('read-failed'));
    fr.readAsDataURL(file);
  });
}
```

- [ ] **Step 2: Add the Logo row to both modals**

In BOTH `templates/companies.html` and `templates/company.html`, inside `#companyModal`'s form, between the Address `form-row` and the Notes `form-row`:

```html
    <div class="form-row">
      <label>Logo</label>
      <div class="logo-edit">
        <img id="coLogoPreview" class="logo-preview" alt="" hidden>
        <span id="coLogoPlaceholder" class="logo-preview logo-preview-empty">No logo</span>
        <input type="file" id="coLogo" accept="image/png,image/jpeg,image/svg+xml,image/webp">
        <button type="button" class="btn btn-secondary btn-sm" id="coLogoRemove">Remove</button>
      </div>
    </div>
```

- [ ] **Step 3: Add logo state + helpers to app.js**

Near the other Company Detail module vars (`let _currentCompany = null;`), add:

```js
let _coLogo = '';
```

Add this function (Company Detail section):

```js
function setCoLogoPreview(uri) {
  _coLogo = uri || '';
  const img = document.getElementById('coLogoPreview');
  const ph  = document.getElementById('coLogoPlaceholder');
  if (!img || !ph) return;
  if (_coLogo) { img.src = _coLogo; img.hidden = false; ph.hidden = true; }
  else { img.removeAttribute('src'); img.hidden = true; ph.hidden = false; }
}

function wireCompanyLogoInputs() {
  const input = document.getElementById('coLogo');
  const remove = document.getElementById('coLogoRemove');
  if (input && !input._wired) {
    input._wired = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        setCoLogoPreview(await readImageAsDataUri(file));
      } catch (err) {
        showToast(err.message === 'too-large'
          ? 'Logo too large — try a smaller image.'
          : 'Could not read that image.');
      }
      input.value = '';
    });
  }
  if (remove && !remove._wired) {
    remove._wired = true;
    remove.addEventListener('click', () => setCoLogoPreview(''));
  }
}
```

- [ ] **Step 4: Call `wireCompanyLogoInputs` on both pages**

In `initCompanies()` and `initCompanyDetail()`, add `wireCompanyLogoInputs();` as the first line.

- [ ] **Step 5: Reset/populate logo state in the open handlers**

- `openAddCompany()` — after `companyForm.reset()`: `setCoLogoPreview('');`
- `openEditCompany(id)` — after setting `coNotes`: `setCoLogoPreview(co.logo || '');`
- `openEditCompanyDetail()` — after setting `coNotes`: `setCoLogoPreview(co.logo || '');`

- [ ] **Step 6: Send logo in both submit handlers**

In `submitCompany(e)` and `submitCompanyDetail(e)`, add to the `data` object literal:

```js
    logo:     _coLogo || '',
```

- [ ] **Step 7: Add CSS**

Append to the dashboard company block in `static/style.css`:

```css
.logo-edit { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.logo-preview {
  width: 48px; height: 48px;
  border: 1px solid var(--border);
  border-radius: 6px;
  object-fit: contain;
  background: var(--card);
}
.logo-preview-empty {
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-xs); color: var(--text-muted); text-align: center;
  background: var(--bg);
}
```

- [ ] **Step 8: Syntax check**

Run: `node -c static/app.js`
Expected: exit 0.

- [ ] **Step 9: Manual verify**

`python app.py`. Companies list → Add Company → pick a PNG → preview shows → Save. Edit it → Remove → preview clears → Save → `GET /api/companies/<id>` shows `logo: ""`.

- [ ] **Step 10: Commit**

```bash
git add static/app.js static/style.css templates/companies.html templates/company.html
git commit -m "feat: logo upload in company modals with client-side downscale"
```

---

### Task 3: Logo on the company detail header

**Files:**
- Modify: `static/app.js` — `renderCompanyDetail()` (`app.js:1141`)
- Modify: `static/style.css` — `.company-logo`, `.company-logo-mono`

**Interfaces:**
- Consumes: `_currentCompany.logo`, `esc`, `icon`.

- [ ] **Step 1: Update `renderCompanyDetail`**

Replace the `.contact-header` block inside `renderCompanyDetail` so the header has a logo slot left of the name:

```js
  const logoHtml = co.logo
    ? `<img src="${esc(co.logo)}" class="company-logo" alt="">`
    : `<div class="company-logo company-logo-mono">${esc((co.name[0] || '?').toUpperCase())}</div>`;
  document.getElementById('companyDetailRoot').innerHTML = `
    <a href="/companies" class="back-link">${icon('arrow_back')} All Companies</a>
    <div class="card">
      <div class="contact-header">
        <div style="display:flex;gap:14px;align-items:flex-start">
          ${logoHtml}
          <div>
            <div class="contact-name">${esc(co.name)}</div>
            <div class="contact-meta">${esc(co.industry) || ''}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" onclick="openEditCompanyDetail()">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCompanyDetail(${co.id})">Delete</button>
        </div>
      </div>
      <div class="contact-fields">
        <div class="field-row"><span class="field-label">Website</span>
          <span class="field-value">${safeUrl(co.website) ? `<a href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website)}</a>` : esc(co.website) || '—'}</span></div>
        <div class="field-row"><span class="field-label">Address</span>
          <span class="field-value">${esc(co.address) || '—'}</span></div>
        ${co.notes ? `<div class="field-row" style="grid-column:1/-1">
          <span class="field-label">Notes</span>
          <span class="field-value" style="white-space:pre-wrap">${esc(co.notes)}</span></div>` : ''}
      </div>
    </div>
  `;
```

- [ ] **Step 2: Add CSS**

Append to `static/style.css`:

```css
.company-logo {
  width: 48px; height: 48px; flex: none;
  border-radius: 8px; object-fit: contain; background: var(--bg);
}
.company-logo-mono {
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: var(--fs-md); color: var(--text-muted);
}
```

- [ ] **Step 3: Syntax check + manual verify**

Run: `node -c static/app.js` (exit 0). Then in the browser: a company with a logo shows it in the header; one without shows the initial.

- [ ] **Step 4: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: show company logo on the detail header"
```

---

### Task 4: Logo on the dashboard company cards (larger, logo-left)

**Files:**
- Modify: `static/app.js` — the company-card markup in `renderDashboard`
- Modify: `static/style.css` — the `.company-card*` rules

**Interfaces:**
- Consumes: `data.companies[].logo` (added in Task 1).

- [ ] **Step 1: Update card markup in `renderDashboard`**

Replace the `companies.map(...)` template in `renderDashboard` with:

```js
      ? companies.map(c => {
          const logo = c.logo
            ? `<img src="${esc(c.logo)}" alt="">`
            : `<span class="company-card-mono">${esc((c.name[0] || '?').toUpperCase())}</span>`;
          return `
        <a href="/companies/${c.id}" class="company-card">
          <div class="company-card-logo">${logo}</div>
          <div class="company-card-body">
            <div class="company-card-name">${esc(c.name)}</div>
            <div class="company-card-stats">
              <span>${icon('people', '13px')} ${c.contact_count}</span>
              <span>${icon('calendar_today', '13px')} ${c.meeting_count}</span>
            </div>
          </div>
        </a>`;
        }).join('')
```

- [ ] **Step 2: Update CSS**

In `static/style.css`, replace the existing `#dashCompanies` / `.company-card*` rules with:

```css
#dashCompanies {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.company-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  text-decoration: none;
  color: var(--text);
  transition: border-color .12s, box-shadow .12s;
}
.company-card:hover { border-color: var(--primary); box-shadow: var(--shadow); }
.company-card-logo {
  width: 44px; height: 44px; flex: none;
  border-radius: 6px; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg);
}
.company-card-logo img { width: 100%; height: 100%; object-fit: contain; }
.company-card-mono { font-weight: 700; font-size: var(--fs-md); color: var(--text-muted); }
.company-card-body { min-width: 0; }
.company-card-name {
  font-weight: 600; font-size: var(--fs-sm);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.company-card-stats {
  display: flex; gap: 12px; margin-top: 4px;
  color: var(--text-muted); font-size: var(--fs-xs);
}
.company-card-stats span { display: inline-flex; align-items: center; gap: 3px; }
```

- [ ] **Step 3: Syntax check**

Run: `node -c static/app.js`
Expected: exit 0.

- [ ] **Step 4: Manual verify in browser**

Restart preview (`app.py` changed in Task 1). Dashboard: cards are wider (2–3 per row), each with a logo or initial on the left, name + counts on the right. Console clean.

- [ ] **Step 5: Commit**

```bash
git add static/app.js static/style.css
git commit -m "feat: company logos on dashboard cards, larger logo-left layout"
```

---

### Task 5: Full regression

- [ ] **Step 1:** `python -m pytest tests/ -v` → all pass.
- [ ] **Step 2:** Browser smoke: dashboard, companies list (add w/ logo), company detail (edit logo, remove logo), contacts, meetings. No console errors.
- [ ] **Step 3:** Verify an existing `ccrm.db` migrates cleanly — start `app.py` against the current DB, confirm no error and companies load with `logo: ""`.
