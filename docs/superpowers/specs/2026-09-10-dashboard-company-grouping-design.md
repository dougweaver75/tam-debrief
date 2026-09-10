# Dashboard company shortcuts + company grouping — design

**Date:** 2026-09-10
**Status:** Approved, ready for planning

## Goal

Three related UI changes, all client-side:

1. Add a "Companies" card to the dashboard with A–Z clickable company chips.
2. Group the contacts list by company.
3. Group the meetings list by company.

## Why client-side only

The existing APIs already carry every field needed:

- `GET /api/contacts` returns `c.*, co.name AS company_name` per row (also `company_id`, and the legacy free-text `company` column). See `app.py:123`.
- `GET /api/meetings` returns `m.*, co.name AS company_name` per row. See `app.py:382`.
- `GET /api/companies` returns all companies sorted by `name ASC`. See `app.py:278`.

No backend routes, SQL, or schema changes. All work is in `static/app.js`, `static/style.css`, and `templates/dashboard.html`.

## 1. Dashboard — Companies card

### Template (`templates/dashboard.html`)

Insert a new full-width card between the `.stat-grid` block and `<div id="dashRoot" class="dash-row">`:

```html
<div class="card">
  <div class="card-title">Companies</div>
  <div id="dashCompanies"><p class="empty-state">Loading…</p></div>
</div>
```

### JS (`static/app.js`)

- `loadDashboard()` (`app.js:1245`) issues both calls in parallel:
  ```js
  const [data, companies] = await Promise.all([
    API.get('/api/dashboard'),
    API.get('/api/companies'),
  ]);
  renderDashboard(data, companies);
  ```
- `renderDashboard(data, companies)` gains a block that fills `#dashCompanies`:
  - If `companies.length === 0`: `<p class="empty-state">No companies yet.</p>`.
  - Otherwise a flex-wrapped row of chips, one per company, in the order returned (already `name ASC`):
    ```html
    <a href="/companies/${c.id}" class="company-chip">${esc(c.name)}</a>
    ```
- All companies are shown regardless of whether they have contacts or meetings.
- The dashboard error handler already replaces `#dashRoot`; extend the `catch` in `loadDashboard` to also set `#dashCompanies` to an error empty-state so a failed `/api/companies` call is visible.

### CSS (`static/style.css`)

- `.company-chip` — pill: `display:inline-block`, bordered with the existing border token, rounded (`border-radius` matching other pills), small padding, muted text that darkens on hover, subtle hover background. Uses existing color variables.
- Container: the `#dashCompanies` div lays chips out with `display:flex; flex-wrap:wrap; gap:8px`.

## 2. Contacts list — grouped by company

### JS (`static/app.js`)

Rewrite `renderContacts(contacts)` (`app.js:154`) to always group. It still receives the flat, server-sorted array from `loadContacts` — grouping only reorders by bucketing, preserving each row's incoming relative order.

Grouping rules:

- Bucket key: `c.company_name || c.company || null`. Rows with no company go to the "No Company" bucket.
- Named groups are ordered case-insensitively A–Z by company name.
- The "No Company" group is rendered **last**, after all named groups.
- Within a group, rows keep the order they arrived in (i.e. the server sort — see below).

Rendering:

- Each group emits a header row before its contact rows:
  ```html
  <tr class="group-header">
    <td colspan="6">${esc(companyName)} <span class="group-count">(${n})</span></td>
  </tr>
  ```
  For the no-company bucket, `companyName` is the literal `No Company`.
- Contact `<tr>` markup is unchanged from the current implementation.
- Empty state (no contacts at all) is unchanged: single full-width `empty-state` row.

### Column sorting behaviour

- `_sortCol` / `_sortDir` / `sortBy()` / `loadContacts()` server-sort flow is untouched.
- Because rows arrive pre-sorted and grouping is a stable bucketing, the active column sort applies **within each group**.
- Group ordering is always by company name and is independent of `_sortCol`.
- The Company column header remains clickable; when grouped it only reorders rows that share a company (effectively a no-op). This is acceptable and not worth special-casing.
- `updateSortArrows()` is unchanged.

## 3. Meetings list — grouped by company

### JS (`static/app.js`)

Rewrite `renderMeetings(meetings)` (`app.js:524`) with the same grouping approach:

- Bucket key: `m.company_name || null`; no-company rows → "No Company" bucket.
- Named groups A–Z case-insensitive; "No Company" last.
- Within each group, meetings keep their incoming order (the API returns `ORDER BY m.meeting_date DESC`, so most-recent-first per company).
- Group header row uses `colspan="4"`:
  ```html
  <tr class="group-header">
    <td colspan="4">${esc(companyName)} <span class="group-count">(${n})</span></td>
  </tr>
  ```
- Meeting `<tr>` markup unchanged. Empty state unchanged.

### CSS (`static/style.css`)

Shared by both tables:

- `.group-header td` — subtle shaded background (existing subtle-surface token), bold weight, slightly smaller font, tighter vertical padding than a data row; not hoverable.
- `.group-count` — muted color, normal weight.

## Shared helper

Grouping logic is nearly identical for contacts and meetings. Extract one helper in `app.js`:

```js
// Returns [{ name, rows }] — named groups A–Z, then a trailing
// { name: 'No Company', rows } group if any rows lack a company.
function groupByCompany(rows, keyFn) { … }
```

`keyFn` returns the display company name or a falsy value. `renderContacts` and `renderMeetings` each call it, then map groups → header row + data rows.

## Testing

- No API changes → existing `pytest tests/` suite still covers the backend unchanged. No new backend tests.
- Manual verification in the browser preview (`python app.py`):
  1. Dashboard shows a Companies card with one chip per company, A–Z; each chip navigates to `/companies/<id>`.
  2. Dashboard with zero companies shows "No companies yet."
  3. Contacts page: every company group has a header with the correct `(N)` count; contacts with no company appear under a "No Company" header that sorts last.
  4. Contacts page: clicking the Name / Email / Added column headers re-sorts rows within each group; group order stays A–Z.
  5. Meetings page: grouped by company, "No Company" last, meetings within a group ordered most-recent-first.

## Out of scope

- Collapsible / accordion groups.
- Group-by toggle or persistence.
- Chip activity counts or last-meeting dates.
- Any change to the companies list page.
