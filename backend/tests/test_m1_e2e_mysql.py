"""T008 M1 三角色跨模块 MySQL 8.4 端到端闭环验收套件。

覆盖总部审校发布、草稿与跨店隔离、员工学练与后端重启恢复、
重复提交幂等、并发轮次、「端盒 6 个不重复」补训三态与过期复查、
48 小时统计防偏移及最终数据库落库核对。
"""

from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text, update

from app.config import Settings
from app.main import create_app
from app.models import (
    Assignment,
    AuditAction,
    AuditEvent,
    Course,
    CourseVersion,
    IdempotencyRecord,
    Release,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    Store,
    StoreMembership,
    User,
)
from app.seed_data import COURSE_VERSION_ID
from tests.conftest import login
from tests.helpers import course_payload, publish_version, review_version

CORRECT_PITCH = (
    "您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，"
    "定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，"
    "或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！"
)
SYNONYM_PITCH = (
    "这款是日本正版授权的联名毛绒公仔，手感软糯，五十九块钱一个；"
    "端盒六个不重样，您要不要摸一下拆开的样品？加 9.9 元还能配防尘挂袋。"
)
MISSING_BOX_PITCH = (
    "这款是正版联名授权毛绒公仔，手感软糯还有隐藏款，59 元一个。"
    "您放心，可以摇盒挑手感，品质细腻，再摸摸拆好的样品，加 9.9 元配防尘挂袋哦。"
)
FACTUAL_ERROR_PITCH = (
    "这款是正版联名毛绒公仔，59 元，端盒 6 个可能会重复，"
    "您摸摸样品，加 9.9 元配防尘挂袋，买一送一哦。"
)


def _mysql_settings(url: str) -> Settings:
    """构造连接临时 MySQL 8.4 测试库的应用配置。"""
    return Settings(
        _env_file=None,
        database_url=url,
        app_env="development",
        dev_auth_enabled=True,
        app_origins="http://testserver",
        cookie_secure=False,
    )


def _new_client(app) -> AsyncClient:
    """创建独立 HTTP 客户端，模拟各角色隔离的浏览器 Cookie 上下文。"""
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    )


