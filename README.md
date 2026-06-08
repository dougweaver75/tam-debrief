# TAM Debrief

A lightweight, locally-hosted CRM built around the Technical Account Manager meeting workflow. Log meetings, track action items, manage contacts and companies, and run a PII-sanitized LLM summary pipeline — all from a single Python process, with no cloud dependency and no data leaving your machine.

---

## Why this exists

Most CRM tools are designed for sales pipelines, not for the post-meeting workflow a TAM lives in. TAM Debrief addresses three specific gaps:

- **No structured meeting record.** There's no lightweight place to link notes, attendees, and follow-up items under one meeting tied to an account.
- **Unsanitized data sent to LLMs.** Using ChatGPT or Claude to clean up notes means raw customer names go to a third-party model unless you manually scrub them first.
- **Action items lost after meetings.** Commitments buried in notes rarely surface anywhere unified.

---

## Features

| Area | What it does |
|---|---|
| **Contacts** | Full name, title, email, phone, company association, org-chart notes. Searchable list + detail page. |
| **Companies** | Profile with industry, website, address, notes. Cross-linked to all contacts, meetings, and action items. |
| **Meetings** | Dated records linked to a company and attendees from your contact database. Stores raw notes and an LLM summary side by side. |
| **Action Items** | Owned by named contacts, optional due dates, completable. Surfaced on the dashboard and on each contact's page. |
| **Interaction Log** | Chronological log of calls, emails, meetings, and notes per contact for call-prep and activity history. |
| **Deal Pipeline** | Opportunity tracking across Lead → Qualified → Proposal → Closed-Won / Closed-Lost, linked to a contact. |
| **Redact (PII Sanitizer)** | Register people and company names; the engine masks them with placeholder tokens before any text leaves the app. |
| **LLM Summary Pipeline** | Structured prompt template + sanitized notes → paste into any LLM → paste response back → summary saved and action items extracted automatically. |
| **Dashboard** | At-a-glance view of all open action items and recent interactions across the account base. |

---

## Meeting notes workflow

This is the core differentiator. A complete cycle from raw notes to structured CRM record:

```
1. Create Meeting  →  Log with date, account, and attendees from your contact list
2. Capture Notes   →  Paste or type raw meeting notes into the record
3. Redact PII      →  Attendee names and company name auto-load; click Sanitize
4. Copy Prompt     →  Bundled LLM prompt + sanitized notes copied to clipboard
5. Run LLM         →  Paste into Claude, ChatGPT, or any model; copy the response
6. Save & Extract  →  Paste response back; summary saved, action items parsed and reviewed
```

The LLM prompt instructs the model to produce a specific two-section format: a narrative summary followed by a markdown table of action items with owner and due-date columns. The app parses that table directly and presents the extracted items for confirmation before saving.

Because names are masked before anything leaves the app, the text the LLM sees contains no customer-identifiable information — placeholders like `[B*** S***]` appear instead of real names.

---

## Getting started

### Prerequisites

- Python 3.10 or higher
- Any modern web browser

### Installation

```bash
git clone https://github.com/dougweaver75/ccrm.git
cd ccrm
```

**Windows** — just double-click `run.bat` or run it from a terminal. It installs dependencies, starts the server, and opens the browser automatically.

```bat
run.bat
```

**Mac / Linux**

```bash
pip install -r requirements.txt
python app.py
```

Then open [http://localhost:5000](http://localhost:5000).

The database (`ccrm.db`) is created automatically on first run. To reset, delete the file and restart.

---

## Running tests

```bash
python -m pytest tests/ -v
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3 / Flask 3.x |
| Database | SQLite 3 — single file, no server |
| Frontend | Vanilla JavaScript, HTML, CSS — no framework, no build step |
| Markdown rendering | [marked.js](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify) (both self-hosted) |
| Fonts / Icons | Inter + Material Icons Round (self-hosted — no Google requests) |

The entire backend is a single file (`app.py`). There is no ORM — all queries use raw `sqlite3` with parameterized statements. There is no npm, no Webpack, no transpilation step. The whole application fits in a single directory you can zip up and move anywhere Python runs.

---

## Project structure

```
ccrm/
├── app.py              # All Flask routes and SQL — the entire backend
├── schema.sql          # Database DDL
├── requirements.txt    # Flask only
├── run.bat             # Windows launcher
├── static/
│   ├── app.js          # All client-side JavaScript
│   ├── style.css       # All styles
│   ├── marked.min.js   # Markdown renderer (self-hosted)
│   ├── purify.min.js   # HTML sanitizer (self-hosted)
│   └── fonts/          # Inter woff2 + Material Icons Round otf
└── templates/          # Jinja2 page templates
    ├── base.html
    ├── dashboard.html
    ├── contacts.html / contact.html
    ├── companies.html / company.html
    ├── meetings.html / meeting.html / meeting_new.html
    └── sanitize.html
```

---

## Deployment notes

The server binds to `127.0.0.1` only — it is not reachable from the network. This is intentional for the single-user local use case.

If you want to run this for a small team, be aware of what is **not** built yet:

- No authentication — any user with network access would have full read/write access
- No multi-user record scoping — all contacts, meetings, and records are shared
- No HTTPS — required before any networked deployment
- SQLite concurrent-write limits — fine for 1–2 users; PostgreSQL is advisable for a larger team

None of these are hard architectural problems, but they are real work before a shared deployment is appropriate.

---

## Data & privacy

- All data is stored in `ccrm.db` on your local machine
- Nothing is transmitted over the network by the application itself
- The LLM pipeline is manual by design: you control what gets pasted where, and the Redact tool gives you a clear sanitization step before anything leaves the app
- No telemetry, no analytics, no external requests (all fonts and libraries are self-hosted)

---

## Known limitations / backlog

- No exportable reports (meetings per contact, open items, pipeline snapshot) — planned
- No mobile-optimized layout
- LLM pipeline is manual — no direct API integration

---

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal, educational, and research use. Commercial use requires permission.
