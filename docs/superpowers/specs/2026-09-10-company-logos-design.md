# Company logos — design

**Date:** 2026-09-10
**Status:** Approved, ready for planning

## Goal

Give each company an optional logo image, editable from the company detail page, and show it on the dashboard company cards (which also get larger).

## Storage

- New column: `companies.logo TEXT DEFAULT ''`.
- Value is either `''` or a data URI string: `data:image/png;base64,…` (raster) or `data:image/svg+xml;base64,…` (SVG).
- `schema.sql`: add `logo TEXT DEFAULT ''` to the `companies` CREATE TABLE.
- `migrate_db()` in `app.py`: add a guarded `ALTER TABLE companies ADD COLUMN logo TEXT DEFAULT ''`
  following the existing `PRAGMA table_info` pattern used for `contacts.company_id` etc.
- No new routes. `logo` is added to the column lists in `api_create_company`
  (`app.py:292`) and `api_update_company` (`app.py:316`), and is returned by
  `api_get_company` automatically (`SELECT *`).

## Client-side image handling

New helper in `static/app.js` (Utilities section):

```js
// Reads an image File into a data-URI string, downscaling rasters so the
// longest side is <= maxPx. SVGs are passed through as-is. Rejects (throws)
// if the result exceeds ~256 KB.
async function readImageAsDataUri(file, maxPx = 256) { … }
```

Behaviour:

- `file.type === 'image/svg+xml'` → `FileReader.readAsDataURL`, return as-is.
- Other types → load into `new Image()`, draw onto a `<canvas>` scaled so
  `max(w, h) <= maxPx` (no upscaling), `canvas.toDataURL('image/png')`.
- If the returned string length > 262144, throw `new Error('too-large')`.
- Accepts `image/png, image/jpeg, image/svg+xml, image/webp`.

## Company detail page (`templates/company.html` + `app.js`)

### Edit Company modal

Add a form row between the Address row and the Notes row:

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

JS:

- Module-scoped `let _coLogo;` — holds the current logo data URI string
  (`''` when none). Set from `co.logo` in `openEditCompanyDetail()`, updated
  by the file input's `change` handler (via `readImageAsDataUri`, with a
  `showToast('Logo too large — try a smaller image.')` on the `too-large` throw),
  and set to `''` by the Remove button. All three also update the preview
  `<img>` / placeholder visibility.
- `submitCompanyDetail()` and the `openAddCompany`/list-page create flow
  (`submitCompany`, `app.js:~1084`) both include `logo: _coLogo || ''` in the
  PUT/POST body. For the add flow `_coLogo` starts `''`.
- Wire the file input + remove button listeners once in `initCompanyDetail`
  (and the companies-list `initCompanies` where the shared modal also lives) —
  match however existing modal listeners are wired; if they use inline
  `onchange`/`onclick` attributes, use those instead for consistency.

### Detail card header

`renderCompanyDetail()` (`app.js:1141`) — render a logo slot to the left of
the name, mirroring the contact-avatar layout in `renderContactDetail`:

```js
const logoHtml = co.logo
  ? `<img src="${esc(co.logo)}" class="company-logo" alt="">`
  : `<div class="company-logo company-logo-mono">${esc((co.name[0] || '?').toUpperCase())}</div>`;
```

Placed inside a flex row with the name/industry block, like the contact header.

## Dashboard cards (`app.js` `renderDashboard` + `style.css`)

- `/api/dashboard` companies query (`app.py`, the `companies = query(...)` block
  added earlier) gains `co.logo`:
  ```sql
  SELECT co.id, co.name, co.logo,
    (SELECT COUNT(*) FROM contacts WHERE company_id=co.id) AS contact_count,
    (SELECT COUNT(*) FROM meetings  WHERE company_id=co.id) AS meeting_count
  FROM companies co ORDER BY co.name COLLATE NOCASE ASC
  ```
- Card markup:
  ```html
  <a href="/companies/${id}" class="company-card">
    <div class="company-card-logo">
      <!-- <img src=logo> OR <span class="mono">${initial}</span> -->
    </div>
    <div class="company-card-body">
      <div class="company-card-name">${name}</div>
      <div class="company-card-stats">
        <span>${icon('people','13px')} ${contact_count}</span>
        <span>${icon('calendar_today','13px')} ${meeting_count}</span>
      </div>
    </div>
  </a>
  ```
- CSS changes to the existing block:
  - `#dashCompanies` grid `minmax(160px, 1fr)` → `minmax(220px, 1fr)`.
  - `.company-card` → `flex-direction: row; align-items: center; gap: 12px;`.
  - `.company-card-logo` → `width:44px; height:44px; flex:none; border-radius:6px;
    overflow:hidden; display:flex; align-items:center; justify-content:center;
    background:var(--bg);` — `img` inside: `width:100%; height:100%; object-fit:contain;`.
  - `.company-card-logo .mono` → bold initial, `var(--text-muted)`, `var(--fs-md)`.
  - `.company-card-body` → `min-width:0` so the name ellipsizes if needed
    (`.company-card-name` gets `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`).

## Shared CSS additions

- `.company-logo` (detail header) — `48px` square, `border-radius:8px`,
  `object-fit:contain`, `background:var(--bg)`.
- `.company-logo-mono` — flex-centered bold initial, reuse contact-avatar colors.
- `.logo-edit` — flex row, `gap:10px`, `align-items:center`.
- `.logo-preview` — `48px` square, `border:1px solid var(--border)`,
  `border-radius:6px`, `object-fit:contain`.
- `.logo-preview-empty` — same box, flex-centered `var(--fs-xs)` muted "No logo".

## Tests (`tests/test_api.py`)

- Extend `test_dashboard_company_counts`: assert `'logo' in d['companies'][0]`.
- New `test_company_logo_roundtrip`:
  - `POST /api/companies` with `logo: 'data:image/png;base64,iVBORw0KGgo='` →
    `GET` → `logo` equals that string.
  - `PUT` the same company with `logo: ''` → `GET` → `logo == ''`.
- New `test_company_logo_defaults_empty`: `POST` without `logo` → `GET` → `logo == ''`.

## Manual verification

1. `python app.py` (delete `ccrm.db`? no — migration adds the column in place).
2. Company detail → Edit → choose a PNG → preview appears → Save → logo shows in header.
3. Dashboard → that company's card shows the logo, left-aligned, card is wider.
4. Edit again → Remove → Save → header falls back to the monogram; dashboard card too.
5. Try a >1MB photo → toast "Logo too large" and the logo is unchanged.
6. `python -m pytest tests/ -v` → all pass.

## Out of scope

- Cropping / rotation UI, drag-and-drop upload.
- Auto-fetching a favicon from the website URL.
- Logos anywhere else (contact pages, meeting pages, list tables).
