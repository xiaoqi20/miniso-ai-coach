"""T003 发布并发回归。使用已迁移、已播种的临时 MySQL 测试库。"""

import asyncio
import os
from contextvars import ContextVar

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Select, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.main import create_app
from app.models import (
    Assignment,
    AuditAction,
    AuditEvent,
    CourseVersion,
    CourseVersionStatus,
    IdempotencyRecord,
    Release,
)
from app.seed_data import COURSE_ID, COURSE_VERSION_ID
from app.services import courses
from tests.helpers import course_payload, login, publish_version, review_version


async def _publish_two_courses(client, app, monkeypatch):
    version_ids = []
    for sku in ("MYSQL-PUBLISH-A", "MYSQL-PUBLISH-B"):
        draft = await client.post("/api/v1/hq/courses", json=course_payload(sku=sku))
        assert draft.status_code == 201, draft.text
        version_id = draft.json()["version"]["id"]
        assert (await review_version(client, version_id)).status_code == 200
        version_ids.append(version_id)

    both_in_publish = asyncio.Barrier(2)
    original_roster = courses._roster_by_store

    async def synchronize_publishes(session, store_ids):
        await asyncio.wait_for(both_in_publish.wait(), timeout=5)
        return await original_roster(session, store_ids)

    with monkeypatch.context() as patch:
        patch.setattr(courses, "_roster_by_store", synchronize_publishes)
        results = await asyncio.gather(
            publish_version(client, version_ids[0], key="first-a"),
            publish_version(client, version_ids[1], key="first-b"),
        )
    assert [result.status_code for result in results] == [201, 201], [r.text for r in results]
    async with app.state.db.sessionmaker() as session:
        for version_id, result in zip(version_ids, results, strict=True):
            release_id = result.json()["release"]["id"]
            releases = await session.scalars(
                select(Release.id).where(Release.course_version_id == version_id)
            )
            assert list(releases) == [release_id]
            assert await session.scalar(
                select(func.count()).select_from(Assignment).where(Assignment.release_id == release_id)
            ) == 3
            assert await session.scalar(
                select(func.count()).select_from(AuditEvent).where(
                    AuditEvent.entity_id == release_id, AuditEvent.action == AuditAction.release_published
                )
            ) == 1
        assert await session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 2


async def _replay_during_version_change(client, app, monkeypatch):
    assert (await review_version(client)).status_code == 200
    cloned = await client.post(
        f"/api/v1/hq/courses/{COURSE_ID}/versions", json={"source_version_id": COURSE_VERSION_ID}
    )
    assert cloned.status_code == 201, cloned.text
    replacement = cloned.json()["version"]["id"]
    assert (await review_version(client, replacement)).status_code == 200

    first_in_publish, retry_located_course = asyncio.Event(), asyncio.Event()
    finish_first, let_retry_continue = asyncio.Event(), asyncio.Event()
    is_retry = ContextVar("publish_retry", default=False)
    original_roster, original_scalar = courses._roster_by_store, AsyncSession.scalar

    async def pause_first_publish(session, store_ids):
        if not first_in_publish.is_set():
            first_in_publish.set()
            await asyncio.wait_for(finish_first.wait(), timeout=5)
        return await original_roster(session, store_ids)

    async def pause_retry_after_locating_course(session, statement, *args, **kwargs):
        result = await original_scalar(session, statement, *args, **kwargs)
        if (
            is_retry.get()
            and isinstance(statement, Select)
            and list(statement.selected_columns.keys()) == ["course_id"]
        ):
            retry_located_course.set()
            await asyncio.wait_for(let_retry_continue.wait(), timeout=5)
        return result

    async def retry_original_publish():
        token = is_retry.set(True)
        try:
            return await publish_version(client, key="replace-race")
        finally:
            is_retry.reset(token)

    with monkeypatch.context() as patch:
        patch.setattr(courses, "_roster_by_store", pause_first_publish)
        patch.setattr(AsyncSession, "scalar", pause_retry_after_locating_course)
        first = asyncio.create_task(publish_version(client, key="replace-race"))
        requests = [first]
        try:
            await asyncio.wait_for(first_in_publish.wait(), timeout=5)
            retry = asyncio.create_task(retry_original_publish())
            requests.append(retry)
            await asyncio.wait_for(retry_located_course.wait(), timeout=5)
            finish_first.set()
            original = await first
            assert original.status_code == 201, original.text
            switched = await publish_version(client, replacement, key="replacement")
            assert switched.status_code == 201, switched.text
            let_retry_continue.set()
            replay = await retry
        finally:
            finish_first.set()
            let_retry_continue.set()
            await asyncio.gather(*requests, return_exceptions=True)

    assert replay.status_code == 201, replay.text
    assert replay.headers["Idempotent-Replay"] == "true"
    assert replay.json() == original.json()
    reused = await publish_version(client, key="replace-race", store_ids=("store_fs",))
    assert reused.status_code == 409, reused.text
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    async with app.state.db.sessionmaker() as session:
        superseded = await session.get(CourseVersion, COURSE_VERSION_ID)
        assert superseded.status is CourseVersionStatus.superseded
        assert await session.scalar(select(func.count()).select_from(Release)) == 4
        assert await session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 4


async def test_publish_concurrency_on_mysql(monkeypatch):
    url = os.getenv("SHOUKE_TEST_MYSQL_URL")
    if not url:
        pytest.skip("需要已迁移、已播种的临时 MySQL 8.4 测试库")
    assert url.startswith("mysql+aiomysql://"), "需要使用 mysql+aiomysql 连接测试库"
    app = create_app(
        Settings(
            _env_file=None,
            database_url=url,
            app_env="development",
            dev_auth_enabled=True,
            app_origins="http://testserver",
            cookie_secure=False,
        )
    )
    try:
        async with app.state.db.sessionmaker() as session:
            assert (await session.scalar(text("SELECT VERSION()"))).startswith("8.4.")
            assert await session.scalar(text("SELECT @@transaction_isolation")) == "REPEATABLE-READ"
            assert await session.scalar(select(func.count()).select_from(Release)) == 0, "请使用临时空库"
            assert await session.scalar(select(func.count()).select_from(IdempotencyRecord)) == 0, "请使用临时空库"
        async with AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://testserver"
        ) as client:
            await login(client, "usr_linmin")
            await _publish_two_courses(client, app, monkeypatch)
            await _replay_during_version_change(client, app, monkeypatch)
    finally:
        await app.state.db.dispose()
