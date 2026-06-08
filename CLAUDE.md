# TAM Debrief — Personal CRM

Flask + SQLite TAM-focused CRM. Single-file backend (`app.py`), Jinja2 templates, vanilla JS frontend. Built around meeting workflows: contacts, companies, interaction logging, action items, deal pipeline, and a built-in notes sanitization + LLM summary pipeline.

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

## Key behaviors

- `app.config['TEMPLATES_AUTO_RELOAD'] = True` — prevents Jinja2 bytecode cache from serving stale templates during development
- **Stale server warning**: Windows `SO_REUSEADDR` allows multiple Flask processes to bind to the same port. If changes aren't reflected after restart, check for orphaned processes: `netstat -ano | Select-String ":5000"` then `Stop-Process -Id <pid> -Force` for each
- Company and contact detail pages cross-link associated meetings and action items via `/api/contacts/<id>/meetings`, `/api/contacts/<id>/action-items`, `/api/companies/<id>/meetings`, `/api/companies/<id>/action-items`
- Redact page (`/sanitize`) includes a "Copy Prompt" button that prepends the full LLM prompt template to the sanitized notes for clipboard. The LLM response textarea is cleared on each new prompt copy to prevent stale content from being saved

## Future Features (Backlog)

- **Reporting/output** — exportable summaries of activity: meetings per contact, open action items, deal pipeline snapshot. Likely a `/reports` page with printable/CSV views. No external deps — raw SQL + browser print or simple CSV download.
- **Full-page meeting entry** — replace the meeting creation modal with a dedicated `/meetings/new` page (same layout as the detail view). Reduces clutter, allows richer input upfront (notes, attendees, company) without a cramped popup. Edit and create would share the same page component.
