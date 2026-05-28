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
