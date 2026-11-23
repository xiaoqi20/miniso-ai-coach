import asyncio
from typing import Annotated

import pytest
from fastapi import APIRouter, Depends, Response
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import (
    CurrentUser,
    CurrentUserDep,
    DbDep,
    require_roles,
    require_store_access,
)
from app.models import AuditAction, AuditEvent, MembershipRole, Store, StoreMembership
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


@scope_router.get("/_test/manager/stores/{store_id}")
async def manager_store_probe(
    manager: Annotated[CurrentUser, Depends(require_roles("store_manager"))],
    scoped: Annotated[CurrentUser, Depends(require_store_access)],
):
    # 同时使用角色依赖和门店范围依赖，复现真实店长路由的鉴权组合。
    return {
        "ok": True,
        "manager": manager.user.id,
        "stores": [membership.store_id for membership in scoped.memberships],
    }


@scope_router.get("/_test/stores/{store_id}/transaction")
async def store_transaction_probe(
    session: DbDep,
    current_user: Annotated[CurrentUser, Depends(require_store_access)],
):
    return {"in_transaction": session.in_transaction()}


@scope_router.get("/_test/auth-transaction")
async def auth_transaction_probe(current_user: CurrentUserDep, session: DbDep):
    """模拟 T004：鉴权后写一条短事务，再在事务外等待外部模型。"""
    actor_id = current_user.user.id
    at_entry = session.in_transaction()
    if at_entry:
        # 仅用于让回归测试拿到明确结果，不影响正常路径。
        await session.rollback()

    # 模拟 T004 在写成绩前等待外部模型；此时不应持有数据库事务。
    await asyncio.sleep(0.05)
    during_wait = session.in_transaction()

    async with session.begin():
        session.add(
            AuditEvent(
                actor_user_id=actor_id,
                action=AuditAction.course_reviewed,
                entity_type="course_version",
                entity_id="crv_transaction_probe",
                payload={"source": "transaction_probe"},
                request_id="req_transaction_probe",
            )
        )
    after_write = session.in_transaction()
    return {
        "at_entry": at_entry,
        "after_write": after_write,
        "during_wait": during_wait,
    }


@scope_router.api_route(
    "/_test/write",
    methods=["POST", "PUT", "PATCH", "DELETE"],
    status_code=204,
)
async def write_probe():
    return Response(status_code=204)


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


async def test_disabled_store_is_removed_from_existing_session(app, scoped_client):
    await login(scoped_client, "usr_liming")

    async with app.state.db.sessionmaker() as session:
        store = await session.get(Store, "store_bj")
        assert store is not None
        store.active = False
        await session.commit()

    # 已有会话仍在，但停用门店不再出现在 /me，也不能再通过店长路由。
    me = await scoped_client.get("/api/v1/me")
    assert me.status_code == 200
    assert me.json()["user"]["stores"] == []

    forbidden = await scoped_client.get("/_test/manager/stores/store_bj")
    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "NOT_FOUND"


async def test_membership_role_must_match_account_role(app, scoped_client):
    # 店长额外挂一条佛山店的有效 staff 成员关系，不能因此获得佛山店店长权限。
    async with app.state.db.sessionmaker() as session:
        session.add(
            StoreMembership(
                user_id="usr_liming",
                store_id="store_fs",
                role=MembershipRole.staff,
                active=True,
            )
        )
        await session.commit()

    await login(scoped_client, "usr_liming")

    me = await scoped_client.get("/api/v1/me")
    assert [store["id"] for store in me.json()["user"]["stores"]] == ["store_bj"]
    assert (await scoped_client.get("/_test/manager/stores/store_bj")).status_code == 200

    forbidden = await scoped_client.get("/_test/manager/stores/store_fs")
    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "NOT_FOUND"


async def test_store_scope_dependency_leaves_no_transaction(scoped_client):
    # 店长分支不查询门店；总部依赖会查询门店，两者都必须在路由入口前结束事务。
    await login(scoped_client, "usr_liming")
    manager = await scoped_client.get("/_test/stores/store_bj/transaction")
    assert manager.status_code == 200
    assert manager.json()["in_transaction"] is False

    await login(scoped_client, "usr_linmin")
    hq = await scoped_client.get("/_test/stores/store_bj/transaction")
    assert hq.status_code == 200
    assert hq.json()["in_transaction"] is False


async def test_auth_dependency_leaves_clean_transaction_for_model_wait(app, scoped_client):
    await login(scoped_client, "usr_linmin")

    response = await scoped_client.get("/_test/auth-transaction")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "at_entry": False,
        "after_write": False,
        "during_wait": False,
    }

    async with app.state.db.sessionmaker() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.request_id == "req_transaction_probe")
        )
    assert count == 1


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
async def test_all_unsafe_methods_require_json_content_type(scoped_client, method):
    rejected = await scoped_client.request(
        method,
        "/_test/write",
        content=b"",
        headers={"Content-Type": "text/plain"},
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "VALIDATION_ERROR"

    # 无正文写操作同样必须显式声明 JSON。
    missing = await scoped_client.request(method, "/_test/write")
    assert missing.status_code == 422

    accepted = await scoped_client.request(
        method,
        "/_test/write",
        headers={"Content-Type": "application/json"},
    )
    assert accepted.status_code == 204