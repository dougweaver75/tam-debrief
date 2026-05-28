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
    assert data['open_deals_count'] == 0

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

def test_create_and_update_deal(client):
    cid = _make_contact(client)
    r = client.post('/api/deals', json={'contact_id': cid, 'title': 'Pilot', 'value': 5000, 'stage': 'lead'})
    assert r.status_code == 201
    did = r.get_json()['id']
    r2 = client.put(f'/api/deals/{did}', json={'title': 'Pilot', 'value': 7500, 'stage': 'qualified'})
    assert r2.get_json()['stage'] == 'qualified'

def test_delete_cascades(client):
    cid = _make_contact(client)
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'call', 'summary': 'X', 'interaction_date': '2026-05-28'})
    client.post('/api/deals', json={'contact_id': cid, 'title': 'Deal', 'value': 0, 'stage': 'lead'})
    r_del = client.delete(f'/api/contacts/{cid}')
    assert r_del.status_code == 200
    assert r_del.get_json()['ok'] is True
    r = client.get(f'/api/contacts/{cid}')
    assert r.status_code == 404
    # verify cascade: interactions and deals removed
    assert client.get(f'/api/contacts/{cid}/interactions').get_json() == []
    assert client.get(f'/api/contacts/{cid}/deals').get_json() == []

def test_dashboard_stats(client):
    cid = _make_contact(client)
    client.post('/api/deals', json={'contact_id': cid, 'title': 'A', 'value': 1000, 'stage': 'lead'})
    client.post('/api/deals', json={'contact_id': cid, 'title': 'B', 'value': 2000, 'stage': 'closed-won'})
    client.post('/api/interactions', json={'contact_id': cid, 'type': 'call', 'summary': 'Hi', 'interaction_date': '2026-05-28'})
    r = client.get('/api/dashboard')
    d = r.get_json()
    assert d['total_contacts'] == 1
    assert d['open_deals_count'] == 1   # only lead is open
    assert d['open_deals_value'] == 1000
    assert len(d['recent_interactions']) == 1
