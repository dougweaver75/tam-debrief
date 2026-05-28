# CCRM — Personal CRM

Flask + SQLite personal CRM. Single-file backend (`app.py`), Jinja2 templates, vanilla JS frontend.

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
