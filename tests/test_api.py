import os
import sys
import tempfile
import pytest
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as ccrm_app

@pytest.fixture
def client(tmp_path):
    db_file = tmp_path / 'test.db'
    ccrm_app.DB_PATH = str(db_file)
    ccrm_app.app.config['TESTING'] = True
    ccrm_app.init_db()
    ccrm_app.migrate_db()
    with ccrm_app.app.test_client() as client:
        yield client

def test_contacts_list_empty(client):
    r = client.get('/api/contacts')
    assert r.status_code == 200
    assert r.get_json() == []

def test_dashboard_empty(client):
    r = client.get('/api/dashboard')
    data = r.get_json()
    assert r.status_code == 200
    assert data['total_contacts'] == 0
    assert data['open_action_items'] == 0
    assert data['companies'] == []

def test_create_contact(client):
    r = client.post('/api/contacts', json={
        'first_name': 'Alice', 'last_name': 'Smith',
        'company': 'Acme', 'email': 'alice@acme.com'
    })
    assert r.status_code == 201
    data = r.get_json()
    assert data['first_name'] == 'Alice'
    assert data['id'] is not None

def test_list_contacts_search(client):
    client.post('/api/contacts', json={'first_name': 'Bob', 'last_name': 'Jones', 'company': 'Beta'})
    client.post('/api/contacts', json={'first_name': 'Carol', 'last_name': 'White', 'company': 'Gamma'})
    r = client.get('/api/contacts?search=carol')
    data = r.get_json()
    assert len(data) == 1
    assert data[0]['first_name'] == 'Carol'

def test_update_contact(client):
    r = client.post('/api/contacts', json={'first_name': 'Dave', 'last_name': 'Lee'})
    cid = r.get_json()['id']
    r2 = client.put(f'/api/contacts/{cid}', json={'first_name': 'David', 'last_name': 'Lee'})
    assert r2.status_code == 200
    assert r2.get_json()['first_name'] == 'David'

def test_delete_contact(client):
    r = client.post('/api/contacts', json={'first_name': 'Eve', 'last_name': 'Brown'})
    cid = r.get_json()['id']
    client.delete(f'/api/contacts/{cid}')
    r2 = client.get(f'/api/contacts/{cid}')
    assert r2.status_code == 404

def _make_contact(client, fname='Test', lname='User'):
    r = client.post('/api/contacts', json={'first_name': fname, 'last_name': lname})
    return r.get_json()['id']

def test_create_interaction(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={
        'contact_ids': [cid], 'type': 'call',
        'summary': 'Quick check-in', 'interaction_date': '2026-05-28'
    })
    assert r.status_code == 201
    data = r.get_json()
    assert data['type'] == 'call'
    assert [c['id'] for c in data['contacts']] == [cid]
    assert 'contact_id' not in data

def test_list_interactions(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_ids': [cid], 'type': 'email', 'summary': 'Follow up', 'interaction_date': '2026-05-27'})
    client.post('/api/interactions', json={'contact_ids': [cid], 'type': 'meeting', 'summary': 'Demo call', 'interaction_date': '2026-05-28'})
    r = client.get(f'/api/contacts/{cid}/interactions')
    data = r.get_json()
    assert len(data) == 2
    assert data[0]['interaction_date'] == '2026-05-28'  # sorted newest first

def test_delete_interaction(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={'contact_ids': [cid], 'type': 'note', 'summary': 'Note', 'interaction_date': '2026-05-28'})
    iid = r.get_json()['id']
    client.delete(f'/api/interactions/{iid}')
    r2 = client.get(f'/api/contacts/{cid}/interactions')
    assert r2.get_json() == []

def test_update_interaction(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={
        'contact_ids': [cid], 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'
    })
    iid = r.get_json()['id']
    r2 = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [cid], 'type': 'email', 'summary': 'Updated', 'interaction_date': '2026-05-29'
    })
    assert r2.status_code == 200
    d = r2.get_json()
    assert d['type'] == 'email'
    assert d['summary'] == 'Updated'
    assert d['interaction_date'] == '2026-05-29'
    assert d['updated_at'] is not None

def test_update_interaction_invalid_type(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={
        'contact_ids': [cid], 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'
    })
    iid = r.get_json()['id']
    r2 = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [cid], 'type': 'bogus', 'summary': 'x', 'interaction_date': '2026-05-28'
    })
    assert r2.status_code == 400

def test_update_interaction_not_found(client):
    r = client.put('/api/interactions/999', json={
        'contact_ids': [1], 'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-28'
    })
    assert r.status_code == 404


