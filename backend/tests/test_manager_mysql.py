"""T005 店长补训并发回归。使用已迁移、已播种的临时 MySQL 8.4 测试库。"""

from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.config import Settings
from app.main import create_app
from app.models import AuditAction, AuditEvent, IdempotencyRecord, Release, Retrain
from app.services import manager as manager_service
from tests.conftest import login
from tests.helpers import publish_seed_course

MISSING_BOX_PITCH = (
    "这款是正版联名授权毛绒公仔，手感软糯还有隐藏款，59 元一个。"
    "您放心，可以摇盒挑手感，品质细腻，再摸摸拆好的样品，加 9.9 元配防尘挂袋哦。"
)


async def _prepare_missed_assignment(
    client: AsyncClient, staff_id: str, release_id: str
) -> str:
    await login(client, staff_id)
    assignments = (await client.get("/api/v1/staff/assignments")).json()["items"]
    assignment = next(item for item in assignments if item["release_id"] == release_id)
    asg_id = assignment["assignment_id"]
    for ch in ("ch1", "ch2", "ch3"):
        resp = await client.post(
            f"/api/v1/staff/assignments/{asg_id}/chapters/{ch}/complete", json={}
        )
        assert resp.status_code == 200, resp.text
    rps = await client.post(
        f"/api/v1/staff/assignments/{asg_id}/roleplay-sessions", json={}
    )
    assert rps.status_code in (200, 201), rps.text
    session_id = rps.json()["session"]["id"]
    rnd = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json={
            "client_round_id": str(uuid4()),
            "answer_text": MISSING_BOX_PITCH,
            "question_variant": "default",
        },
    )
    assert rnd.status_code == 201, rnd.text
    assert rnd.json()["attempt"]["passed"] is False
    return asg_id


async def test_issue_retrain_concurrency_on_mysql(monkeypatch):
    """验证 MySQL 8.4 REPEATABLE READ 下：
    1) 同时给两名独立员工指派首次补训不触发 1213 间隙锁死锁，双方均返回 201；
    2) 同一员工并发相同 Idempotency-Key 只写一条补训并正确重放；
    3) 同一员工并发不同 Idempotency-Key 严格保持单开约束（201 + 409 RETRAIN_EXISTS）。
    """
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
            assert (
                await session.scalar(text("SELECT @@transaction_isolation"))
                == "REPEATABLE-READ"
            )
            assert (
                await session.scalar(select(func.count()).select_from(Release)) == 0
            ), "请使用临时空库"
            assert (
                await session.scalar(select(func.count()).select_from(Retrain)) == 0
            ), "请使用临时空库"

        async with (
            AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as setup_client,
            AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as mgr_client_1,
            AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as mgr_client_2,
        ):
            release = await publish_seed_course(setup_client, store_ids=("store_bj",))
            release_id = release["id"]
            asg_a = await _prepare_missed_assignment(
                setup_client, "usr_linxiaomei", release_id
            )
            asg_b = await _prepare_missed_assignment(
                setup_client, "usr_chenajie", release_id
            )
            asg_c = await _prepare_missed_assignment(
                setup_client, "usr_wangxiaoxue", release_id
            )

            await login(mgr_client_1, "usr_liming")
            await login(mgr_client_2, "usr_zhangtao")

            # 1) 两名独立员工并发首次补训：强制两事务在读取 retrains 后同时推进到 INSERT
            both_read_retrains = asyncio.Barrier(2)
            original_load = manager_service._load_assignment_retrains

            async def sync_load_retrains(session, assignment_id):
                rows = await original_load(session, assignment_id)
                await asyncio.wait_for(both_read_retrains.wait(), timeout=5)
                return rows

            with monkeypatch.context() as patch:
                patch.setattr(
                    manager_service, "_load_assignment_retrains", sync_load_retrains
                )
                res_a, res_b = await asyncio.gather(
                    mgr_client_1.post(
                        f"/api/v1/manager/assignments/{asg_a}/retrains",
                        headers={"Idempotency-Key": "mysql-first-a"},
                        json={"focus_fact_key": "fact_box_rule", "note": "A 并发首次补训"},
                    ),
                    mgr_client_2.post(
                        f"/api/v1/manager/assignments/{asg_b}/retrains",
                        headers={"Idempotency-Key": "mysql-first-b"},
                        json={"focus_fact_key": "fact_box_rule", "note": "B 并发首次补训"},
                    ),
                )
            assert [res_a.status_code, res_b.status_code] == [201, 201], (
                res_a.text,
                res_b.text,
            )

            # 2) 同一员工并发相同 Idempotency-Key：均返回 201，一条重放，库内仅 1 条补训
            async with AsyncClient(
                transport=ASGITransport(app=app, raise_app_exceptions=False),
                base_url="http://testserver",
            ) as mgr_client_1_dup:
                await login(mgr_client_1_dup, "usr_liming")
                same_a, same_b = await asyncio.gather(
                    mgr_client_1.post(
                        f"/api/v1/manager/assignments/{asg_c}/retrains",
                        headers={"Idempotency-Key": "mysql-same-key-c"},
                        json={"focus_fact_key": "fact_box_rule", "note": "C 同键并发"},
                    ),
                    mgr_client_1_dup.post(
                        f"/api/v1/manager/assignments/{asg_c}/retrains",
                        headers={"Idempotency-Key": "mysql-same-key-c"},
                        json={"focus_fact_key": "fact_box_rule", "note": "C 同键并发"},
                    ),
                )
            assert [same_a.status_code, same_b.status_code] == [201, 201], (
                same_a.text,
                same_b.text,
            )
            assert same_a.json() == same_b.json()
            replays = [
                same_a.headers.get("Idempotent-Replay") == "true",
                same_b.headers.get("Idempotent-Replay") == "true",
            ]
            assert replays.count(True) == 1

            # 3) 同一员工再用不同键发起补训 -> 409 RETRAIN_EXISTS
            dup_c = await mgr_client_2.post(
                f"/api/v1/manager/assignments/{asg_c}/retrains",
                headers={"Idempotency-Key": "mysql-diff-key-c"},
                json={"focus_fact_key": "fact_box_rule", "note": "C 异键重复"},
            )
            assert dup_c.status_code == 409, dup_c.text
            assert dup_c.json()["error"]["code"] == "RETRAIN_EXISTS"

        async with app.state.db.sessionmaker() as session:
            assert await session.scalar(select(func.count()).select_from(Retrain)) == 3
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(AuditEvent)
                    .where(AuditEvent.action == AuditAction.retrain_issued)
                )
                == 3
            )
            assert (
                await session.scalar(
                    select(func.count()).select_from(IdempotencyRecord)
                )
                >= 4
            )
    finally:
        await app.state.db.dispose()
