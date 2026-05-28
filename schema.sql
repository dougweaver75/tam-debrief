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