def test_delete_cascades(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_ids': [cid], 'type': 'call', 'summary': 'X', 'interaction_date': '2026-05-28'})
    r_del = client.delete(f'/api/contacts/{cid}')
    assert r_del.status_code == 200
    assert r_del.get_json()['ok'] is True
    r = client.get(f'/api/contacts/{cid}')
    assert r.status_code == 404
    assert client.get(f'/api/contacts/{cid}/interactions').get_json() == []

def test_dashboard_stats(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_ids': [cid], 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'})
    r = client.get('/api/dashboard')
    d = r.get_json()
    assert d['total_contacts'] == 1
    assert d['total_meetings'] == 0
    assert d['open_action_items'] == 0
    assert len(d['recent_interactions']) == 1
    assert d['action_items'] == []

def test_deals_api_removed(client):
    cid = _make_contact(client)
    assert client.post('/api/deals', json={'contact_id': cid, 'title': 'X', 'value': 0, 'stage': 'lead'}).status_code == 404
    assert client.get(f'/api/contacts/{cid}/deals').status_code == 404

def test_companies_table_exists(client):
    r = client.get('/api/companies')
    assert r.status_code == 200
    assert r.get_json() == []

def test_dashboard_company_counts(client):
    co = client.post('/api/companies', json={'name': 'Acme Corp'}).get_json()
    client.post('/api/contacts', json={'first_name': 'A', 'last_name': 'B', 'company_id': co['id']})
    client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-05-28', 'company_id': co['id']})
    d = client.get('/api/dashboard').get_json()
    assert len(d['companies']) == 1
    row = d['companies'][0]
    assert row['name'] == 'Acme Corp'
    assert row['contact_count'] == 1
    assert row['meeting_count'] == 1
    assert 'logo' in row

def test_company_logo_defaults_empty(client):
    co = client.post('/api/companies', json={'name': 'NoLogo Co'}).get_json()
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == ''

def test_company_logo_roundtrip(client):
    uri = 'data:image/png;base64,iVBORw0KGgo='
    co = client.post('/api/companies', json={'name': 'Logo Co', 'logo': uri}).get_json()
    assert co['logo'] == uri
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == uri
    client.put(f"/api/companies/{co['id']}", json={'name': 'Logo Co', 'logo': ''})
    assert client.get(f"/api/companies/{co['id']}").get_json()['logo'] == ''

def test_company_logo_preserved_when_key_absent(client):
    uri = 'data:image/png;base64,iVBORw0KGgo='
    co = client.post('/api/companies', json={'name': 'Keep Co', 'logo': uri}).get_json()
    client.put(f"/api/companies/{co['id']}", json={'name': 'Keep Co Renamed'})
    got = client.get(f"/api/companies/{co['id']}").get_json()
    assert got['name'] == 'Keep Co Renamed'
    assert got['logo'] == uri

def test_meetings_table_exists(client):
    r = client.get('/api/meetings')
    assert r.status_code == 200
    assert r.get_json() == []

def test_create_company(client):
    r = client.post('/api/companies', json={'name': 'Acme Corp', 'industry': 'Tech'})
    assert r.status_code == 201
    d = r.get_json()
    assert d['name'] == 'Acme Corp'
    assert d['industry'] == 'Tech'
    assert d['id'] is not None

def test_create_company_name_required(client):
    r = client.post('/api/companies', json={'industry': 'Tech'})
    assert r.status_code == 400

def test_update_company(client):
    r = client.post('/api/companies', json={'name': 'OldName'})
    coid = r.get_json()['id']
    r2 = client.put(f'/api/companies/{coid}', json={'name': 'NewName', 'website': 'https://newname.com'})
    assert r2.status_code == 200
    assert r2.get_json()['name'] == 'NewName'

def test_delete_company(client):
    r = client.post('/api/companies', json={'name': 'TempCo'})
    coid = r.get_json()['id']
    assert client.delete(f'/api/companies/{coid}').status_code == 200
    assert client.get(f'/api/companies/{coid}').status_code == 404

def test_company_contacts_list(client):
    r_co = client.post('/api/companies', json={'name': 'BetaCorp'})
    coid = r_co.get_json()['id']
    client.post('/api/contacts', json={'first_name': 'Ann', 'last_name': 'Doe', 'company_id': coid})
    r = client.get(f'/api/companies/{coid}/contacts')
    assert r.status_code == 200
    assert len(r.get_json()) == 1
    assert r.get_json()[0]['first_name'] == 'Ann'

