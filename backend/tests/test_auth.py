from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import select
from starlette.requests import Request
from starlette.responses import Response

from app.config import Settings
from app.main import create_app
from app.models import User, UserSession
from app.models.base import utcnow
from app.security import hash_token, set_session_cookie
from tests.conftest import login


async def test_dev_login_and_me(client):
    response = await login(client, "usr_linxiaomei")
    payload = response.json()

    assert payload["user"]["id"] == "usr_linxiaomei"
    assert payload["user"]["role"] == "staff"
    assert payload["user"]["stores"] == [
        {"id": "store_bj", "name": "北京路旗舰店", "role": "staff"}
    ]
    assert payload["session"]["expires_at"].endswith("Z")
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]

    me = await client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json()["capabilities"] == [
        "staff.assignment.read",
        "staff.progress.write",
        "staff.roleplay.submit",
    ]
    assert me.json()["server_time"].endswith("Z")


async def test_anonymous_me_is_rejected(client):
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_identity_override_in_body_is_rejected(client):
    # 身份必须完全来自服务端会话，客户端夹带角色或门店字段应直接失败。
    response = await client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": "usr_linxiaomei", "role": "hq_ops"},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["fields"][0]["loc"] == ["body", "role"]


async def test_unknown_user_is_not_revealed(client):
    response = await client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": "usr_missing"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_logout_revokes_the_session(client):
    await login(client, "usr_linxiaomei")
    token = client.cookies.get("sk_session")
    assert token

    logout = await client.post(
        "/api/v1/auth/logout",
        headers={"Content-Type": "application/json"},
    )
    assert logout.status_code == 204
    assert client.cookies.get("sk_session") is None

    # Cookie 被清除后，匿名请求表现为未登录。
    assert (await client.get("/api/v1/me")).status_code == 401

    # 如果旧 Cookie 被重放，服务端应识别为已撤销会话，而不是继续放行。
    client.cookies.set("sk_session", token)
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_logout_requires_json_content_type(client):
    await login(client, "usr_linxiaomei")

    response = await client.post(
        "/api/v1/auth/logout",
        content=b"",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["fields"][0]["loc"] == ["header", "content-type"]

    # 被拒绝的登出不能撤销会话。
    assert (await client.get("/api/v1/me")).status_code == 200


async def test_https_dev_login_sets_secure_cookie(app):
    # 开发环境默认 COOKIE_SECURE=false，但浏览器侧是 HTTPS 时仍必须加 Secure。
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="https://testserver",
    ) as https_client:
        response = await https_client.post(
            "/api/v1/auth/dev-login",
            json={"user_id": "usr_linxiaomei"},
            # 直接 TLS 时不能被伪造的转发头降级。
            headers={"X-Forwarded-Proto": "http"},
        )
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]

        logout = await https_client.post(
            "/api/v1/auth/logout",
            headers={"Content-Type": "application/json"},
        )
        assert logout.status_code == 204
        assert "Secure" in logout.headers["set-cookie"]


def test_production_cookie_forces_secure():
    # 生产配置即使请求在应用侧表现为 HTTP，也必须下发 Secure。
    settings = Settings(
        _env_file=None,
        app_env="production",
        dev_auth_enabled=False,
        app_origins="https://app.example.com",
        database_url="sqlite+aiosqlite://",
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/auth/dev-login",
            "scheme": "http",
            "headers": [],
            "query_string": b"",
            "server": ("testserver", 80),
            "client": ("testclient", 123),
        }
    )
    response = Response()
    set_session_cookie(response, settings, request, "token")
    assert "Secure" in response.headers["set-cookie"]


async def test_expired_session_is_rejected(app, client):
    token = "expired-but-known-token"
    async with app.state.db.sessionmaker() as session:
        session.add(
            UserSession(
                user_id="usr_linxiaomei",
                token_hash=hash_token(token),
                expires_at=utcnow() - timedelta(seconds=1),
            )
        )
        await session.commit()

    client.cookies.set("sk_session", token)
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_invalid_token_is_rejected(client):
    client.cookies.set("sk_session", "random-value-without-session-row")
    response = await client.get("/api/v1/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_inactive_user_cannot_login(app, client):
    async with app.state.db.sessionmaker() as session:
        user = await session.scalar(select(User).where(User.id == "usr_linxiaomei"))
        user.active = False
        await session.commit()

    response = await client.post(
        "/api/v1/auth/dev-login",
        json={"user_id": "usr_linxiaomei"},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_origin_is_checked_for_unsafe_methods(client):
    # 开发调试客户端通常不带 Origin；带 Origin 时必须与 APP_ORIGINS 匹配。
    response = await client.post(
        "/api/v1/auth/dev-login",
        headers={"Origin": "http://evil.example"},
        json={"user_id": "usr_linxiaomei"},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "CSRF_ORIGIN_REJECTED"

    allowed = await client.post(
        "/api/v1/auth/dev-login",
        headers={"Origin": "http://testserver"},
        json={"user_id": "usr_linxiaomei"},
    )
    assert allowed.status_code == 200


async def test_production_does_not_register_dev_login():
    settings = Settings(
        _env_file=None,
        app_env="production",
        dev_auth_enabled=False,
        app_origins="https://app.example.com",
        database_url="sqlite+aiosqlite://",
    )
    app = create_app(settings)
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.post(
                "/api/v1/auth/dev-login",
                json={"user_id": "usr_linxiaomei"},
            )
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "NOT_FOUND"
    finally:
        await app.state.db.dispose()


def test_production_rejects_enabled_dev_auth():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_env="production",
            dev_auth_enabled=True,
            database_url="sqlite+aiosqlite://",
        )