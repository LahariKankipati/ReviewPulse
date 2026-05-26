"""Phase 0 smoke test: the app boots and /health responds. If this breaks, deploy is broken."""
from fastapi.testclient import TestClient

from app.main import app


def test_health_ok():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "reviewpulse"