def test_contact_with_company_id(client):
    r_co = client.post('/api/companies', json={'name': 'AcmeCorp'})
    coid = r_co.get_json()['id']
    r = client.post('/api/contacts', json={
        'first_name': 'John', 'last_name': 'Doe', 'company_id': coid
    })
    assert r.status_code == 201
    assert r.get_json()['company_id'] == coid
    contacts = client.get(f'/api/companies/{coid}/contacts').get_json()
    assert len(contacts) == 1
    assert contacts[0]['first_name'] == 'John'


def test_create_meeting(client):
    r = client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-06-01'})
    assert r.status_code == 201
    d = r.get_json()
    assert d['title'] == 'Kickoff'
    assert d['id'] is not None

def test_create_meeting_required_fields(client):
    assert client.post('/api/meetings', json={'meeting_date': '2026-06-01'}).status_code == 400
    assert client.post('/api/meetings', json={'title': 'X'}).status_code == 400

def test_update_meeting(client):
    r = client.post('/api/meetings', json={'title': 'Draft', 'meeting_date': '2026-06-01'})
    mid = r.get_json()['id']
    r2 = client.put(f'/api/meetings/{mid}', json={'title': 'Final', 'meeting_date': '2026-06-02'})
    assert r2.status_code == 200
    assert r2.get_json()['title'] == 'Final'

def test_delete_meeting(client):
    r = client.post('/api/meetings', json={'title': 'TempMeet', 'meeting_date': '2026-06-01'})
    mid = r.get_json()['id']
    assert client.delete(f'/api/meetings/{mid}').status_code == 200
    assert client.get(f'/api/meetings/{mid}').status_code == 404

def test_meeting_attendees(client):
    cid = _make_contact(client)
    r = client.post('/api/meetings', json={'title': 'Demo', 'meeting_date': '2026-06-01'})
    mid = r.get_json()['id']
    r_add = client.post(f'/api/meetings/{mid}/attendees', json={'contact_id': cid})
    assert r_add.status_code == 201
    attendees = client.get(f'/api/meetings/{mid}/attendees').get_json()
    assert len(attendees) == 1
    assert attendees[0]['id'] == cid
    assert client.delete(f'/api/meetings/{mid}/attendees/{cid}').status_code == 200
    assert client.get(f'/api/meetings/{mid}/attendees').get_json() == []


def _make_meeting(client, title='Test Meeting', date='2026-06-01'):
    r = client.post('/api/meetings', json={'title': title, 'meeting_date': date})
    return r.get_json()['id']

def test_create_action_item(client):
    cid = _make_contact(client)
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={
        'description': 'Send follow-up email',
        'due_date': '2026-06-05',
        'assigned_to': cid
    })
    assert r.status_code == 201
    d = r.get_json()
    assert d['description'] == 'Send follow-up email'
    assert d['completed'] == 0

def test_action_item_description_required(client):
    mid = _make_meeting(client)
    assert client.post(f'/api/meetings/{mid}/action_items', json={'due_date': '2026-06-01'}).status_code == 400

