"""T005 店长看板、补训指派、人工复查与 48 小时统计接口测试。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import Select, select, update

from app.models import (
    Assignment,
    AuditAction,
    AuditEvent,
    MembershipRole,
    Release,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    RoleplaySession,
    RoundStatus,
    Store,
    StoreMembership,
    User,
    UserRole,
)
from app.models.base import new_id
from app.services import manager as manager_service
from tests.conftest import login
from tests.helpers import publish_seed_course, publish_version, review_version

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


async def _add_store_manager(
    app,
    *,
    user_id: str,
    name: str,
    store_ids: tuple[str, ...],
) -> None:
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            session.add(
                User(
                    id=user_id,
                    name=name,
                    role=UserRole.store_manager,
                    active=True,
                )
            )
            for store_id in store_ids:
                session.add(
                    StoreMembership(
                        id=new_id("mbr"),
                        user_id=user_id,
                        store_id=store_id,
                        role=MembershipRole.store_manager,
                        active=True,
                    )
                )


async def _complete_all_chapters_and_start_session(
    client: AsyncClient, staff_id: str, release_id: str
) -> tuple[str, str]:
    await login(client, staff_id)
    assignments = (await client.get("/api/v1/staff/assignments")).json()["items"]
    assignment = next(item for item in assignments if item["release_id"] == release_id)
    assignment_id = assignment["assignment_id"]
    for chapter_key in ("ch1", "ch2", "ch3"):
        resp = await client.post(
            f"/api/v1/staff/assignments/{assignment_id}/chapters/{chapter_key}/complete",
            json={},
        )
        assert resp.status_code == 200, resp.text
    created = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-sessions",
        json={},
    )
    assert created.status_code in (200, 201), created.text
    return assignment_id, created.json()["session"]["id"]


async def _submit_round(
    client: AsyncClient,
    session_id: str,
    answer_text: str,
    *,
    client_round_id: str | None = None,
) -> dict:
    resp = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json={
            "client_round_id": client_round_id or str(uuid4()),
            "answer_text": answer_text,
            "question_variant": "default",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.anyio
async def test_manager_and_stats_auth_and_cross_store_isolation(app, client: AsyncClient):
    """验证角色鉴权、匿名拒绝、跨门店 404 隔离以及多门店店长范围裁剪。"""
    # 匿名访问店长和总部统计接口均返回 401
    assert (await client.get("/api/v1/manager/releases")).status_code == 401
    assert (await client.get("/api/v1/hq/releases/rls_any/stats")).status_code == 401

    # 总部审校后分别发布：北京路单店批次、佛山单店批次、双店联合批次
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200
    bj_release = (
        await publish_version(client, store_ids=("store_bj",), key="pub-bj")
    ).json()["release"]
    fs_release = (
        await publish_version(client, store_ids=("store_fs",), key="pub-fs")
    ).json()["release"]
    both_release = (
        await publish_version(
            client, store_ids=("store_bj", "store_fs"), key="pub-both"
        )
    ).json()["release"]

    # 创建佛山店长，用于交叉验证跨店隔离
    await _add_store_manager(
        app,
        user_id="usr_fs_mgr",
        name="佛山店长",
        store_ids=("store_fs",),
    )

    # 员工角色访问店长和总部统计接口返回 403
    await login(client, "usr_linxiaomei")
    for path in (
        "/api/v1/manager/releases",
        f"/api/v1/manager/releases/{bj_release['id']}",
        f"/api/v1/manager/releases/{bj_release['id']}/assignees",
        f"/api/v1/manager/releases/{bj_release['id']}/stats",
        f"/api/v1/hq/releases/{bj_release['id']}/stats",
    ):
        resp = await client.get(path)
        assert resp.status_code == 403
        assert resp.json()["error"]["code"] == "FORBIDDEN_ROLE"

    # 总部访问店长接口返回 403
    await login(client, "usr_linmin")
    resp = await client.get("/api/v1/manager/releases")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN_ROLE"

    # 获取北京路与佛山各一名员工的 assignment_id
    bj_assignees = (
        await client.get(f"/api/v1/hq/releases/{bj_release['id']}/assignees")
    ).json()["items"]
    bj_asg_id = bj_assignees[0]["assignment_id"]
    fs_assignees = (
        await client.get(f"/api/v1/hq/releases/{fs_release['id']}/assignees")
    ).json()["items"]
    fs_asg_id = fs_assignees[0]["assignment_id"]

    # 北京路店长不能访问总部统计接口 (403)
    await login(client, "usr_liming")
    hq_stats = await client.get(f"/api/v1/hq/releases/{bj_release['id']}/stats")
    assert hq_stats.status_code == 403
    assert hq_stats.json()["error"]["code"] == "FORBIDDEN_ROLE"

    # 北京路店长列表只看到北京路单店批次和双店联合批次，不含佛山单店批次
    mgr_releases = await client.get("/api/v1/manager/releases")
    assert mgr_releases.status_code == 200
    release_ids = {item["release_id"] for item in mgr_releases.json()["items"]}
    assert release_ids == {bj_release["id"], both_release["id"]}

    # 双店批次下，北京路店长只看到北京路 3 人，不泄露佛山 2 人
    both_detail = await client.get(f"/api/v1/manager/releases/{both_release['id']}")
    assert both_detail.status_code == 200
    stores = both_detail.json()["release"]["stores"]
    assert [store["id"] for store in stores] == ["store_bj"]
    assert stores[0]["assigned"] == 3

    both_assignees = await client.get(
        f"/api/v1/manager/releases/{both_release['id']}/assignees"
    )
    assert both_assignees.status_code == 200
    assert len(both_assignees.json()["items"]) == 3
    assert all(
        item["store_id"] == "store_bj" for item in both_assignees.json()["items"]
    )

    both_stats = await client.get(f"/api/v1/manager/releases/{both_release['id']}/stats")
    assert both_stats.status_code == 200
    assert both_stats.json()["denominator"] == 3
    assert [row["store_id"] for row in both_stats.json()["by_store"]] == ["store_bj"]

    # 北京路店长跨店访问佛山批次、任务详情和发起补训全部返回 404
    for path in (
        f"/api/v1/manager/releases/{fs_release['id']}",
        f"/api/v1/manager/releases/{fs_release['id']}/assignees",
        f"/api/v1/manager/releases/{fs_release['id']}/stats",
        f"/api/v1/manager/assignments/{fs_asg_id}",
    ):
        cross = await client.get(path)
        assert cross.status_code == 404, path
        assert cross.json()["error"]["code"] == "NOT_FOUND"

    cross_issue = await client.post(
        f"/api/v1/manager/assignments/{fs_asg_id}/retrains",
        headers={"Idempotency-Key": "cross-store-issue"},
        json={"focus_fact_key": "fact_box_rule", "note": "跨店尝试"},
    )
    assert cross_issue.status_code == 404
    assert cross_issue.json()["error"]["code"] == "NOT_FOUND"

    # 佛山店长访问北京路任务同样 404
    await login(client, "usr_fs_mgr")
    assert (
        await client.get(f"/api/v1/manager/assignments/{bj_asg_id}")
    ).status_code == 404

    # 请求体夹带身份字段或缺少 JSON Content-Type 返回 422
    await login(client, "usr_liming")
    bad_body = await client.post(
        f"/api/v1/manager/assignments/{bj_asg_id}/retrains",
        headers={"Idempotency-Key": "extra-field"},
        json={
            "focus_fact_key": "fact_box_rule",
            "note": "夹带字段",
            "issued_by": "usr_liming",
        },
    )
    assert bad_body.status_code == 422
    assert bad_body.json()["error"]["code"] == "VALIDATION_ERROR"

    no_json = await client.post(
        f"/api/v1/manager/assignments/{bj_asg_id}/retrains",
        headers={"Idempotency-Key": "no-json"},
        content=b"{}",
    )
    assert no_json.status_code == 422
    assert no_json.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.anyio
async def test_retrain_issue_review_confirm_lifecycle_and_idempotency(
    app, client: AsyncClient
):
    """完整闭环：漏讲 -> 指派补训 -> 幂等重放 -> 未改正提前确认被拒 -> 通关待复查 -> 确认 -> 审计。"""
    release = await publish_seed_course(client, store_ids=("store_bj",))
    release_id = release["id"]

    # 员工先学完章节并建会话，但尚未提交正式对练
    asg_id, session_id = await _complete_all_chapters_and_start_session(
        client, "usr_chenajie", release_id
    )

    # 尚无正式成绩时指派补训 -> 409 NO_ATTEMPT
    await login(client, "usr_liming")
    missing_key = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        json={"focus_fact_key": "fact_box_rule", "note": "无幂等键"},
    )
    assert missing_key.status_code == 400
    assert missing_key.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    no_attempt = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": "no-attempt-1"},
        json={"focus_fact_key": "fact_box_rule", "note": "未对练"},
    )
    assert no_attempt.status_code == 409
    assert no_attempt.json()["error"]["code"] == "NO_ATTEMPT"

    # 员工提交第 1 轮：漏讲端盒规则（99 分但一票否决）
    await login(client, "usr_chenajie")
    round1 = await _submit_round(client, session_id, MISSING_BOX_PITCH)
    assert round1["attempt"]["passed"] is False
    assert round1["round"]["round_no"] == 1

    # 模拟第 2 轮已提交但仍停在 scoring（尚未出正式成绩）
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            rps = await session.get(RoleplaySession, session_id)
            assert rps is not None
            rps.last_round_no = 2
            session.add(
                RoleplayRound(
                    id=new_id("rnd"),
                    session_id=session_id,
                    round_no=2,
                    client_round_id=str(uuid4()),
                    question_text="顾客问法",
                    answer_text="评分中",
                    status=RoundStatus.scoring,
                )
            )

    # 店长指派不存在于漏讲列表的考点 -> 422 FOCUS_NOT_MISSED
    await login(client, "usr_liming")
    wrong_focus = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": "wrong-focus-1"},
        json={"focus_fact_key": "fact_price", "note": "未漏讲价格"},
    )
    assert wrong_focus.status_code == 422
    assert wrong_focus.json()["error"]["code"] == "FOCUS_NOT_MISSED"
    assert [
        f["key"] for f in wrong_focus.json()["error"]["details"]["missed_required_facts"]
    ] == ["fact_box_rule"]

    # 店长正确发起补训，baseline_round_no 必须取当前会话 last_round_no=2
    issue_key = "issue-retrain-1"
    issued = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": issue_key},
        json={"focus_fact_key": "fact_box_rule", "note": "早会抽查未讲端盒规则"},
    )
    assert issued.status_code == 201, issued.text
    issued_data = issued.json()
    retrain_id = issued_data["retrain"]["id"]
    assert issued_data["retrain"]["status"] == "pending"
    assert issued_data["retrain"]["baseline_round_no"] == 2
    assert issued_data["retrain"]["version"] == 1
    assert issued_data["retrain"]["focus"] == {
        "fact_key": "fact_box_rule",
        "label": "端盒 6 个不重复",
    }
    assert issued_data["retrain"]["issued_by"] == {"id": "usr_liming", "name": "李明"}
    assert issued_data["assignment"]["status"] == "retrain_pending"

    # 同一幂等键 + 相同请求体 -> 201 重放，响应体完全一致
    replayed_issue = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": issue_key},
        json={"focus_fact_key": "fact_box_rule", "note": "早会抽查未讲端盒规则"},
    )
    assert replayed_issue.status_code == 201
    assert replayed_issue.headers.get("Idempotent-Replay") == "true"
    assert replayed_issue.json() == issued_data

    # 同一幂等键 + 不同请求体 -> 409 IDEMPOTENCY_KEY_REUSED
    reused_issue = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": issue_key},
        json={"focus_fact_key": "fact_box_rule", "note": "换了一条备注"},
    )
    assert reused_issue.status_code == 409
    assert reused_issue.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    # 新幂等键重复发起补训 -> 409 RETRAIN_EXISTS
    dup_issue = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": "issue-retrain-2"},
        json={"focus_fact_key": "fact_box_rule", "note": "重复发起"},
    )
    assert dup_issue.status_code == 409
    assert dup_issue.json()["error"]["code"] == "RETRAIN_EXISTS"
    assert dup_issue.json()["error"]["details"]["retrain"]["id"] == retrain_id

    # 员工第 3 轮复练仍漏讲 -> submitted_unfixed
    await login(client, "usr_chenajie")
    round3 = await _submit_round(client, session_id, FACTUAL_ERROR_PITCH)
    assert round3["round"]["round_no"] == 3
    assert round3["open_retrain"]["status"] == "submitted_unfixed"
    assert round3["open_retrain"]["version"] == 2
    assert round3["assignment"]["status"] == "retrain_unfixed"

    # 店长在未改正时提前确认 -> 409 STATE_CONFLICT
    await login(client, "usr_liming")
    early_confirm = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "early-confirm-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": round3["attempt"]["attempt_id"],
            "note": "提前确认",
        },
    )
    assert early_confirm.status_code == 409
    assert early_confirm.json()["error"]["code"] == "STATE_CONFLICT"
    assert early_confirm.json()["error"]["details"]["current_status"] == "submitted_unfixed"

    # 员工第 4 轮使用同义表达整轮通关 -> fixed_pending_review，冻结证据
    await login(client, "usr_chenajie")
    round4 = await _submit_round(client, session_id, SYNONYM_PITCH)
    assert round4["round"]["round_no"] == 4
    assert round4["attempt"]["passed"] is True
    frozen_attempt_id = round4["attempt"]["attempt_id"]
    first_qualified_at = round4["assignment"]["qualified_at"]
    assert first_qualified_at is not None
    assert round4["open_retrain"]["status"] == "fixed_pending_review"
    assert round4["open_retrain"]["version"] == 3
    assert round4["assignment"]["status"] == "pending_review"

    # 进入待复查后员工继续练习（第 5 轮），冻结证据不得被改写
    round5 = await _submit_round(client, session_id, CORRECT_PITCH)
    assert round5["round"]["round_no"] == 5
    later_attempt_id = round5["attempt"]["attempt_id"]
    assert later_attempt_id != frozen_attempt_id

    # 检查店长看板和详情：pending_review=1、open_retrains=1、attempts 不含 scoring 轮次
    await login(client, "usr_liming")
    detail = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert detail["assignment"]["status"] == "pending_review"
    assert [a["round_no"] for a in detail["attempts"]] == [5, 4, 3, 1]
    assert detail["attempts"][0]["answer_text"] == CORRECT_PITCH
    assert detail["retrains"][0]["evidence_attempt_id"] == frozen_attempt_id
    assert detail["retrains"][0]["evidence_round_no"] == 4

    rel_detail = (await client.get(f"/api/v1/manager/releases/{release_id}")).json()
    store_summary = rel_detail["release"]["stores"][0]
    assert store_summary["pending_review"] == 1
    assert store_summary["open_retrains"] == 1

    # 用非冻结证据（第 5 轮成绩）确认 -> 409 EVIDENCE_MISMATCH
    wrong_ev = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "wrong-ev-1"},
        json={
            "decision": "confirm",
            "expected_version": 3,
            "evidence_attempt_id": later_attempt_id,
            "note": "拿错证据",
        },
    )
    assert wrong_ev.status_code == 409
    assert wrong_ev.json()["error"]["code"] == "EVIDENCE_MISMATCH"

    # 用过期版本号确认 -> 409 STATE_CONFLICT
    stale_ver = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "stale-ver-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "旧版本",
        },
    )
    assert stale_ver.status_code == 409
    assert stale_ver.json()["error"]["code"] == "STATE_CONFLICT"
    assert stale_ver.json()["error"]["details"]["current_version"] == 3
    assert stale_ver.json()["error"]["details"]["evidence_attempt_id"] == frozen_attempt_id

    # 用冻结证据和正确版本号确认 -> 200 verified
    confirm_key = "confirm-retrain-1"
    confirmed = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": confirm_key},
        json={
            "decision": "confirm",
            "expected_version": 3,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "复练已讲清端盒规则",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    confirmed_data = confirmed.json()
    assert confirmed_data["retrain"]["status"] == "verified"
    assert confirmed_data["retrain"]["version"] == 4
    assert confirmed_data["retrain"]["evidence_attempt_id"] == frozen_attempt_id
    assert confirmed_data["retrain"]["reviewed_by"] == {"id": "usr_liming", "name": "李明"}
    assert confirmed_data["retrain"]["reviewed_at"] is not None
    assert confirmed_data["assignment"]["status"] == "verified"
    assert confirmed_data["assignment"]["qualified_at"] == first_qualified_at

    # 同幂等键重放确认 -> 200 + Idempotent-Replay: true
    replayed_confirm = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": confirm_key},
        json={
            "decision": "confirm",
            "expected_version": 3,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "复练已讲清端盒规则",
        },
    )
    assert replayed_confirm.status_code == 200
    assert replayed_confirm.headers.get("Idempotent-Replay") == "true"
    assert replayed_confirm.json() == confirmed_data

    # 同键不同请求体 -> 409 IDEMPOTENCY_KEY_REUSED
    reused_confirm = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": confirm_key},
        json={
            "decision": "confirm",
            "expected_version": 3,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "改了备注",
        },
    )
    assert reused_confirm.status_code == 409
    assert reused_confirm.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    # 第二位同门店店长持过期 version=3 确认 -> 409 STATE_CONFLICT
    await login(client, "usr_zhangtao")
    second_mgr = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "zhangtao-confirm-1"},
        json={
            "decision": "confirm",
            "expected_version": 3,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "重复确认",
        },
    )
    assert second_mgr.status_code == 409
    assert second_mgr.json()["error"]["code"] == "STATE_CONFLICT"
    assert second_mgr.json()["error"]["details"]["current_status"] == "verified"
    assert second_mgr.json()["error"]["details"]["current_version"] == 4

    # 检查详情审计记录：同时记录了 retrain.issued 和 retrain.confirmed，且 reviewed_at 与响应一致
    after_detail = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert after_detail["retrains"][0]["reviewed_at"] == confirmed_data["retrain"]["reviewed_at"]
    assert [ev["action"] for ev in after_detail["audit"]] == [
        "retrain.confirmed",
        "retrain.issued",
    ]

    # verified 后员工再次练习即使漏讲，不会把状态改回 failed；但店长可基于最新漏讲再次发起补训且保留 qualified_at
    await login(client, "usr_chenajie")
    round6 = await _submit_round(client, session_id, MISSING_BOX_PITCH)
    assert round6["assignment"]["status"] == "verified"
    assert round6["assignment"]["qualified_at"] == first_qualified_at

    await login(client, "usr_liming")
    reissued = await client.post(
        f"/api/v1/manager/assignments/{asg_id}/retrains",
        headers={"Idempotency-Key": "reissue-after-verified"},
        json={"focus_fact_key": "fact_box_rule", "note": "二次抽查再补训"},
    )
    assert reissued.status_code == 201
    assert reissued.json()["retrain"]["baseline_round_no"] == 6
    assert reissued.json()["assignment"]["status"] == "retrain_pending"
    after_reissue = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert after_reissue["assignment"]["qualified_at"] == first_qualified_at


@pytest.mark.anyio
async def test_retrain_reject_and_tampered_evidence_guards(app, client: AsyncClient):
    """验证驳回复查重建基线，以及冻结证据被篡改时的 FOCUS_NOT_FIXED 与 ATTEMPT_NOT_PASSED 拦截。"""
    release = await publish_seed_course(client, store_ids=("store_bj",))
    asg_id, session_id = await _complete_all_chapters_and_start_session(
        client, "usr_chenajie", release["id"]
    )

    # 第 1 轮漏讲 -> 店长指派 -> 第 2 轮通过进入待复查
    await _submit_round(client, session_id, MISSING_BOX_PITCH)
    await login(client, "usr_liming")
    retrain_id = (
        await client.post(
            f"/api/v1/manager/assignments/{asg_id}/retrains",
            headers={"Idempotency-Key": "issue-reject-case"},
            json={"focus_fact_key": "fact_box_rule", "note": "首次补训"},
        )
    ).json()["retrain"]["id"]

    await login(client, "usr_chenajie")
    round2 = await _submit_round(client, session_id, CORRECT_PITCH)
    frozen_id = round2["attempt"]["attempt_id"]
    assert round2["open_retrain"]["status"] == "fixed_pending_review"
    assert round2["open_retrain"]["version"] == 2

    # 场景 A：篡改证据使目标考点为 missed -> 422 FOCUS_NOT_FIXED
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            attempt = await session.get(RoleplayAttempt, frozen_id)
            assert attempt is not None
            orig_checks = list(attempt.fact_checks)
            orig_missed = list(attempt.missed_required_facts)
            attempt.fact_checks = [
                {**item, "status": "missed", "evidence": None}
                if item["key"] == "fact_box_rule"
                else item
                for item in orig_checks
            ]
            attempt.passed = False

    await login(client, "usr_liming")
    not_fixed = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "tampered-focus-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": frozen_id,
            "note": "尝试确认未改正证据",
        },
    )
    assert not_fixed.status_code == 422
    assert not_fixed.json()["error"]["code"] == "FOCUS_NOT_FIXED"

    # 场景 B：目标考点为 hit，但其他必考项漏讲且 passed=False -> 422 ATTEMPT_NOT_PASSED
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            attempt = await session.get(RoleplayAttempt, frozen_id)
            assert attempt is not None
            attempt.fact_checks = orig_checks
            attempt.passed = False
            attempt.missed_required_facts = [
                {"key": "fact_price", "label": "零售价 59 元"}
            ]

    not_passed = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "tampered-pass-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": frozen_id,
            "note": "尝试确认未通关证据",
        },
    )
    assert not_passed.status_code == 422
    assert not_passed.json()["error"]["code"] == "ATTEMPT_NOT_PASSED"
    assert not_passed.json()["error"]["details"]["missed_required_facts"] == [
        {"key": "fact_price", "label": "零售价 59 元"}
    ]

    # 恢复证据并测试驳回复查
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            attempt = await session.get(RoleplayAttempt, frozen_id)
            assert attempt is not None
            attempt.passed = True
            attempt.missed_required_facts = orig_missed

    reject_key = "reject-retrain-1"
    rejected = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": reject_key},
        json={
            "decision": "reject",
            "expected_version": 2,
            "note": "口播不够自然，请重新复练",
        },
    )
    assert rejected.status_code == 200, rejected.text
    rej_data = rejected.json()
    assert rej_data["retrain"]["status"] == "pending"
    assert rej_data["retrain"]["evidence_attempt_id"] is None
    assert rej_data["retrain"]["baseline_round_no"] == 2
    assert rej_data["retrain"]["version"] == 3
    assert rej_data["assignment"]["status"] == "retrain_pending"

    # 驳回同键重放
    replayed_reject = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": reject_key},
        json={
            "decision": "reject",
            "expected_version": 2,
            "note": "口播不够自然，请重新复练",
        },
    )
    assert replayed_reject.status_code == 200
    assert replayed_reject.headers.get("Idempotent-Replay") == "true"
    assert replayed_reject.json() == rej_data

    # 审计表保留 retrain.rejected 和历史证据 ID
    async with app.state.db.sessionmaker() as session:
        events = list(
            (
                await session.scalars(
                    select(AuditEvent)
                    .where(
                        AuditEvent.entity_id == retrain_id,
                        AuditEvent.action == AuditAction.retrain_rejected,
                    )
                )
            ).all()
        )
    assert len(events) == 1
    assert events[0].payload["previous_evidence_attempt_id"] == frozen_id

    # 驳回后员工重新提交第 3 轮通关，再次进入待复查并由店长确认通过
    await login(client, "usr_chenajie")
    round3 = await _submit_round(client, session_id, CORRECT_PITCH)
    assert round3["round"]["round_no"] == 3
    assert round3["open_retrain"]["status"] == "fixed_pending_review"
    assert round3["open_retrain"]["version"] == 4
    new_frozen_id = round3["attempt"]["attempt_id"]

    await login(client, "usr_liming")
    confirmed = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "confirm-after-reject"},
        json={
            "decision": "confirm",
            "expected_version": 4,
            "evidence_attempt_id": new_frozen_id,
            "note": "重新复练通过",
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["retrain"]["status"] == "verified"
    assert confirmed.json()["assignment"]["status"] == "verified"


@pytest.mark.anyio
async def test_release_48h_stats_two_stores_boundaries_stability_and_empty_roster(
    app, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    """覆盖 M1 §7.2 两店示例、时间边界、deadline_hours=72、重复通关、名单变化、窗口外复查与空名单。"""
    t0 = datetime(2026, 11, 24, 9, 0, 0, tzinfo=UTC)
    t_after_close = datetime(2026, 11, 26, 12, 0, 0, tzinfo=UTC)

    # 创建一个没有员工的空门店用于空名单口径测试
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            session.add(
                Store(
                    id="store_empty",
                    code="EM-001",
                    name="测试空门店",
                    active=True,
                )
            )

    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200

    # 发布北京路批次（故意设 deadline_hours=72 验证 48h 窗口不受 deadline_hours 影响）
    rls_bj = (
        await publish_version(
            client, store_ids=("store_bj",), deadline_hours=72, key="stats-bj"
        )
    ).json()["release"]["id"]
    # 发布佛山批次
    rls_fs = (
        await publish_version(
            client, store_ids=("store_fs",), deadline_hours=48, key="stats-fs"
        )
    ).json()["release"]["id"]
    # 发布双店联合批次 + 空名单门店批次
    rls_combined = (
        await publish_version(
            client,
            store_ids=("store_bj", "store_fs", "store_empty"),
            deadline_hours=48,
            key="stats-combined",
        )
    ).json()["release"]["id"]
    rls_empty = (
        await publish_version(
            client, store_ids=("store_empty",), deadline_hours=48, key="stats-empty"
        )
    ).json()["release"]["id"]

    # 按 M1 §7.2 设定各批次发布时间与达标时间
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            await session.execute(
                update(Release)
                .where(Release.id == rls_bj)
                .values(published_at=t0, deadline_at=t0 + timedelta(hours=72))
            )
            await session.execute(
                update(Release)
                .where(Release.id == rls_fs)
                .values(
                    published_at=t0 + timedelta(hours=1),
                    deadline_at=t0 + timedelta(hours=49),
                )
            )
            await session.execute(
                update(Release)
                .where(Release.id.in_((rls_combined, rls_empty)))
                .values(published_at=t0, deadline_at=t0 + timedelta(hours=48))
            )

            # 北京路：林小美 +2h20m（计入分子），陈阿杰 +48h30m（窗口后），王晓雪未达标
            await session.execute(
                update(Assignment)
                .where(
                    Assignment.release_id.in_((rls_bj, rls_combined)),
                    Assignment.user_id == "usr_linxiaomei",
                )
                .values(
                    first_passed_at=t0 + timedelta(hours=2, minutes=20),
                    qualified_at=t0 + timedelta(hours=2, minutes=20),
                )
            )
            await session.execute(
                update(Assignment)
                .where(
                    Assignment.release_id.in_((rls_bj, rls_combined)),
                    Assignment.user_id == "usr_chenajie",
                )
                .values(
                    first_passed_at=t0 + timedelta(hours=48, minutes=30),
                    qualified_at=t0 + timedelta(hours=48, minutes=30),
                )
            )

            # 佛山单店批次：周琳发布后 22h（计入分子），何静恰好发布后 48h（左闭右开，不计入分子，计入窗口后）
            await session.execute(
                update(Assignment)
                .where(Assignment.release_id == rls_fs, Assignment.user_id == "usr_zhoulin")
                .values(
                    first_passed_at=t0 + timedelta(hours=23),
                    qualified_at=t0 + timedelta(hours=23),
                )
            )
            await session.execute(
                update(Assignment)
                .where(Assignment.release_id == rls_fs, Assignment.user_id == "usr_hejing")
                .values(
                    first_passed_at=t0 + timedelta(hours=49),
                    qualified_at=t0 + timedelta(hours=49),
                )
            )

            # 联合批次（published_at=t0）中的佛山员工：周琳 +22h（计入），何静恰好 +48h（不计入）
            await session.execute(
                update(Assignment)
                .where(
                    Assignment.release_id == rls_combined,
                    Assignment.user_id == "usr_zhoulin",
                )
                .values(
                    first_passed_at=t0 + timedelta(hours=22),
                    qualified_at=t0 + timedelta(hours=22),
                )
            )
            await session.execute(
                update(Assignment)
                .where(
                    Assignment.release_id == rls_combined,
                    Assignment.user_id == "usr_hejing",
                )
                .values(
                    first_passed_at=t0 + timedelta(hours=48),
                    qualified_at=t0 + timedelta(hours=48),
                )
            )

            # 名单稳定性测试：发布后王晓雪离职、北京路新增一名员工
            await session.execute(
                update(User)
                .where(User.id == "usr_wangxiaoxue")
                .values(active=False)
            )
            session.add(
                User(
                    id="usr_new_staff",
                    name="新入职员工",
                    role=UserRole.staff,
                    active=True,
                )
            )
            session.add(
                StoreMembership(
                    id=new_id("mbr"),
                    user_id="usr_new_staff",
                    store_id="store_bj",
                    role=MembershipRole.staff,
                    active=True,
                )
            )

    # 1) 窗口未结束（发布后 10 小时）查询：window_open=true，陈阿杰窗口后达标尚未发生不计入
    monkeypatch.setattr(
        manager_service, "utcnow", lambda: t0 + timedelta(hours=10)
    )
    open_stats = (await client.get(f"/api/v1/hq/releases/{rls_bj}/stats")).json()
    assert open_stats["window_hours"] == 48
    assert open_stats["window_open"] is True
    assert open_stats["denominator"] == 3
    assert open_stats["numerator"] == 1
    assert open_stats["qualified_after_window"] == 0
    assert open_stats["rate"] == 0.3333

    # 2) 窗口结束后（t_after_close）查询：校验两店示例精确数字
    monkeypatch.setattr(manager_service, "utcnow", lambda: t_after_close)

    bj_stats = (await client.get(f"/api/v1/hq/releases/{rls_bj}/stats")).json()
    assert bj_stats["window_open"] is False
    assert bj_stats["window_start"] == "2026-11-24T09:00:00.000Z"
    assert bj_stats["window_end"] == "2026-11-26T09:00:00.000Z"
    assert bj_stats["denominator"] == 3
    assert bj_stats["numerator"] == 1
    assert bj_stats["qualified_after_window"] == 1
    assert bj_stats["rate"] == 0.3333
    assert bj_stats["empty_roster"] is False

    fs_stats = (await client.get(f"/api/v1/hq/releases/{rls_fs}/stats")).json()
    assert fs_stats["window_open"] is False
    assert fs_stats["denominator"] == 2
    assert fs_stats["numerator"] == 1
    assert fs_stats["qualified_after_window"] == 1
    assert fs_stats["rate"] == 0.5
    assert fs_stats["empty_roster"] is False

    # 3) 联合批次（含北京 3 人 1 通关、佛山 2 人 1 通关、空门店 0 人）：
    # 汇总应为 (1+1)/(3+2) = 0.4，而非对各店比率求平均，且空门店 rate=None、empty_roster=True
    combined_stats = (
        await client.get(f"/api/v1/hq/releases/{rls_combined}/stats")
    ).json()
    assert combined_stats["denominator"] == 5
    assert combined_stats["numerator"] == 2
    assert combined_stats["qualified_after_window"] == 2
    assert combined_stats["rate"] == 0.4
    assert combined_stats["empty_roster"] is False
    by_store = {row["store_id"]: row for row in combined_stats["by_store"]}
    assert by_store["store_bj"]["rate"] == 0.3333
    assert by_store["store_fs"]["rate"] == 0.5
    assert by_store["store_empty"]["denominator"] == 0
    assert by_store["store_empty"]["rate"] is None
    assert by_store["store_empty"]["empty_roster"] is True

    # 4) 纯空名单批次
    empty_stats = (await client.get(f"/api/v1/hq/releases/{rls_empty}/stats")).json()
    assert empty_stats["denominator"] == 0
    assert empty_stats["numerator"] == 0
    assert empty_stats["qualified_after_window"] == 0
    assert empty_stats["rate"] is None
    assert empty_stats["empty_roster"] is True

    # 5) 店长视角：北京路店长看联合批次只算北京路；离职员工保留且 active=false，新入职员工不在名单
    await login(client, "usr_liming")
    mgr_combined = (
        await client.get(f"/api/v1/manager/releases/{rls_combined}/stats")
    ).json()
    assert mgr_combined["denominator"] == 3
    assert mgr_combined["numerator"] == 1
    assert mgr_combined["qualified_after_window"] == 1
    assert mgr_combined["rate"] == 0.3333
    assert [row["store_id"] for row in mgr_combined["by_store"]] == ["store_bj"]

    assignees = (
        await client.get(f"/api/v1/manager/releases/{rls_bj}/assignees")
    ).json()["items"]
    by_uid = {item["user"]["id"]: item for item in assignees}
    assert set(by_uid) == {"usr_linxiaomei", "usr_chenajie", "usr_wangxiaoxue"}
    assert by_uid["usr_wangxiaoxue"]["user"]["active"] is False

    # 6) 重复通关与窗口外复查确认均不改变 48 小时统计分子
    asg_lin, session_lin = await _complete_all_chapters_and_start_session(
        client, "usr_linxiaomei", rls_bj
    )
    for _ in range(3):
        await _submit_round(client, session_lin, CORRECT_PITCH)
    # 即使林小美之后复习漏讲 -> 店长发起补训 -> 复练通关 -> 窗口外确认，qualified_at 和统计不变
    await _submit_round(client, session_lin, MISSING_BOX_PITCH)
    await login(client, "usr_liming")
    rtn_lin = (
        await client.post(
            f"/api/v1/manager/assignments/{asg_lin}/retrains",
            headers={"Idempotency-Key": "lin-retrain-1"},
            json={"focus_fact_key": "fact_box_rule", "note": "抽查"},
        )
    ).json()["retrain"]["id"]
    await login(client, "usr_linxiaomei")
    pass_round = await _submit_round(client, session_lin, CORRECT_PITCH)
    await login(client, "usr_liming")
    confirm_lin = await client.post(
        f"/api/v1/manager/retrains/{rtn_lin}/review",
        headers={"Idempotency-Key": "lin-confirm-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": pass_round["attempt"]["attempt_id"],
            "note": "窗口外确认",
        },
    )
    assert confirm_lin.status_code == 200
    assert confirm_lin.json()["assignment"]["qualified_at"] == "2026-11-24T11:20:00.000Z"

    bj_stats_after = (await client.get(f"/api/v1/manager/releases/{rls_bj}/stats")).json()
    assert bj_stats_after["denominator"] == 3
    assert bj_stats_after["numerator"] == 1
    assert bj_stats_after["qualified_after_window"] == 1
    assert bj_stats_after["rate"] == 0.3333


@pytest.mark.anyio
async def test_manager_lists_pagination_and_no_active_store(app, client: AsyncClient):
    """验证店长列表分页游标和无有效管辖门店时的 404/空列表隔离。"""
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200
    r1 = (await publish_version(client, store_ids=("store_bj",), key="page-1")).json()[
        "release"
    ]["id"]
    r2 = (await publish_version(client, store_ids=("store_bj",), key="page-2")).json()[
        "release"
    ]["id"]

    await login(client, "usr_liming")
    page1 = (await client.get("/api/v1/manager/releases?limit=1")).json()
    assert len(page1["items"]) == 1
    assert page1["next_cursor"] is not None
    page2 = (
        await client.get(f"/api/v1/manager/releases?limit=1&cursor={page1['next_cursor']}")
    ).json()
    assert len(page2["items"]) == 1
    assert page2["next_cursor"] is None
    assert {page1["items"][0]["release_id"], page2["items"][0]["release_id"]} == {r1, r2}

    asg_p1 = (
        await client.get(f"/api/v1/manager/releases/{r1}/assignees?limit=2")
    ).json()
    assert len(asg_p1["items"]) == 2
    assert asg_p1["next_cursor"] is not None
    asg_p2 = (
        await client.get(
            f"/api/v1/manager/releases/{r1}/assignees?limit=2&cursor={asg_p1['next_cursor']}"
        )
    ).json()
    assert len(asg_p2["items"]) == 1
    assert asg_p2["next_cursor"] is None

    # 停用门店后，绑定该停用门店的店长看不到任何批次，访问详情返回 404
    async with app.state.db.sessionmaker() as session:
        async with session.begin():
            session.add(
                Store(
                    id="store_closed",
                    code="CL-001",
                    name="停用门店",
                    active=False,
                )
            )
            session.add(
                User(
                    id="usr_closed_mgr",
                    name="停用门店店长",
                    role=UserRole.store_manager,
                    active=True,
                )
            )
            session.add(
                StoreMembership(
                    id=new_id("mbr"),
                    user_id="usr_closed_mgr",
                    store_id="store_closed",
                    role=MembershipRole.store_manager,
                    active=True,
                )
            )

    await login(client, "usr_closed_mgr")
    empty_list = await client.get("/api/v1/manager/releases")
    assert empty_list.status_code == 200
    assert empty_list.json() == {"items": [], "next_cursor": None}
    assert (await client.get(f"/api/v1/manager/releases/{r1}")).status_code == 404
    assert (await client.get(f"/api/v1/manager/releases/{r1}/stats")).status_code == 404


@pytest.mark.anyio
async def test_review_validation_cross_store_recent_ten_and_concurrent_confirm(
    app, client: AsyncClient
):
    """覆盖复查参数校验、跨店复查 404、驳回基线跨过待复查后复习轮次、最近 10 条截断及并发确认互斥。"""
    release = await publish_seed_course(client, store_ids=("store_bj",))
    asg_id, session_id = await _complete_all_chapters_and_start_session(
        client, "usr_chenajie", release["id"]
    )
    await _add_store_manager(
        app,
        user_id="usr_fs_mgr2",
        name="佛山店长乙",
        store_ids=("store_fs",),
    )

    # 先刷 11 轮对练（前 10 轮漏讲，第 11 轮仍漏讲），检验详情只返回最近 10 条
    for _ in range(11):
        await _submit_round(client, session_id, MISSING_BOX_PITCH)

    await login(client, "usr_liming")
    detail = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert len(detail["attempts"]) == 10
    assert [a["round_no"] for a in detail["attempts"]] == list(range(11, 1, -1))

    # 发起补训 -> 第 12 轮通关进入待复查 -> 员工继续复习第 13 轮
    retrain_id = (
        await client.post(
            f"/api/v1/manager/assignments/{asg_id}/retrains",
            headers={"Idempotency-Key": "issue-edge-1"},
            json={"focus_fact_key": "fact_box_rule", "note": "边缘测试"},
        )
    ).json()["retrain"]["id"]

    await login(client, "usr_chenajie")
    round12 = await _submit_round(client, session_id, CORRECT_PITCH)
    frozen_id = round12["attempt"]["attempt_id"]
    await _submit_round(client, session_id, CORRECT_PITCH)  # 第 13 轮

    # 佛山店长跨店复查北京路补训 -> 404 NOT_FOUND
    await login(client, "usr_fs_mgr2")
    cross_review = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "cross-review-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": frozen_id,
            "note": "跨店复查",
        },
    )
    assert cross_review.status_code == 404
    assert cross_review.json()["error"]["code"] == "NOT_FOUND"

    # 北京路店长参数校验：缺幂等键 400、confirm 缺 evidence_attempt_id 422、bool 版本 422、reject 错证据 409
    await login(client, "usr_liming")
    assert (
        await client.post(
            f"/api/v1/manager/retrains/{retrain_id}/review",
            json={
                "decision": "confirm",
                "expected_version": 2,
                "evidence_attempt_id": frozen_id,
                "note": "",
            },
        )
    ).status_code == 400

    assert (
        await client.post(
            f"/api/v1/manager/retrains/{retrain_id}/review",
            headers={"Idempotency-Key": "missing-ev"},
            json={"decision": "confirm", "expected_version": 2, "note": ""},
        )
    ).status_code == 422

    assert (
        await client.post(
            f"/api/v1/manager/retrains/{retrain_id}/review",
            headers={"Idempotency-Key": "bool-ver"},
            json={
                "decision": "confirm",
                "expected_version": True,
                "evidence_attempt_id": frozen_id,
                "note": "",
            },
        )
    ).status_code == 422

    bad_reject_ev = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "bad-reject-ev"},
        json={
            "decision": "reject",
            "expected_version": 2,
            "evidence_attempt_id": "att_wrong_id",
            "note": "错证据",
        },
    )
    assert bad_reject_ev.status_code == 409
    assert bad_reject_ev.json()["error"]["code"] == "EVIDENCE_MISMATCH"

    # 驳回时 baseline_round_no 应推进到当前 last_round_no=13（跨过第 13 轮）
    rej = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "reject-after-r13"},
        json={"decision": "reject", "expected_version": 2, "note": "再练一次"},
    )
    assert rej.status_code == 200
    assert rej.json()["retrain"]["baseline_round_no"] == 13
    assert rej.json()["retrain"]["version"] == 3

    # 员工第 14 轮通关再次进入待复查 (version=4)
    await login(client, "usr_chenajie")
    round14 = await _submit_round(client, session_id, CORRECT_PITCH)
    assert round14["round"]["round_no"] == 14
    frozen_id_2 = round14["attempt"]["attempt_id"]
    assert round14["open_retrain"]["version"] == 4

    # 两位北京路店长先后持同一过期版本 version=4 确认：首位成功 200，第二位 409 STATE_CONFLICT
    await login(client, "usr_liming")
    r_a = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "concurrent-mgr-a"},
        json={
            "decision": "confirm",
            "expected_version": 4,
            "evidence_attempt_id": frozen_id_2,
            "note": "李明确认",
        },
    )
    assert r_a.status_code == 200, r_a.text

    await login(client, "usr_zhangtao")
    r_b = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "concurrent-mgr-b"},
        json={
            "decision": "confirm",
            "expected_version": 4,
            "evidence_attempt_id": frozen_id_2,
            "note": "张涛确认",
        },
    )
    assert r_b.status_code == 409, r_b.text
    assert r_b.json()["error"]["code"] == "STATE_CONFLICT"
    assert r_b.json()["error"]["details"]["current_status"] == "verified"
    assert r_b.json()["error"]["details"]["current_version"] == 5


@pytest.mark.anyio
async def test_frozen_evidence_preserved_when_pushed_out_of_recent_ten_attempts(
    client: AsyncClient,
):
    """P2 回归：第 2 轮进入待复查后再练 10 轮，attempts 仍仅保留第 3-12 轮，但 retrain.evidence_attempt 完整返回第 2 轮证据。"""
    release = await publish_seed_course(client, store_ids=("store_bj",))
    asg_id, session_id = await _complete_all_chapters_and_start_session(
        client, "usr_chenajie", release["id"]
    )

    # 第 1 轮漏讲 -> 店长指派补训 -> 第 2 轮同义表达通关并冻结证据
    await _submit_round(client, session_id, MISSING_BOX_PITCH)
    await login(client, "usr_liming")
    retrain_id = (
        await client.post(
            f"/api/v1/manager/assignments/{asg_id}/retrains",
            headers={"Idempotency-Key": "p2-issue-1"},
            json={"focus_fact_key": "fact_box_rule", "note": "端盒规则补训"},
        )
    ).json()["retrain"]["id"]

    await login(client, "usr_chenajie")
    round2 = await _submit_round(client, session_id, SYNONYM_PITCH)
    assert round2["round"]["round_no"] == 2
    assert round2["open_retrain"]["status"] == "fixed_pending_review"
    frozen_attempt_id = round2["attempt"]["attempt_id"]

    # 员工继续练习 10 轮（第 3 至第 12 轮），把第 2 轮挤出最近 10 条成绩窗口
    for _ in range(10):
        await _submit_round(client, session_id, CORRECT_PITCH)

    # 店长查询详情：attempts 仍严格保留最近 10 条（第 12..3 轮），不包含第 2 轮
    await login(client, "usr_liming")
    detail = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert len(detail["attempts"]) == 10
    assert [att["round_no"] for att in detail["attempts"]] == list(range(12, 2, -1))
    assert all(att["attempt_id"] != frozen_attempt_id for att in detail["attempts"])

    # retrains[0].evidence_attempt 仍提供第 2 轮完整证据（含原话与逐项命中结果）
    retrain = detail["retrains"][0]
    assert retrain["id"] == retrain_id
    assert retrain["evidence_attempt_id"] == frozen_attempt_id
    ev = retrain["evidence_attempt"]
    assert ev is not None
    assert ev["attempt_id"] == frozen_attempt_id
    assert ev["round_no"] == 2
    assert ev["total"] == 91
    assert ev["passed"] is True
    assert ev["answer_text"] == SYNONYM_PITCH
    assert len(ev["fact_checks"]) == 3
    box_check = next(fc for fc in ev["fact_checks"] if fc["key"] == "fact_box_rule")
    assert box_check["status"] == "hit"
    assert box_check["evidence"]

    # 店长查看完整冻结证据后确认通过，再次查询详情仍保留该冻结证据
    confirmed = await client.post(
        f"/api/v1/manager/retrains/{retrain_id}/review",
        headers={"Idempotency-Key": "p2-confirm-1"},
        json={
            "decision": "confirm",
            "expected_version": 2,
            "evidence_attempt_id": frozen_attempt_id,
            "note": "已核对第 2 轮冻结证据",
        },
    )
    assert confirmed.status_code == 200
    after_detail = (await client.get(f"/api/v1/manager/assignments/{asg_id}")).json()
    assert after_detail["retrains"][0]["status"] == "verified"
    assert after_detail["retrains"][0]["evidence_attempt"]["attempt_id"] == frozen_attempt_id
    assert after_detail["retrains"][0]["evidence_attempt"]["round_no"] == 2


@pytest.mark.anyio
async def test_issue_retrain_avoids_gap_lock_on_retrains_and_preserves_invariants(
    app, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
):
    """P1 单元测试回归：验证指派/复查读取 retrains 时不加 FOR UPDATE（避免 InnoDB 间隙锁死锁），
    同时验证两名独立员工首次补训、同一任务幂等重放与单开约束。"""
    from sqlalchemy.ext.asyncio import AsyncSession

    release = await publish_seed_course(client, store_ids=("store_bj",))
    asg_a, ses_a = await _complete_all_chapters_and_start_session(
        client, "usr_linxiaomei", release["id"]
    )
    await _submit_round(client, ses_a, MISSING_BOX_PITCH)

    asg_b, ses_b = await _complete_all_chapters_and_start_session(
        client, "usr_chenajie", release["id"]
    )
    await _submit_round(client, ses_b, MISSING_BOX_PITCH)

    retrain_for_update_statements: list[str] = []
    original_scalars = AsyncSession.scalars

    async def spy_scalars(self, statement, *args, **kwargs):
        if isinstance(statement, Select) and getattr(statement, "_for_update_arg", None) is not None:
            sql_text = str(statement)
            if "FROM retrains" in sql_text:
                retrain_for_update_statements.append(sql_text)
        return await original_scalars(self, statement, *args, **kwargs)

    monkeypatch.setattr(AsyncSession, "scalars", spy_scalars)

    await login(client, "usr_liming")
    r1 = await client.post(
        f"/api/v1/manager/assignments/{asg_a}/retrains",
        headers={"Idempotency-Key": "p1-staff-a"},
        json={"focus_fact_key": "fact_box_rule", "note": "A 首次补训"},
    )
    assert r1.status_code == 201, r1.text

    await login(client, "usr_zhangtao")
    r2 = await client.post(
        f"/api/v1/manager/assignments/{asg_b}/retrains",
        headers={"Idempotency-Key": "p1-staff-b"},
        json={"focus_fact_key": "fact_box_rule", "note": "B 首次补训"},
    )
    assert r2.status_code == 201, r2.text

    # 确认补训查询未对 retrains 使用 FOR UPDATE（避免 MySQL 8.4 空范围间隙锁死锁）
    assert retrain_for_update_statements == []

    # 对 A 再用相同幂等键重放 -> 201 + Idempotent-Replay
    await login(client, "usr_liming")
    replay = await client.post(
        f"/api/v1/manager/assignments/{asg_a}/retrains",
        headers={"Idempotency-Key": "p1-staff-a"},
        json={"focus_fact_key": "fact_box_rule", "note": "A 首次补训"},
    )
    assert replay.status_code == 201
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert replay.json() == r1.json()

    # 对 A 用新幂等键重复发起 -> 409 RETRAIN_EXISTS
    dup = await client.post(
        f"/api/v1/manager/assignments/{asg_a}/retrains",
        headers={"Idempotency-Key": "p1-staff-a-dup"},
        json={"focus_fact_key": "fact_box_rule", "note": "重复补训"},
    )
    assert dup.status_code == 409
    assert dup.json()["error"]["code"] == "RETRAIN_EXISTS"

