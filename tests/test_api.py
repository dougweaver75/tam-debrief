import os
import sys
import tempfile
import pytest

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
        'contact_id': cid, 'type': 'call',
        'summary': 'Quick check-in', 'interaction_date': '2026-05-28'
    })
    assert r.status_code == 201
    data = r.get_json()
    assert data['type'] == 'call'
    assert data['contact_id'] == cid

def test_list_interactions(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'email', 'summary': 'Follow up', 'interaction_date': '2026-05-27'})
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'meeting', 'summary': 'Demo call', 'interaction_date': '2026-05-28'})
    r = client.get(f'/api/contacts/{cid}/interactions')
    data = r.get_json()
    assert len(data) == 2
    assert data[0]['interaction_date'] == '2026-05-28'  # sorted newest first

def test_delete_interaction(client):
    cid = _make_contact(client)
    r = client.post('/api/interactions', json={'contact_id': cid, 'type': 'note', 'summary': 'Note', 'interaction_date': '2026-05-28'})
    iid = r.get_json()['id']
    client.delete(f'/api/interactions/{iid}')
    r2 = client.get(f'/api/contacts/{cid}/interactions')
    assert r2.get_json() == []


def test_delete_cascades(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'call', 'summary': 'X', 'interaction_date': '2026-05-28'})
    r_del = client.delete(f'/api/contacts/{cid}')
    assert r_del.status_code == 200
    assert r_del.get_json()['ok'] is True
    r = client.get(f'/api/contacts/{cid}')
    assert r.status_code == 404
    assert client.get(f'/api/contacts/{cid}/interactions').get_json() == []

def test_dashboard_stats(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'})
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
