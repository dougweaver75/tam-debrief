# Sanitizer Integration — Design Spec
_Date: 2026-06-05_

## Overview

Integrate the claude-sanitizer functionality into CCRM as a dedicated `/sanitize` page. The page supports a four-step pipeline: load meeting context → sanitize raw notes for LLM → copy sanitized text to external LLM → paste organized summary back and save. The CRM's existing contacts and companies data auto-populates the entity registry, eliminating manual entry.

---

## Architecture

### Schema change
Add `summary TEXT DEFAULT ''` to the `meetings` table via `migrate_db()`. The existing `notes` field is untouched — raw notes and LLM-processed summary are stored separately.

```sql
ALTER TABLE meetings ADD COLUMN summary TEXT DEFAULT '';
```

Wrapped in a try/except to ignore `duplicate column` errors (same pattern as existing `migrate_db()` calls).

### New Flask routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/sanitize` | Serves `templates/sanitize.html` |
| `GET` | `/api/sanitize/context?meeting_id=X` | Returns meeting title, raw notes, attendees, and company for entity pre-population |
| `PATCH` | `/api/meetings/<id>/summary` | Saves the LLM-processed summary to `meetings.summary` |

### `/api/sanitize/context` response shape
```json
{
  "meeting_id": 1,
  "title": "Q2 Review",
  "notes": "Raw meeting notes...",
  "company": { "id": 3, "name": "Acme Corp" },
  "attendees": [
    { "id": 7, "first_name": "Jane", "last_name": "Doe" },
    { "id": 8, "first_name": "Bob", "last_name": "Smith" }
  ]
}
```

### Existing files changed
- `app.py` — add 3 routes and `migrate_db()` column
- `templates/meeting.html` — add "Sanitize Notes" link button + summary display section
- `schema.sql` — add `summary` column definition

---

## Page Layout (`templates/sanitize.html`)

Two-column layout consistent with existing CCRM styling.

**Left column: Context**
- Meeting picker dropdown (all meetings, sorted by date desc)
- Entity registry panel — list of masked entities with add/remove
  - Auto-populated on meeting select: one Person entry per attendee (full name), one Company entry for the meeting's company (if set)
  - "No entities auto-loaded — add them manually" notice when meeting has no attendees/company
  - Manual add: name input + type selector (Person / Company)

**Right column: Pipeline**
- Top panel: Raw notes textarea (pre-filled from `meeting.notes`) + "Sanitize" button + masked output panel (read-only) with Copy button
- Bottom panel: "Paste LLM Response" textarea + "Save Summary to Meeting" button

---

## Data Flow

1. **Page load with `?meeting_id=X`** — fetches `/api/sanitize/context?meeting_id=X`, populates meeting picker, raw notes, and entity registry.
2. **Meeting picker change** — same fetch; clears and re-populates all fields.
3. **Sanitize** — pure client-side JS (ported from claude-sanitizer). Builds combined regex from entity list, masks matches in raw notes text, renders masked output in read-only panel.
4. **Copy** — copies masked output to clipboard.
5. **Paste LLM response** — user pastes organized LLM output into the bottom textarea.
6. **Save Summary** — `PATCH /api/meetings/<id>/summary` with `{ "summary": "<text>" }`. Uses currently-selected meeting ID.

---

## Meeting Detail Page Changes

- **Summary section** renders **first**, above raw notes, when `meeting.summary` is non-empty. Read-only display.
- **"Sanitize Notes" button** at the bottom of the detail page — links to `/sanitize?meeting_id=X`.

---

## Sanitization Logic

Ported directly from `claude-sanitizer` (client-side JS only):
- Sort entities longest-first to prevent partial-match shadowing
- Build one combined regex: `\b(?:alt1|alt2|...)\b` with `gi` flags
- Multi-word entities use `\s+` between words
- `maskWord(w)` — keeps first char, replaces rest with `*`
- `maskPhrase(match)` — masks each word independently, wraps in `[]`

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No meeting selected, "Save Summary" clicked | Button disabled — no-op |
| Empty paste area, "Save Summary" clicked | Toast: "Nothing to save" |
| Meeting has no attendees/company | Entity registry starts empty with notice |
| Meeting has no raw notes | Raw notes textarea starts empty; user can type |
| `/api/sanitize/context` returns 404 | Toast: "Meeting not found", reset page state |
| `PATCH /api/meetings/<id>/summary` fails | Toast: "Save failed, try again" |
| `migrate_db()` duplicate column | Exception swallowed silently |

---

## Out of Scope

- Persisting the entity registry between sessions (entities are rebuilt from CRM data each time)
- Sanitizing non-meeting text fields (contact notes, interaction summaries)
- Sending text directly to an LLM from within CCRM (copy/paste remains manual)