def test_toggle_action_item(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Do X'})
    aid = r.get_json()['id']
    r2 = client.patch(f'/api/action_items/{aid}/toggle')
    assert r2.status_code == 200
    assert r2.get_json()['completed'] == 1
    r3 = client.patch(f'/api/action_items/{aid}/toggle')
    assert r3.get_json()['completed'] == 0

def test_update_action_item(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Old desc'})
    aid = r.get_json()['id']
    r2 = client.put(f'/api/action_items/{aid}', json={'description': 'New desc', 'due_date': '2026-06-10'})
    assert r2.status_code == 200
    assert r2.get_json()['description'] == 'New desc'

def test_delete_action_item(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Temp item'})
    aid = r.get_json()['id']
    assert client.delete(f'/api/action_items/{aid}').status_code == 200
    assert client.get(f'/api/meetings/{mid}/action_items').get_json() == []

def test_update_meeting_summary(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Team Sync', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.patch(f'/api/meetings/{meeting["id"]}/summary',
                     json={'summary': 'Key decisions made.'})
    assert r.status_code == 200
    assert r.get_json()['ok'] is True
    m = client.get(f'/api/meetings/{meeting["id"]}').get_json()
    assert m['summary'] == 'Key decisions made.'

def test_update_meeting_summary_not_found(client):
    r = client.patch('/api/meetings/999/summary', json={'summary': 'nope'})
    assert r.status_code == 404

def test_update_meeting_summary_empty(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Sync', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.patch(f'/api/meetings/{meeting["id"]}/summary', json={'summary': ''})
    assert r.status_code == 400

def test_sanitize_context_with_attendees_and_company(client):
    co = client.post('/api/companies', json={'name': 'Acme Corp'}).get_json()
    meeting = client.post('/api/meetings', json={
        'title': 'Q2 Review', 'meeting_date': '2026-06-01',
        'company_id': co['id'], 'notes': 'Raw notes here'
    }).get_json()
    c1 = client.post('/api/contacts', json={'first_name': 'Jane', 'last_name': 'Doe'}).get_json()
    c2 = client.post('/api/contacts', json={'first_name': 'Bob', 'last_name': 'Smith'}).get_json()
    client.post(f'/api/meetings/{meeting["id"]}/attendees', json={'contact_id': c1['id']})
    client.post(f'/api/meetings/{meeting["id"]}/attendees', json={'contact_id': c2['id']})

    r = client.get(f'/api/sanitize/context?meeting_id={meeting["id"]}')
    assert r.status_code == 200
    data = r.get_json()
    assert data['meeting_id'] == meeting['id']
    assert data['title'] == 'Q2 Review'
    assert data['notes'] == 'Raw notes here'
    assert data['company']['name'] == 'Acme Corp'
    assert len(data['attendees']) == 2
    first_names = {a['first_name'] for a in data['attendees']}
    assert first_names == {'Jane', 'Bob'}

def test_sanitize_context_no_company_no_attendees(client):
    meeting = client.post('/api/meetings', json={
        'title': 'Solo Meeting', 'meeting_date': '2026-06-01'
    }).get_json()
    r = client.get(f'/api/sanitize/context?meeting_id={meeting["id"]}')
    assert r.status_code == 200
    data = r.get_json()
    assert data['company'] is None
    assert data['attendees'] == []

def test_sanitize_context_not_found(client):
    r = client.get('/api/sanitize/context?meeting_id=999')
    assert r.status_code == 404

def test_sanitize_context_missing_param(client):
    r = client.get('/api/sanitize/context')
    assert r.status_code == 400

def test_put_meeting_preserves_summary(client):
    mid = client.post('/api/meetings', json={
        'title': 'Original', 'meeting_date': '2026-06-01'
    }).get_json()['id']
    client.patch(f'/api/meetings/{mid}/summary', json={'summary': 'preserved'})
    client.put(f'/api/meetings/{mid}', json={
        'title': 'Updated', 'meeting_date': '2026-06-01', 'notes': 'new notes'
    })
    m = client.get(f'/api/meetings/{mid}').get_json()
    assert m['summary'] == 'preserved'

def test_new_meeting_page(client):
    r = client.get('/meetings/new')
    assert r.status_code == 200
    assert b'mTitle' in r.data
    assert b'mNotes' in r.data
    assert b'New Meeting' in r.data
    assert b'saveNewMeeting' in r.data

def test_put_meeting_returns_company_name(client):
    r_co = client.post('/api/companies', json={'name': 'TestCo'})
    coid = r_co.get_json()['id']
    r = client.post('/api/meetings', json={'title': 'M', 'meeting_date': '2026-06-06', 'company_id': coid})
    mid = r.get_json()['id']
    r2 = client.put(f'/api/meetings/{mid}', json={'title': 'M Updated', 'meeting_date': '2026-06-06', 'company_id': coid})
    assert r2.status_code == 200
    assert r2.get_json()['company_name'] == 'TestCo'

def test_create_action_item_with_due_date_text(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={
        'description': 'Schedule follow-up',
        'due_date_text': 'within a couple of weeks',
    })
    assert r.status_code == 201
    assert r.get_json()['due_date_text'] == 'within a couple of weeks'

def test_update_action_item_due_date_text(client):
    mid = _make_meeting(client)
    r = client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Do X'})
    aid = r.get_json()['id']
    r2 = client.put(f'/api/action_items/{aid}', json={
        'description': 'Do X',
        'due_date_text': 'end of Q3',
    })
    assert r2.status_code == 200
    assert r2.get_json()['due_date_text'] == 'end of Q3'

def test_new_tables_and_columns_exist(client):
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert 'company_notes' in tables
    assert 'timeline_events' in tables
    cols = {r[1] for r in conn.execute("PRAGMA table_info(interactions)")}
    assert 'updated_at' in cols
    conn.close()


def _make_company(client, name='Acme Corp'):
    r = client.post('/api/companies', json={'name': name})
    return r.get_json()['id']


def test_company_notes_crud(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/notes', json={'body': 'First note'})
    assert r.status_code == 201
    note = r.get_json()
    assert note['body'] == 'First note'
    nid = note['id']

    r2 = client.post(f'/api/companies/{coid}/notes', json={'body': 'Second note'})
    nid2 = r2.get_json()['id']

    r3 = client.get(f'/api/companies/{coid}/notes')
    data = r3.get_json()
    assert len(data) == 2
    assert data[0]['id'] == nid2  # newest first

    r4 = client.put(f'/api/notes/{nid}', json={'body': 'Updated note'})
    assert r4.status_code == 200
    assert r4.get_json()['body'] == 'Updated note'

    r5 = client.delete(f'/api/notes/{nid2}')
    assert r5.status_code == 200
    r6 = client.get(f'/api/companies/{coid}/notes')
    assert len(r6.get_json()) == 1


def test_company_note_body_required(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/notes', json={'body': '   '})
    assert r.status_code == 400


def test_company_note_company_not_found(client):
    r = client.post('/api/companies/999/notes', json={'body': 'x'})
    assert r.status_code == 404
    r2 = client.get('/api/companies/999/notes')
    assert r2.status_code == 404


def test_note_update_and_delete_not_found(client):
    assert client.put('/api/notes/999', json={'body': 'x'}).status_code == 404
    assert client.delete('/api/notes/999').status_code == 404


def test_timeline_events_crud(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'renewal', 'title': 'Contract renewed',
        'description': 'Renewed for 1yr', 'event_date': '2026-06-01'
    })
    assert r.status_code == 201
    ev = r.get_json()
    assert ev['category'] == 'renewal'
    eid = ev['id']

    r_upd = client.put(f'/api/timeline_events/{eid}', json={
        'category': 'milestone', 'title': 'Contract renewed (updated)',
        'description': '', 'event_date': '2026-06-02'
    })
    assert r_upd.status_code == 200
    assert r_upd.get_json()['category'] == 'milestone'
    assert r_upd.get_json()['event_date'] == '2026-06-02'

    r_del = client.delete(f'/api/timeline_events/{eid}')
    assert r_del.status_code == 200
    r_del2 = client.delete(f'/api/timeline_events/{eid}')
    assert r_del2.status_code == 404

def test_timeline_event_invalid_category_rejected(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'bogus', 'title': 'Bad', 'event_date': '2026-06-01'
    })
    assert r.status_code == 400

def test_timeline_event_defaults_category_other(client):
    coid = _make_company(client)
    r = client.post(f'/api/companies/{coid}/timeline_events', json={
        'title': 'Untyped', 'event_date': '2026-06-01'
    })
    assert r.status_code == 201
    assert r.get_json()['category'] == 'other'

def test_timeline_event_requires_title_and_date(client):
    coid = _make_company(client)
    assert client.post(f'/api/companies/{coid}/timeline_events', json={'event_date': '2026-06-01'}).status_code == 400
    assert client.post(f'/api/companies/{coid}/timeline_events', json={'title': 'X'}).status_code == 400

def test_timeline_event_company_not_found(client):
    r = client.post('/api/companies/999/timeline_events', json={'title': 'X', 'event_date': '2026-06-01'})
    assert r.status_code == 404

def test_company_timeline_merges_sources(client):
    coid = _make_company(client)
    r_m = client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Send SOW', 'due_date': '2026-06-02'})
    client.post(f'/api/companies/{coid}/notes', json={'body': 'Called to check in'})
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'go-live', 'title': 'Go live', 'event_date': '2026-06-03'
    })

    r = client.get(f'/api/companies/{coid}/timeline')
    assert r.status_code == 200
    items = r.get_json()
    assert {i['source'] for i in items} == {'meeting', 'action_item', 'note', 'event'}
    dates = [i['date'] for i in items]
    assert dates == sorted(dates, reverse=True)
    event_item = next(i for i in items if i['source'] == 'event')
    assert event_item['category'] == 'go-live'
    meeting_item = next(i for i in items if i['source'] == 'meeting')
    assert meeting_item['link'] == f'/meetings/{mid}'
    note_item = next(i for i in items if i['source'] == 'note')
    assert note_item['link'] is None

def test_company_timeline_excludes_action_items_without_due_date(client):
    coid = _make_company(client)
    r_m = client.post('/api/meetings', json={'title': 'Kickoff', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'No due date'})
    items = client.get(f'/api/companies/{coid}/timeline').get_json()
    assert not any(i['source'] == 'action_item' for i in items)

def test_company_timeline_not_found(client):
    r = client.get('/api/companies/999/timeline')
    assert r.status_code == 404

def test_dashboard_recent_activity_and_upcoming(client):
    coid = _make_company(client)
    today     = datetime.utcnow().date()
    yesterday = (today - timedelta(days=1)).isoformat()
    tomorrow  = (today + timedelta(days=1)).isoformat()

    client.post('/api/meetings', json={'title': 'Past Meeting', 'meeting_date': yesterday, 'company_id': coid})
    client.post('/api/meetings', json={'title': 'Future Meeting', 'meeting_date': tomorrow, 'company_id': coid})
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'go-live', 'title': 'Past event', 'event_date': yesterday
    })
    client.post(f'/api/companies/{coid}/timeline_events', json={
        'category': 'renewal', 'title': 'Future event', 'event_date': tomorrow
    })

    d = client.get('/api/dashboard').get_json()
    assert 'recent_activity' in d
    assert 'upcoming' in d

    recent_titles = {i['title'] for i in d['recent_activity']}
    assert 'Past Meeting' in recent_titles
    assert 'Past event' in recent_titles
    assert 'Future Meeting' not in recent_titles
    assert 'Future event' not in recent_titles

    upcoming_titles = {i['title'] for i in d['upcoming']}
    assert 'Future Meeting' in upcoming_titles
    assert 'Future event' in upcoming_titles
    assert 'Past Meeting' not in upcoming_titles
    assert 'Past event' not in upcoming_titles

