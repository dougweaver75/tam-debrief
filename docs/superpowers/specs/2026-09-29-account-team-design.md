# Account Team — Design

Date: 2026-09-29

## Goal
Each company has an internal account team (Doug's own colleagues assigned to that customer). Show and manage the team on the company page and on a dedicated "Account Teams" menu page grouped by company.

## Decisions
- Team members are plain per-company entries (no shared people directory).
- Multiple members per role are allowed.
- The menu page supports full inline add / edit / delete, not just viewing.
- The menu page lists all companies, including those with no team yet.

## Data
New table `account_team_members` in `schema.sql`:

| column | notes |
|---|---|
| id | PK autoincrement |
| company_id | NOT NULL, FK companies(id) ON DELETE CASCADE |
| role | NOT NULL, CHECK in `account_executive`, `customer_service_manager`, `technical_account_manager`, `solutions_consultant`, `other` |
| custom_title | TEXT DEFAULT ''; required when role = `other`, stored as '' otherwise |
| name | NOT NULL |
| email, phone | TEXT DEFAULT '' |
| created_at, updated_at | NOT NULL |

No uniqueness constraint. Existing DBs get the table via `CREATE TABLE IF NOT EXISTS` in `init_db()` (verify how init_db applies schema.sql and add a migration path if needed).

## API (raw sqlite3 in app.py)
- `GET /api/companies/<id>/team` — members for one company, ordered by role order then name.
- `POST /api/companies/<id>/team` — add member.
- `PUT /api/team/<id>` — edit member.
- `DELETE /api/team/<id>` — remove member.
- `GET /api/account-teams` — all companies (alphabetical) each with its ordered members array (empty array if none).

Validation (400 on failure): name required (trimmed); role must be one of the five values; `custom_title` required when role = `other`, ignored/cleared otherwise. 404 for unknown company/member.

Role order everywhere: AE, CSM, TAM, SC, Other; then name (case-insensitive). Display label for Other rows is the custom title.

## UI
- **Shared modal** in `static/app.js`: one add/edit function used by both pages. Role dropdown; Title field shown only when role = Other; name, email, phone. Callers pass a refresh callback.
- **Company page** (`templates/company.html`): new "Account Team" section listing members with role/title label, name, email, phone, edit and delete actions, plus an "Add Member" button.
- **Menu page** `/account-teams` (`templates/account_teams.html`): sidebar item "Account Teams" in `base.html`. Companies alphabetical; each company name links to `/companies/<id>`; members listed beneath with edit/delete; per-company "Add Member" button; empty companies show "No team members yet".
- Styles appended to `static/style.css`, reusing existing card/list/modal classes.

## Testing
`tests/test_api.py`: CRUD; `other` requires title; title cleared when role changes away from other; invalid role rejected; multiple members per role; ordering; cascade delete with company; `/api/account-teams` includes companies with no members and groups correctly.

## Out of scope
Shared people directory, per-member notes, drag-to-reorder, search/filter on the menu page.
