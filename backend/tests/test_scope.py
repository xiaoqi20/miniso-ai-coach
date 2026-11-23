from typing import Annotated

import pytest
from fastapi import APIRouter, Depends
from httpx import ASGITransport, AsyncClient

from app.api.deps import CurrentUser, require_roles, require_store_access
from tests.conftest import login

scope_router = APIRouter()


@scope_router.get("/_test/hq-only")
async def hq_only(
    current_user: Annotated[CurrentUser, Depends(require_roles("hq_ops"))],
):
    return {"ok": True, "role": current_user.user.role.value}


@scope_router.get("/_test/stores/{store_id}")
async def store_probe(
    store_id: str,
    current_user: Annotated[CurrentUser, Depends(require_store_access)],
):
    return {"ok": True, "store_id": store_id}


@pytest.fixture
async def scoped_client(app):
    # 测试路由只在测试应用里注册，不进入生产 API。
    app.include_router(scope_router)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        yield client


async def test_staff_scope_is_limited_to_own_store(scoped_client):
    await login(scoped_client, "usr_linxiaomei")

    assert (await scoped_client.get("/_test/hq-only")).status_code == 403
    assert (await scoped_client.get("/_test/stores/store_bj")).status_code == 200

    # 跨店与不存在的门店都返回 404，避免泄漏门店是否存在。
    forbidden = await scoped_client.get("/_test/stores/store_fs")
    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "NOT_FOUND"
    assert (await scoped_client.get("/_test/stores/store_missing")).status_code == 404


async def test_manager_scope_is_limited_to_managed_store(scoped_client):
    await login(scoped_client, "usr_liming")

    assert (await scoped_client.get("/_test/hq-only")).status_code == 403
    assert (await scoped_client.get("/_test/stores/store_bj")).status_code == 200
    assert (await scoped_client.get("/_test/stores/store_fs")).status_code == 404


async def test_hq_can_read_any_existing_store(scoped_client):
    await login(scoped_client, "usr_linmin")

    assert (await scoped_client.get("/_test/hq-only")).status_code == 200
    assert (await scoped_client.get("/_test/stores/store_bj")).status_code == 200
    assert (await scoped_client.get("/_test/stores/store_fs")).status_code == 200
    assert (await scoped_client.get("/_test/stores/store_missing")).status_code == 404


async def test_scope_dependency_rejects_anonymous(scoped_client):
    assert (await scoped_client.get("/_test/hq-only")).status_code == 401
    assert (await scoped_client.get("/_test/stores/store_bj")).status_code == 401