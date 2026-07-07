import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()
API = BASE_URL.rstrip("/") + "/api"

ADMIN_EMAIL = "admin@floguardfl.com"
ADMIN_PASSWORD = "FloGuard2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_token(client):
    r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_client(admin_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {admin_token}"})
    return s


# ---- Root / basic ----
def test_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    assert r.json() == {"message": "FloGuard API"}


# ---- Auth ----
def test_login_success(client):
    r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10
    assert data["user"]["email"] == ADMIN_EMAIL
    assert data["user"]["role"] == "admin"


def test_login_wrong_password(client):
    r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpass_TESTONLY"})
    assert r.status_code in (401, 429)


def test_auth_me(auth_client):
    r = auth_client.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == ADMIN_EMAIL


# ---- Protected: leads ----
def test_leads_requires_auth(client):
    r = client.get(f"{API}/leads")
    assert r.status_code == 401


def test_leads_list_with_auth(auth_client):
    r = auth_client.get(f"{API}/leads")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_lead_stats(auth_client):
    r = auth_client.get(f"{API}/leads/stats")
    assert r.status_code == 200
    data = r.json()
    for k in ("total", "recent_7d", "by_source"):
        assert k in data


# ---- Public lead create + admin verification + PATCH ----
def test_create_lead_and_admin_flow(client, auth_client):
    payload = {
        "name": "TEST_John Doe",
        "email": "test_john@example.com",
        "phone": "407-555-0100",
        "location": "Orlando",
        "propertyType": "Single-family home",
        "issues": ["Yard flooding"],
        "message": "TEST message",
        "source": "contact",
    }
    r = client.post(f"{API}/leads", json=payload)
    assert r.status_code == 200, r.text
    lead_id = r.json()["id"]

    # Verify appears in admin list
    r2 = auth_client.get(f"{API}/leads")
    assert r2.status_code == 200
    leads = r2.json()
    ids = [l["id"] for l in leads]
    assert lead_id in ids

    # PATCH status
    r3 = auth_client.patch(f"{API}/leads/{lead_id}", json={"status": "contacted"})
    assert r3.status_code == 200

    # Verify persisted
    r4 = auth_client.get(f"{API}/leads")
    updated = next(l for l in r4.json() if l["id"] == lead_id)
    assert updated["status"] == "contacted"


def test_patch_lead_requires_auth(client):
    r = client.patch(f"{API}/leads/some-id", json={"status": "contacted"})
    assert r.status_code == 401


# ---- Guide (lead magnet) ----
def test_guide_creates_lead(client, auth_client):
    email = "test_guide_lead@example.com"
    r = client.post(f"{API}/guide", json={"name": "TEST_Guide User", "email": email})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "success"
    assert data["download_url"] == "/api/guide/download"

    # Verify lead persisted with source=guide
    r2 = auth_client.get(f"{API}/leads")
    guide_leads = [l for l in r2.json() if l["email"] == email and l["source"] == "guide"]
    assert len(guide_leads) >= 1


def test_guide_download_pdf(client):
    r = client.get(f"{API}/guide/download")
    assert r.status_code == 200
    assert r.headers.get("content-type", "").startswith("application/pdf")
    assert len(r.content) > 500
    assert r.content[:4] == b"%PDF"
