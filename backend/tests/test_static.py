from fastapi.testclient import TestClient


def test_root_serves_static_index(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "Hello from FastAPI" in response.text
    assert response.headers["content-type"].startswith("text/html")


def test_unknown_static_path_returns_404(client: TestClient) -> None:
    response = client.get("/does-not-exist.js")
    assert response.status_code == 404
