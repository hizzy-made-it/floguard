import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()
API = BASE_URL.rstrip("/") + "/api"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def test_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    assert r.json() == {"message": "FloGuard API"}


def test_create_lead_and_list(client):
    payload = {
        "name": "TEST_John Doe",
        "email": "test_john@example.com",
        "phone": "407-555-0100",
        "address": "123 Test St",
        "location": "Orlando",
        "propertyType": "Single-family home",
        "issues": ["Yard flooding", "Sump pump failure"],
        "message": "TEST message",
    }
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "id" in data and data["id"]
    assert "created_at" in data and data["created_at"]
    assert data["name"] == "TEST_John Doe"
    assert data["property_type"] == "Single-family home"
    assert data["issues"] == ["Yard flooding", "Sump pump failure"]

    lead_id = data["id"]

    # Verify in listing (most-recent first)
    r2 = client.get(f"{API}/leads")
    assert r2.status_code == 200
    leads = r2.json()
    assert isinstance(leads, list) and len(leads) > 0
    ids = [l["id"] for l in leads]
    assert lead_id in ids
    # Ensure ordering — created lead should appear early
    assert ids.index(lead_id) < 5


def test_create_lead_missing_name(client):
    payload = {
        "name": "",
        "email": "test2@example.com",
        "phone": "407-555-0101",
        "propertyType": "Condo",
        "issues": ["Interior flooding"],
    }
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 422


def test_create_lead_missing_phone(client):
    payload = {
        "name": "TEST_NoPhone",
        "email": "test3@example.com",
        "phone": "",
        "propertyType": "Condo",
        "issues": ["Interior flooding"],
    }
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 422


def test_create_lead_invalid_email(client):
    payload = {
        "name": "TEST_BadEmail",
        "email": "not-an-email",
        "phone": "407-555-0102",
        "propertyType": "Condo",
        "issues": ["Interior flooding"],
    }
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 422
