# CCRM — Personal CRM

Flask + SQLite personal CRM. Single-file backend (`app.py`), Jinja2 templates, vanilla JS frontend. Started as a lightweight contacts/deals tracker and has grown into a meeting-workflow-focused CRM with interaction logging, action items, and a built-in meeting notes sanitization pipeline.

## Running

```
run.bat          # installs deps + starts server + opens browser
python app.py    # dev start (browser opens after 1.2s via threading.Timer)
```

Server: http://localhost:5000/

## Tests

```
python -m pytest tests/ -v
```

## DB

`ccrm.db` at project root. Re-init: delete `ccrm.db` and restart — `init_db()` runs automatically on first start.

## Key files

- `app.py` — all Flask routes and SQL
- `schema.sql` — DDL
- `static/app.js` — all client JS (API helpers, page init functions, renderers)
- `static/style.css` — all styles
- `templates/` — Jinja2 page templates

## Future Features (Backlog)

- **Reporting/output** — exportable summaries of activity: meetings per contact, open action items, deal pipeline snapshot. Likely a `/reports` page with printable/CSV views. No external deps — raw SQL + browser print or simple CSV download.
- **Auto-populate action items from notes** — non-LLM rule-based extraction: scan meeting notes for patterns like "will", "needs to", "action:", "follow up", bullet points starting with a verb, etc. Surface candidates for the user to confirm before adding. Keep it fast and local.
- **Full-page meeting entry** — replace the meeting creation modal with a dedicated `/meetings/new` page (same layout as the detail view). Reduces clutter, allows richer input upfront (notes, attendees, company) without a cramped popup. Edit and create would share the same page component.