def test_dashboard_upcoming_includes_open_action_items(client):
    coid = _make_company(client)
    tomorrow = (datetime.utcnow().date() + timedelta(days=1)).isoformat()
    r_m = client.post('/api/meetings', json={'title': 'M', 'meeting_date': '2026-06-01', 'company_id': coid})
    mid = r_m.get_json()['id']
    client.post(f'/api/meetings/{mid}/action_items', json={'description': 'Follow up', 'due_date': tomorrow})
    d = client.get('/api/dashboard').get_json()
    assert any(i['title'] == 'Follow up' for i in d['upcoming'])

def test_dashboard_recent_activity_capped_at_15(client):
    coid = _make_company(client)
    for i in range(20):
        client.post(f'/api/companies/{coid}/timeline_events', json={
            'category': 'other', 'title': f'Event {i}', 'event_date': f'2020-01-{(i % 28) + 1:02d}'
        })
    d = client.get('/api/dashboard').get_json()
    assert len(d['recent_activity']) == 15

def test_dashboard_includes_companyless_meetings(client):
    today     = datetime.utcnow().date()
    yesterday = (today - timedelta(days=1)).isoformat()
    tomorrow  = (today + timedelta(days=1)).isoformat()

    r_past = client.post('/api/meetings', json={
        'title': 'Companyless Past Meeting', 'meeting_date': yesterday, 'company_id': None
    })
    past_mid = r_past.get_json()['id']

    r_future = client.post('/api/meetings', json={
        'title': 'Companyless Future Meeting', 'meeting_date': tomorrow, 'company_id': None
    })
    future_mid = r_future.get_json()['id']

    d = client.get('/api/dashboard').get_json()

    past_item = next(i for i in d['recent_activity'] if i['title'] == 'Companyless Past Meeting')
    assert past_item['company_name'] == '—'
    assert past_item['link'] == f'/meetings/{past_mid}'

    future_item = next(i for i in d['upcoming'] if i['title'] == 'Companyless Future Meeting')
    assert future_item['company_name'] == '—'
    assert future_item['link'] == f'/meetings/{future_mid}'


