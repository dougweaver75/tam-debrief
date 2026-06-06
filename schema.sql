CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name  TEXT    NOT NULL,
    last_name   TEXT    NOT NULL,
    company     TEXT    DEFAULT '',
    title       TEXT    DEFAULT '',
    email       TEXT    DEFAULT '',
    phone       TEXT    DEFAULT '',
    notes       TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id       INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type             TEXT    NOT NULL CHECK(type IN ('call','email','meeting','note')),
    summary          TEXT    NOT NULL,
    interaction_date TEXT    NOT NULL,
    created_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    value       REAL    NOT NULL DEFAULT 0,
    stage       TEXT    NOT NULL DEFAULT 'lead'
                CHECK(stage IN ('lead','qualified','proposal','closed-won','closed-lost')),
    notes       TEXT    DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    industry   TEXT    DEFAULT '',
    website    TEXT    DEFAULT '',
    address    TEXT    DEFAULT '',
    notes      TEXT    DEFAULT '',
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    meeting_date TEXT    NOT NULL,
    company_id   INTEGER REFERENCES companies(id) ON DELETE SET NULL,
    notes        TEXT    DEFAULT '',
    summary      TEXT    DEFAULT '',
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_attendees (
    meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (meeting_id, contact_id)
);

CREATE TABLE IF NOT EXISTS action_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id   INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    assigned_to  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
    description  TEXT    NOT NULL,
    due_date      TEXT,
    due_date_text TEXT,
    completed     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
);
