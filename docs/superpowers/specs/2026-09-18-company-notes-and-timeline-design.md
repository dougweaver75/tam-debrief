# Company notes, timeline, and interaction editing — design

**Date:** 2026-09-18
**Status:** Approved, ready for planning

## Goal

1. Let Doug log freeform, timestamped "odds and ends" notes against a company (separate from the existing single `companies.notes` blurb field), editable/deletable in place.
2. Give each company a merged chronological **timeline** of everything that happened with it (meetings, action items, notes, plus new standalone events like renewals/go-lives), and surface a similar feed on the dashboard split into **Recent Activity** and **Upcoming**.
3. While touching interaction rendering for the timeline, also add the missing **edit** action for interactions under a contact (currently only create + delete exist).

## Data model

Two new tables, added to `schema.sql`. Because `migrate_db()` already `executescript`s the full `schema.sql` on every startup (`app.py:57-62`), `CREATE TABLE IF NOT EXISTS` is sufficient — no explicit migration code needed for the new tables themselves.

```sql
CREATE TABLE IF NOT EXISTS company_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS timeline_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category    TEXT    NOT NULL DEFAULT 'other'
                CHECK(category IN ('milestone','renewal','go-live','risk','other')),
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    event_date  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);
```

`companies.notes` (existing single text field) is untouched — it stays as a general "about this company" blurb; `company_notes` is the new running log.

**Interactions gain `updated_at`:** add to the `interactions` CREATE TABLE in `schema.sql`, plus a guarded migration in `migrate_db()` following the existing `PRAGMA table_info` pattern (`app.py:63-76`):

```python
cols_int = {r[1] for r in db.execute("PRAGMA table_info(interactions)")}
if 'updated_at' not in cols_int:
    db.execute("ALTER TABLE interactions ADD COLUMN updated_at TEXT")
```

New rows always set `updated_at`; existing rows get `NULL` until first edited (fine — it's cosmetic, only shown as "edited" indicator if we choose to show one, which we won't for v1).

## API routes

### Company notes

- `GET /api/companies/<id>/notes` — list, newest first.
- `POST /api/companies/<id>/notes` — body `{body}`, sets `created_at`/`updated_at` to now.
- `PUT /api/notes/<id>` — body `{body}`, updates `body` + `updated_at`.
- `DELETE /api/notes/<id>`.

### Timeline events

- `GET /api/companies/<id>/timeline` — returns the **merged** feed for one company: unions meetings, action items, company_notes, and timeline_events for that company into a single list of `{source, id, date, category, title, detail, link}` shaped rows, sorted newest-first in Python after fetching each source with its own query (simplest — avoids a fragile 4-way SQL UNION across differently-shaped tables).
- `POST /api/companies/<id>/timeline_events` — body `{category, title, description, event_date}`.
- `PUT /api/timeline_events/<id>` — same fields.
- `DELETE /api/timeline_events/<id>`.

### Interaction editing

- `PUT /api/interactions/<id>` — body `{type, summary, interaction_date}`, updates those columns + `updated_at`. Mirrors the existing `POST /api/interactions` validation (type must be one of the CHECK values).

### Dashboard

Extend `GET /api/dashboard` (`app.py:533-567`) with two new keys:

- `recent_activity`: last 15 events merged across **all** companies from the same four sources (meetings by `meeting_date`, company_notes by `created_at`, timeline_events by `event_date`, interactions by `interaction_date` — interactions are contact-level, not company-level, but Doug's existing `recent_interactions` block already surfaces those separately, so `recent_activity` covers meetings + notes + timeline_events only, each joined to `companies.name`), newest-first.
- `upcoming`: meetings with `meeting_date >= today`, open action items with `due_date >= today`, and timeline_events with `event_date >= today`, soonest-first, each joined to `companies.name`.

The existing `recent_interactions` and `action_items` (open, overdue-first) keys stay as-is — they're contact-centric and already serve a similar purpose; the new keys are company-centric and additive.

## UI: company detail page

**Notes section** (new, below existing fields):
- List of entries, newest first: body text, relative timestamp (title = full date on hover).
- "Add note" — textarea + button, appends.
- Each entry: inline **Edit** (textarea replaces body, Save/Cancel) and **Delete** (confirm), matching the existing inline-edit pattern used elsewhere in `app.js`.

**Timeline section** (new, below Notes):
- Merged feed from `GET /api/companies/<id>/timeline`, newest-first.
- Each row: icon/label by source (meeting / action item / note / event category badge), date, short text. Meeting and action-item rows link to their existing detail views; notes and events render inline.
- "Add event" button → small form (category dropdown, title, optional description, date). Standalone events get inline Edit/Delete like notes.

## UI: contact detail page — interaction editing

In the existing "Recent Interactions" list render, add an **Edit** action alongside the existing Delete:
- Click Edit → row's type/summary/date become editable inputs in place (same inline-edit convention as notes), Save calls `PUT /api/interactions/<id>`, Cancel reverts.

## UI: dashboard

Two new panels alongside the existing stats/company cards:
- **Recent Activity** — from `recent_activity`, each row: company name, date, short text, links to that company's page.
- **Upcoming** — from `upcoming`, same shape, soonest-first.

## Tests (`tests/test_api.py`)

- `test_company_notes_crud` — create, list, edit, delete a note; assert ordering (newest first) and 404 on delete of nonexistent id.
- `test_timeline_events_crud` — create with each valid category, reject invalid category (expect 400), edit, delete.
- `test_company_timeline_merges_sources` — seed a meeting, an action item, a note, and a timeline event for one company; assert `GET /api/companies/<id>/timeline` returns all four, sorted newest-first.
- `test_interaction_update` — `PUT /api/interactions/<id>` changes `type`/`summary`/`interaction_date`, `updated_at` is set, invalid `type` rejected.
- `test_dashboard_recent_activity_and_upcoming` — assert both new keys exist, `upcoming` only contains future-or-today dates, `recent_activity` is capped at 15 and sorted newest-first.

## Manual verification

1. `python app.py` — no `ccrm.db` deletion needed; migration creates the new tables/column in place.
2. Company detail → add a few notes → edit one → delete one → order stays newest-first.
3. Company detail → add a timeline event for each category → confirm it appears in the merged timeline alongside an existing meeting/action item, correctly dated.
4. Contact detail → edit an existing interaction → confirm the change persists after reload.
5. Dashboard → confirm Recent Activity and Upcoming panels populate and link back to the right company.
6. `python -m pytest tests/ -v` → all pass.

## Out of scope

- Calendar grid view (noted as future backlog — timeline ships first).
- Linking timeline events to a specific contact rather than a company.
- Any taxonomy/category system beyond the fixed five (`milestone`, `renewal`, `go-live`, `risk`, `other`).
- Editing meetings/action items from within the timeline view (they already have their own detail pages).