# ── Account team ─────────────────────────────────────────────────────────────

def _add_member(client, coid, **kw):
    body = {'role': 'account_executive', 'name': 'Pat Doe'}
    body.update(kw)
    return client.post(f'/api/companies/{coid}/team', json=body)


def test_account_team_table_exists(client):
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert 'account_team_members' in tables


def test_team_member_crud(client):
    coid = _make_company(client)
    r = _add_member(client, coid, email='pat@us.com', phone='555-1')
    assert r.status_code == 201
    m = r.get_json()
    assert m['role'] == 'account_executive'
    assert m['name'] == 'Pat Doe'
    assert m['email'] == 'pat@us.com'
    assert m['custom_title'] == ''

    r2 = client.put(f"/api/team/{m['id']}", json={
        'role': 'technical_account_manager', 'name': 'Pat D.', 'email': '', 'phone': ''})
    assert r2.status_code == 200
    assert r2.get_json()['role'] == 'technical_account_manager'
    assert r2.get_json()['name'] == 'Pat D.'

    assert client.delete(f"/api/team/{m['id']}").status_code == 200
    assert client.get(f'/api/companies/{coid}/team').get_json() == []


def test_team_other_requires_title(client):
    coid = _make_company(client)
    assert _add_member(client, coid, role='other').status_code == 400
    assert _add_member(client, coid, role='other', custom_title='   ').status_code == 400
    r = _add_member(client, coid, role='other', custom_title='Architect')
    assert r.status_code == 201
    assert r.get_json()['custom_title'] == 'Architect'


