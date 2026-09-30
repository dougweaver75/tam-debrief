# Multi-Contact Interactions + Dashboard List Limits — Design

Date: 2026-09-30

## Goals
1. An interaction (call/email/meeting/note) can involve more than one contact, and can be edited (including its participants).
2. Dashboard "Recent Activity" and "Upcoming" show 5 items with expand/collapse.

## Decisions
- Logging entry point stays the contact page only (no global "Log Interaction").
- Participants stored in a join table; the old `interactions.contact_id` column is removed via a one-time table rebuild (chosen over keeping a "logged from" column, which would leave a cascade-delete problem).
- An interaction appears on every participant's page.
- Editing already exists (`PUT /api/interactions/<id>`); it is extended to replace the participant list.

## Data
- New table `interaction_contacts(interaction_id, contact_id)`, PK on both, both FKs `ON DELETE CASCADE`.
- `interactions` loses `contact_id`. Fresh DBs get the new shape from `schema.sql`. Existing DBs: `migrate_db()` copies `(id, contact_id)` into `interaction_contacts` (INSERT OR IGNORE), then rebuilds `interactions` without `contact_id` (only when the old column is present).
- Deleting a contact removes their join rows; any interaction left with zero participants is then deleted.

## API
- `POST /api/interactions`: `{contact_ids: [..], type, summary, interaction_date}`. `contact_ids` must be a non-empty list of existing contact ids; duplicates collapsed; unknown id → 400.
- `PUT /api/interactions/<id>`: same body; `contact_ids` is required and replaces the participant set.
- Every returned interaction carries `contacts: [{id, first_name, last_name}]` sorted by last then first name (case-insensitive). Applies to POST/PUT responses, `GET /api/contacts/<id>/interactions`, and `/api/dashboard` `recent_interactions`.
- `GET /api/contacts/<id>/interactions` returns interactions where the contact is a participant, newest first.

## UI
- Contact page Log/Edit modal: a "With" field = chips of participants (current contact pre-selected on create) + "Add another contact…" dropdown of the remaining contacts. Chips removable; at least one must remain (enforced client- and server-side).
- Contact page interaction rows show "With: <other participants, linked>" when there are others.
- Dashboard Recent Interactions lists all participants as links.
- Dashboard Recent Activity and Upcoming: first 5 shown; if more, a "Show N more" button expands, then "Show less". Client-side only; server limits unchanged.

## Testing
Multi-contact create/list/edit; validation (empty, non-list, unknown id, duplicates); contact delete keeps interaction while others remain and removes it when none do; migration of an old-shape DB preserves data; dashboard payload includes contacts.

## Out of scope
Global log-interaction entry point, per-participant notes, interactions on company timeline.
