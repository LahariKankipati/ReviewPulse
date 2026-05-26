"""Health endpoint smoke test."""
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    """Ensure API starts and exposes expected health payload keys."""
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "reviewpulse"