def test_team_title_cleared_when_not_other(client):
    coid = _make_company(client)
    r = _add_member(client, coid, role='solutions_consultant', custom_title='Ignored')
    assert r.get_json()['custom_title'] == ''
    mid = _add_member(client, coid, role='other', custom_title='Architect').get_json()['id']
    r2 = client.put(f'/api/team/{mid}', json={
        'role': 'account_executive', 'name': 'Pat Doe', 'custom_title': 'Architect'})
    assert r2.get_json()['custom_title'] == ''


def test_team_validation(client):
    coid = _make_company(client)
    assert _add_member(client, coid, name='  ').status_code == 400
    assert _add_member(client, coid, role='bogus').status_code == 400
    assert _add_member(client, 999).status_code == 404
    assert client.get('/api/companies/999/team').status_code == 404
    assert client.put('/api/team/999', json={'role': 'other', 'name': 'x', 'custom_title': 't'}).status_code == 404
    assert client.delete('/api/team/999').status_code == 404


def test_team_multiple_per_role_and_ordering(client):
    coid = _make_company(client)
    _add_member(client, coid, role='other', custom_title='Architect', name='Zed')
    _add_member(client, coid, role='solutions_consultant', name='Sam')
    _add_member(client, coid, role='technical_account_manager', name='bob')
    _add_member(client, coid, role='technical_account_manager', name='Alice')
    _add_member(client, coid, role='customer_service_manager', name='Cy')
    _add_member(client, coid, role='account_executive', name='Ann')
    members = client.get(f'/api/companies/{coid}/team').get_json()
    assert [(m['role'], m['name']) for m in members] == [
        ('account_executive', 'Ann'),
        ('customer_service_manager', 'Cy'),
        ('technical_account_manager', 'Alice'),
        ('technical_account_manager', 'bob'),
        ('solutions_consultant', 'Sam'),
        ('other', 'Zed'),
    ]


def test_team_cascades_with_company(client):
    coid = _make_company(client)
    _add_member(client, coid)
    client.delete(f'/api/companies/{coid}')
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    assert conn.execute('SELECT COUNT(*) FROM account_team_members').fetchone()[0] == 0
    conn.close()


def test_account_teams_overview(client):
    b = _make_company(client, 'beta')
    a = _make_company(client, 'Acme')
    _make_company(client, 'Empty Co')
    _add_member(client, b, name='Bee')
    _add_member(client, a, role='technical_account_manager', name='Tam')
    _add_member(client, a, role='account_executive', name='Ace')
    data = client.get('/api/account-teams').get_json()
    assert [c['name'] for c in data] == ['Acme', 'beta', 'Empty Co']
    assert [m['name'] for m in data[0]['members']] == ['Ace', 'Tam']
    assert [m['name'] for m in data[1]['members']] == ['Bee']
    assert data[2]['members'] == []


def test_account_teams_page_renders(client):
    r = client.get('/account-teams')
    assert r.status_code == 200


# ── Multi-contact interactions ───────────────────────────────────────────────

def _log(client, cids, **kw):
    body = {'contact_ids': cids, 'type': 'email', 'summary': 'Group email',
            'interaction_date': '2026-05-28'}
    body.update(kw)
    return client.post('/api/interactions', json=body)


def test_interaction_multiple_contacts(client):
    a = _make_contact(client, 'Zed', 'Adams')
    b = _make_contact(client, 'Amy', 'Brown')
    r = _log(client, [b, a])
    assert r.status_code == 201
    # sorted by last name then first name
    assert [c['id'] for c in r.get_json()['contacts']] == [a, b]
    assert set(r.get_json()['contacts'][0]) == {'id', 'first_name', 'last_name'}
    for cid in (a, b):
        items = client.get(f'/api/contacts/{cid}/interactions').get_json()
        assert len(items) == 1
        assert [c['id'] for c in items[0]['contacts']] == [a, b]


