# Account Team Members as Meeting Attendees — Design

Date: 2026-10-02

## Goal
On a meeting that has a company, let the user add that company's account team members as attendees, without creating contact or company records for them.

## Background
Meeting attendees are rows in `meeting_attendees(meeting_id, contact_id)`; account team members live in `account_team_members` and are not contacts. Adding a colleague via the meeting page's "+ New" person form creates a contact with a free-text company, which shows up as a separate company group on the Contacts page.

## Decisions
- Option A (attendees can be a contact or a team member), attendees only. Action-item assignment and Redact stay contact-only (future milestone).
- Implemented as a separate join table `meeting_team_attendees`; `meeting_attendees` is untouched (no rebuild; action items, Redact, contact pages keep working).
- `GET /api/meetings/<id>/attendees` stays contacts-only (the action-item assignee dropdown reads it and must not offer team members).
- The optional "+ New" company-dropdown hardening is NOT included.

## Data
`meeting_team_attendees(meeting_id, team_member_id)`, PK on both, both FKs `ON DELETE CASCADE`.

## API
- `GET /api/meetings/<id>/team-attendees` → team member rows (`account_team_members` columns), ordered by role order then name. 404 if meeting missing.
- `POST /api/meetings/<id>/team-attendees` `{team_member_id}` → 201 `{ok:true}`. 404 if meeting missing; 400 if `team_member_id` is not an int or unknown, if the meeting has no company, or if the member's company differs from the meeting's company. Idempotent (INSERT OR IGNORE).
- `DELETE /api/meetings/<id>/team-attendees/<tid>` → `{ok:true}` or 404.
- `PUT /api/meetings/<id>`: after updating, team attendees not belonging to the (new) company are removed.
- `GET /api/companies/<id>/meetings` `attendee_count` = contact attendees + team attendees.

## UI (meeting detail page)
- "Add attendee" dropdown: contacts (value `c:<id>`) plus an optgroup "Account Team — {Company}" (value `t:<id>`, label "Name — Role/Title") for that company's team members not already attending. No group when the meeting has no company or no team members remain.
- Attendee list: contacts as today, then team members with an "Account Team" badge and role/title; no contact link; remove button works for both kinds.
- After saving a meeting edit (company may have changed), the attendee list and dropdown are refreshed.

## Testing
Add/list/remove, idempotent add, wrong-company / no-company / unknown / non-int rejections, 404s, cascade on team-member delete, drop on company change (and keep when unchanged), attendee_count, contacts-only attendees endpoint unaffected.

## Out of scope
Team members as action-item assignees, Redact context, the "+ New" company dropdown, shared people directory.