async def test_m1_three_role_e2e_on_mysql():
    """在真实 MySQL 8.4 REPEATABLE-READ 环境下验证完整三角色闭环。"""
    url = os.getenv("SHOUKE_TEST_MYSQL_URL")
    if not url:
        pytest.skip("需要已迁移、已播种的临时 MySQL 8.4 测试库")
    assert url.startswith("mysql+aiomysql://"), "需要使用 mysql+aiomysql 连接测试库"

    settings = _mysql_settings(url)
    app = create_app(settings)

    try:
        # 1) 环境与空库基准核验
        async with app.state.db.sessionmaker() as session:
            version = await session.scalar(text("SELECT VERSION()"))
            isolation = await session.scalar(text("SELECT @@transaction_isolation"))
            assert version is not None and version.startswith("8.4."), version
            assert isolation == "REPEATABLE-READ", isolation
            assert await session.scalar(select(func.count()).select_from(Store)) == 2
            assert await session.scalar(select(func.count()).select_from(User)) == 9
            assert await session.scalar(select(func.count()).select_from(Course)) == 1
            seed_ver = await session.get(CourseVersion, COURSE_VERSION_ID)
            assert seed_ver is not None and seed_ver.status.value == "draft"
            assert await session.scalar(select(func.count()).select_from(Release)) == 0
            assert await session.scalar(select(func.count()).select_from(Assignment)) == 0
            assert await session.scalar(select(func.count()).select_from(Retrain)) == 0
            assert await session.scalar(select(func.count()).select_from(RoleplayAttempt)) == 0

        async with (
            _new_client(app) as hq_client,
            _new_client(app) as mgr_bj_client,
            _new_client(app) as mgr_bj2_client,
            _new_client(app) as staff_bj1_client,
            _new_client(app) as staff_bj2_client,
            _new_client(app) as staff_fs_client,
        ):
            await login(hq_client, "usr_linmin")
            await login(mgr_bj_client, "usr_liming")
            await login(mgr_bj2_client, "usr_zhangtao")
            await login(staff_bj1_client, "usr_linxiaomei")
            await login(staff_bj2_client, "usr_chenajie")
            await login(staff_fs_client, "usr_zhoulin")

            # 2) 发布前草稿隔离与角色接口鉴权校验
            assert (await staff_bj1_client.get("/api/v1/staff/assignments")).json()["items"] == []
            assert (await staff_fs_client.get("/api/v1/staff/assignments")).json()["items"] == []
            assert (await staff_bj1_client.get("/api/v1/hq/courses")).status_code == 403
            assert (await staff_bj1_client.get("/api/v1/manager/releases")).status_code == 403
            assert (await mgr_bj_client.get("/api/v1/hq/courses")).status_code == 403

            # 3) 总部审校种子草稿并仅向北京路旗舰店发布
            rev = await review_version(hq_client, COURSE_VERSION_ID)
            assert rev.status_code == 200, rev.text
            pub = await publish_version(
                hq_client,
                COURSE_VERSION_ID,
                store_ids=("store_bj",),
                deadline_hours=48,
                key="e2e-pub-bj",
            )
            assert pub.status_code == 201, pub.text
            bj_release_id = pub.json()["release"]["id"]

            assignees_res = await hq_client.get(f"/api/v1/hq/releases/{bj_release_id}/assignees")
            assert assignees_res.status_code == 200
            assignee_users = {item["user"]["id"] for item in assignees_res.json()["items"]}
            assert assignee_users == {"usr_linxiaomei", "usr_chenajie", "usr_wangxiaoxue"}

            init_stats = (await hq_client.get(f"/api/v1/hq/releases/{bj_release_id}/stats")).json()
            assert init_stats["denominator"] == 3
            assert init_stats["numerator"] == 0
            assert init_stats["rate"] == 0.0
            assert init_stats["empty_roster"] is False

            # 4) 跨店、同店他人与未发布草稿隔离校验
            bj1_tasks = (await staff_bj1_client.get("/api/v1/staff/assignments")).json()["items"]
            assert len(bj1_tasks) == 1
            asg_linxiaomei = bj1_tasks[0]["assignment_id"]
            bj2_tasks = (await staff_bj2_client.get("/api/v1/staff/assignments")).json()["items"]
            asg_chenajie = bj2_tasks[0]["assignment_id"]

            assert (await staff_fs_client.get("/api/v1/staff/assignments")).json()["items"] == []
            assert (await staff_fs_client.get(f"/api/v1/staff/assignments/{asg_linxiaomei}")).status_code == 404
            assert (await staff_bj2_client.get(f"/api/v1/staff/assignments/{asg_linxiaomei}")).status_code == 404

            # 新建仅发给佛山店的课程 + 仅存草稿的课程
            fs_course = (
                await hq_client.post(
                    "/api/v1/hq/courses",
                    json=course_payload(sku="MINISO-E2E-FS-01", name="佛山限定试点品"),
                )
            ).json()
            fs_ver_id = fs_course["version"]["id"]
            assert (await review_version(hq_client, fs_ver_id)).status_code == 200
            fs_pub = await publish_version(
                hq_client,
                fs_ver_id,
                store_ids=("store_fs",),
                deadline_hours=48,
                key="e2e-pub-fs",
            )
            assert fs_pub.status_code == 201, fs_pub.text
            fs_release_id = fs_pub.json()["release"]["id"]

            draft_course = await hq_client.post(
                "/api/v1/hq/courses",
                json=course_payload(sku="MINISO-E2E-DRAFT-01", name="未发布草稿课程"),
            )
            assert draft_course.status_code == 201

            fs_tasks = (await staff_fs_client.get("/api/v1/staff/assignments")).json()["items"]
            assert [t["release_id"] for t in fs_tasks] == [fs_release_id]
            asg_zhoulin = fs_tasks[0]["assignment_id"]

            # 北京店长不可越权访问佛山批次和员工任务；北京员工列表也只有北京批次
            assert (await mgr_bj_client.get(f"/api/v1/manager/releases/{fs_release_id}")).status_code == 404
            assert (await mgr_bj_client.get(f"/api/v1/manager/releases/{fs_release_id}/assignees")).status_code == 404
            assert (await mgr_bj_client.get(f"/api/v1/manager/releases/{fs_release_id}/stats")).status_code == 404
            assert (await mgr_bj_client.get(f"/api/v1/manager/assignments/{asg_zhoulin}")).status_code == 404
            assert [
                item["release_id"]
                for item in (await staff_bj1_client.get("/api/v1/staff/assignments")).json()["items"]
            ] == [bj_release_id]

            # 5) 员工学习第 1 节后模拟后端进程重启，验证会话与进度恢复
            ch1 = await staff_bj1_client.post(
                f"/api/v1/staff/assignments/{asg_linxiaomei}/chapters/ch1/complete",
                json={},
            )
            assert ch1.status_code == 200
            assert ch1.json()["completed_chapter_count"] == 1
            staff_cookies = staff_bj1_client.cookies

            await app.state.db.dispose()
            app = create_app(settings)

            async with _new_client(app) as restarted_staff:
                restarted_staff.cookies.update(staff_cookies)
                me_res = await restarted_staff.get("/api/v1/me")
                assert me_res.status_code == 200
                assert me_res.json()["user"]["id"] == "usr_linxiaomei"
                detail_res = await restarted_staff.get(f"/api/v1/staff/assignments/{asg_linxiaomei}")
                assert detail_res.status_code == 200
                assert detail_res.json()["assignment"]["completed_chapters"] == ["ch1"]
                assert detail_res.json()["progress"]["completed_chapters"] == ["ch1"]
                for ch in ("ch2", "ch3"):
                    res = await restarted_staff.post(
                        f"/api/v1/staff/assignments/{asg_linxiaomei}/chapters/{ch}/complete",
                        json={},
                    )
                    assert res.status_code == 200

                # 6) 正式对练第 1 轮（漏讲端盒）+ 同 client_round_id 幂等重放 + 重启恢复
                rps_res = await restarted_staff.post(
                    f"/api/v1/staff/assignments/{asg_linxiaomei}/roleplay-sessions",
                    json={},
                )
                assert rps_res.status_code == 201
                session_id = rps_res.json()["session"]["id"]

                client_round_1 = str(uuid4())
                round1 = await restarted_staff.post(
                    f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
                    json={
                        "client_round_id": client_round_1,
                        "answer_text": MISSING_BOX_PITCH,
                        "question_variant": "default",
                    },
                )
                assert round1.status_code == 201, round1.text
                r1_body = round1.json()
                assert r1_body["round"]["round_no"] == 1
                assert r1_body["attempt"]["total"] == 99
                assert r1_body["attempt"]["passed"] is False
                assert [f["key"] for f in r1_body["attempt"]["missed_required_facts"]] == ["fact_box_rule"]
                attempt_1_id = r1_body["attempt"]["attempt_id"]

                # 同键重放：返回同一 attempt_id、replayed=True，库内仅 1 条成绩
                replay_r1 = await restarted_staff.post(
                    f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
                    json={
                        "client_round_id": client_round_1,
                        "answer_text": MISSING_BOX_PITCH,
                        "question_variant": "default",
                    },
                )
                assert replay_r1.status_code == 201
                assert replay_r1.json()["replayed"] is True
                assert replay_r1.json()["attempt"]["attempt_id"] == attempt_1_id

            async with app.state.db.sessionmaker() as session:
                assert (
                    await session.scalar(
                        select(func.count())
                        .select_from(RoleplayAttempt)
                        .where(RoleplayAttempt.assignment_id == asg_linxiaomei)
                    )
                    == 1
                )

            # 再次销毁并重建应用，验证对练轮次从 MySQL 恢复
            await app.state.db.dispose()
            app = create_app(settings)

            async with (
                _new_client(app) as restarted_staff,
                _new_client(app) as mgr1,
                _new_client(app) as mgr2,
                _new_client(app) as hq2,
                _new_client(app) as staff2,
            ):
                restarted_staff.cookies.update(staff_cookies)
                recovered = await restarted_staff.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
                assert recovered.status_code == 200
                assert len(recovered.json()["rounds"]) == 1
                assert recovered.json()["rounds"][0]["attempt"]["attempt_id"] == attempt_1_id

                await login(mgr1, "usr_liming")
                await login(mgr2, "usr_zhangtao")
                await login(hq2, "usr_linmin")
                await login(staff2, "usr_chenajie")

                # 7) 店长指派「端盒 6 个不重复」补训 -> 三态流转
                issued = await mgr1.post(
                    f"/api/v1/manager/assignments/{asg_linxiaomei}/retrains",
                    headers={"Idempotency-Key": "e2e-issue-1"},
                    json={"focus_fact_key": "fact_box_rule", "note": "漏讲端盒 6 个不重复"},
                )
                assert issued.status_code == 201, issued.text
                retrain_id = issued.json()["retrain"]["id"]
                assert issued.json()["retrain"]["status"] == "pending"
                assert issued.json()["retrain"]["version"] == 1

                # 态 1：复练仍漏讲 -> submitted_unfixed（待办保留），提前确认返回 409
                round2 = await restarted_staff.post(
                    f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
                    json={
                        "client_round_id": str(uuid4()),
                        "answer_text": MISSING_BOX_PITCH,
                        "question_variant": "default",
                    },
                )
                assert round2.status_code == 201, round2.text
                r2_body = round2.json()
                assert r2_body["round"]["round_no"] == 2
                assert r2_body["attempt"]["passed"] is False
                assert r2_body["open_retrain"]["status"] == "submitted_unfixed"
                assert r2_body["open_retrain"]["version"] == 2

                early = await mgr1.post(
                    f"/api/v1/manager/retrains/{retrain_id}/review",
                    headers={"Idempotency-Key": "e2e-early-confirm"},
                    json={
                        "decision": "confirm",
                        "expected_version": 2,
                        "evidence_attempt_id": r2_body["attempt"]["attempt_id"],
                        "note": "未改提前确认",
                    },
                )
                assert early.status_code == 409
                assert early.json()["error"]["code"] == "STATE_CONFLICT"

                # 态 2：复练用同义表达「端盒六个不重样」-> fixed_pending_review（91 分通关并冻结证据）
                round3 = await restarted_staff.post(
                    f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
                    json={
                        "client_round_id": str(uuid4()),
                        "answer_text": SYNONYM_PITCH,
                        "question_variant": "alt",
                    },
                )
                assert round3.status_code == 201, round3.text
                r3_body = round3.json()
                assert r3_body["round"]["round_no"] == 3
                assert r3_body["attempt"]["total"] == 91
                assert r3_body["attempt"]["passed"] is True
                frozen_attempt_id = r3_body["attempt"]["attempt_id"]
                assert r3_body["open_retrain"]["status"] == "fixed_pending_review"
                assert r3_body["open_retrain"]["version"] == 3

                mgr_detail = (await mgr1.get(f"/api/v1/manager/assignments/{asg_linxiaomei}")).json()
                assert mgr_detail["retrains"][0]["evidence_round_no"] == 3
                assert mgr_detail["retrains"][0]["evidence_attempt_id"] == frozen_attempt_id
                assert mgr_detail["retrains"][0]["evidence_attempt"]["attempt_id"] == frozen_attempt_id

                # 过期 expected_version=2 确认 -> 409 STATE_CONFLICT
                stale = await mgr1.post(
                    f"/api/v1/manager/retrains/{retrain_id}/review",
                    headers={"Idempotency-Key": "e2e-stale-confirm"},
                    json={
                        "decision": "confirm",
                        "expected_version": 2,
                        "evidence_attempt_id": frozen_attempt_id,
                        "note": "过期版本复查",
                    },
                )
                assert stale.status_code == 409
                assert stale.json()["error"]["code"] == "STATE_CONFLICT"
                assert stale.json()["error"]["details"]["current_version"] == 3

                # 态 3：店长持有效 version=3 和冻结证据确认 -> verified，并校验同键重放与另一店长冲突
                confirmed = await mgr1.post(
                    f"/api/v1/manager/retrains/{retrain_id}/review",
                    headers={"Idempotency-Key": "e2e-confirm-ok"},
                    json={
                        "decision": "confirm",
                        "expected_version": 3,
                        "evidence_attempt_id": frozen_attempt_id,
                        "note": "同义表达已核对通过",
                    },
                )
                assert confirmed.status_code == 200, confirmed.text
                assert confirmed.json()["retrain"]["status"] == "verified"
                assert confirmed.json()["assignment"]["status"] == "verified"

                replay_confirm = await mgr1.post(
                    f"/api/v1/manager/retrains/{retrain_id}/review",
                    headers={"Idempotency-Key": "e2e-confirm-ok"},
                    json={
                        "decision": "confirm",
                        "expected_version": 3,
                        "evidence_attempt_id": frozen_attempt_id,
                        "note": "同义表达已核对通过",
                    },
                )
                assert replay_confirm.status_code == 200
                assert replay_confirm.headers.get("Idempotent-Replay") == "true"

                second_mgr_conflict = await mgr2.post(
                    f"/api/v1/manager/retrains/{retrain_id}/review",
                    headers={"Idempotency-Key": "e2e-mgr2-confirm"},
                    json={
                        "decision": "confirm",
                        "expected_version": 3,
                        "evidence_attempt_id": frozen_attempt_id,
                        "note": "第二位店长重复确认",
                    },
                )
                assert second_mgr_conflict.status_code == 409
                assert second_mgr_conflict.json()["error"]["code"] == "STATE_CONFLICT"

                # 8) 第二位北京路员工陈阿杰并发提交两轮（事实错误 69 + 完整 99），验证轮次不互覆盖
                for ch in ("ch1", "ch2", "ch3"):
                    assert (
                        await staff2.post(
                            f"/api/v1/staff/assignments/{asg_chenajie}/chapters/{ch}/complete",
                            json={},
                        )
                    ).status_code == 200
                s2_session = (
                    await staff2.post(
                        f"/api/v1/staff/assignments/{asg_chenajie}/roleplay-sessions",
                        json={},
                    )
                ).json()["session"]["id"]

                async with _new_client(app) as staff2_clone:
                    staff2_clone.cookies.update(staff2.cookies)
                    conc_a, conc_b = await asyncio.gather(
                        staff2.post(
                            f"/api/v1/staff/roleplay-sessions/{s2_session}/rounds",
                            json={
                                "client_round_id": str(uuid4()),
                                "answer_text": FACTUAL_ERROR_PITCH,
                                "question_variant": "default",
                            },
                        ),
                        staff2_clone.post(
                            f"/api/v1/staff/roleplay-sessions/{s2_session}/rounds",
                            json={
                                "client_round_id": str(uuid4()),
                                "answer_text": CORRECT_PITCH,
                                "question_variant": "default",
                            },
                        ),
                    )
                assert [conc_a.status_code, conc_b.status_code] == [201, 201]
                assert {
                    conc_a.json()["round"]["round_no"],
                    conc_b.json()["round"]["round_no"],
                } == {1, 2}
                assert {
                    conc_a.json()["attempt"]["total"],
                    conc_b.json()["attempt"]["total"],
                } == {69, 99}

                # 9) 48 小时统计核对，并在停用第 3 名员工门店关系后验证历史指标不偏移
                hq_stats = (await hq2.get(f"/api/v1/hq/releases/{bj_release_id}/stats")).json()
                mgr_stats = (await mgr1.get(f"/api/v1/manager/releases/{bj_release_id}/stats")).json()
                for stats in (hq_stats, mgr_stats):
                    assert stats["denominator"] == 3
                    assert stats["numerator"] == 2
                    assert stats["rate"] == 0.6667
                    assert stats["empty_roster"] is False

                async with app.state.db.sessionmaker() as session:
                    await session.execute(
                        update(StoreMembership)
                        .where(
                            StoreMembership.user_id == "usr_wangxiaoxue",
                            StoreMembership.store_id == "store_bj",
                        )
                        .values(active=False)
                    )
                    await session.commit()

                hq_stats_after = (await hq2.get(f"/api/v1/hq/releases/{bj_release_id}/stats")).json()
                mgr_stats_after = (await mgr1.get(f"/api/v1/manager/releases/{bj_release_id}/stats")).json()
                assert hq_stats_after["denominator"] == 3 and hq_stats_after["numerator"] == 2
                assert mgr_stats_after["denominator"] == 3 and mgr_stats_after["numerator"] == 2

        # 10) 最终 MySQL 落库表核对
        async with app.state.db.sessionmaker() as session:
            lin_attempts = await session.scalar(
                select(func.count())
                .select_from(RoleplayAttempt)
                .where(RoleplayAttempt.assignment_id == asg_linxiaomei)
            )
            chen_attempts = await session.scalar(
                select(func.count())
                .select_from(RoleplayAttempt)
                .where(RoleplayAttempt.assignment_id == asg_chenajie)
            )
            total_attempts = await session.scalar(select(func.count()).select_from(RoleplayAttempt))
            total_rounds = await session.scalar(select(func.count()).select_from(RoleplayRound))
            assert lin_attempts == 3
            assert chen_attempts == 2
            assert total_attempts == 5
            assert total_rounds == 5

            retrain_row = await session.scalar(
                select(Retrain).where(Retrain.assignment_id == asg_linxiaomei)
            )
            assert retrain_row is not None
            assert retrain_row.status is RetrainStatus.verified
            assert retrain_row.reviewed_by == "usr_liming"
            assert retrain_row.reviewed_at is not None
            assert retrain_row.evidence_round_no == 3

            audit_actions = set(await session.scalars(select(AuditEvent.action)))
            assert {
                AuditAction.course_reviewed,
                AuditAction.release_published,
                AuditAction.retrain_issued,
                AuditAction.retrain_confirmed,
            }.issubset(audit_actions)
            assert await session.scalar(select(func.count()).select_from(IdempotencyRecord)) >= 4
    finally:
        await app.state.db.dispose()