def test_interaction_contact_ids_validation(client):
    cid = _make_contact(client)
    assert _log(client, []).status_code == 400
    assert _log(client, 'nope').status_code == 400
    assert _log(client, None).status_code == 400
    assert _log(client, [cid, 999]).status_code == 400
    assert _log(client, ['x']).status_code == 400
    r = _log(client, [cid, cid])
    assert r.status_code == 201
    assert len(r.get_json()['contacts']) == 1


def test_update_interaction_replaces_participants(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    c = _make_contact(client, 'C', 'Three')
    iid = _log(client, [a, b]).get_json()['id']
    r = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [b, c], 'type': 'call', 'summary': 'Edited',
        'interaction_date': '2026-05-29'})
    assert r.status_code == 200
    assert sorted(x['id'] for x in r.get_json()['contacts']) == sorted([b, c])
    assert client.get(f'/api/contacts/{a}/interactions').get_json() == []
    assert len(client.get(f'/api/contacts/{c}/interactions').get_json()) == 1
    # empty / unknown participants rejected, existing set untouched
    bad = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [], 'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-29'})
    assert bad.status_code == 400
    bad2 = client.put(f'/api/interactions/{iid}', json={
        'contact_ids': [999], 'type': 'call', 'summary': 'x', 'interaction_date': '2026-05-29'})
    assert bad2.status_code == 400
    assert len(client.get(f'/api/contacts/{b}/interactions').get_json()) == 1


def test_delete_contact_keeps_shared_interaction(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    _log(client, [a, b])
    client.delete(f'/api/contacts/{a}')
    items = client.get(f'/api/contacts/{b}/interactions').get_json()
    assert len(items) == 1
    assert [c['id'] for c in items[0]['contacts']] == [b]
    client.delete(f'/api/contacts/{b}')
    import sqlite3
    conn = sqlite3.connect(ccrm_app.DB_PATH)
    assert conn.execute('SELECT COUNT(*) FROM interactions').fetchone()[0] == 0
    conn.close()


def test_dashboard_recent_interactions_include_contacts(client):
    a = _make_contact(client, 'A', 'One')
    b = _make_contact(client, 'B', 'Two')
    _log(client, [a, b])
    d = client.get('/api/dashboard').get_json()
    assert len(d['recent_interactions']) == 1
    assert sorted(c['id'] for c in d['recent_interactions'][0]['contacts']) == sorted([a, b])


def test_migrate_legacy_interactions(tmp_path):
    import sqlite3
    orig = ccrm_app.DB_PATH
    try:
        db_file = tmp_path / 'legacy.db'
        conn = sqlite3.connect(db_file)
        conn.executescript('''
            CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL,
                last_name TEXT NOT NULL, company TEXT DEFAULT '', title TEXT DEFAULT '',
                email TEXT DEFAULT '', phone TEXT DEFAULT '', notes TEXT DEFAULT '',
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE interactions (id INTEGER PRIMARY KEY AUTOINCREMENT,
                contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
                type TEXT NOT NULL CHECK(type IN ('call','email','meeting','note')),
                summary TEXT NOT NULL, interaction_date TEXT NOT NULL, created_at TEXT NOT NULL);
            INSERT INTO contacts (first_name,last_name,created_at,updated_at) VALUES ('Old','Timer','t','t');
            INSERT INTO interactions (contact_id,type,summary,interaction_date,created_at)
                VALUES (1,'call','Legacy call','2026-01-02','t');
        ''')
        conn.commit()
        conn.close()
        ccrm_app.DB_PATH = str(db_file)
        ccrm_app.migrate_db()
        ccrm_app.migrate_db()  # idempotent
        conn = sqlite3.connect(db_file)
        cols = {r[1] for r in conn.execute('PRAGMA table_info(interactions)')}
        assert 'contact_id' not in cols
        assert conn.execute('SELECT interaction_id, contact_id FROM interaction_contacts').fetchall() == [(1, 1)]
        assert conn.execute('SELECT summary FROM interactions').fetchone()[0] == 'Legacy call'
        conn.close()
        ccrm_app.app.config['TESTING'] = True
        with ccrm_app.app.test_client() as c:
            items = c.get('/api/contacts/1/interactions').get_json()
            assert items[0]['summary'] == 'Legacy call'
            assert items[0]['contacts'][0]['last_name'] == 'Timer'
    finally:
        ccrm_app.DB_PATH = orig
