import asyncio
from datetime import timedelta
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models import (
    AnswerSource,
    Assignment,
    QuestionVariant,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    RoleplaySession,
    RoundStatus,
    RubricVersion,
)
from app.models.base import utcnow
from app.seed_data import COURSE_VERSION_ID, RUBRIC_VERSION_ID
from app.services import roleplay as roleplay_service
from app.services.roleplay_scoring import (
    ScoringInvalidOutputError,
    ScoringUnavailableError,
)
from tests.conftest import login
from tests.helpers import incompatible_rubric, publish_seed_course

CORRECT = (
    "您摸摸我们拆好的样品，这款虽然 59 元但它是日本正版联名授权，"
    "定制超柔短毛绒手感非常软糯！如果想稳抽乌萨奇可以摇盒挑手感，"
    "或者和朋友拼端盒 6 个绝对不重复，结账还可以加 9.9 元换购防尘挂袋挂包不怕脏哦！"
)
SYNONYM = (
    "这款是日本正版授权的联名毛绒公仔，手感软糯，五十九块钱一个；"
    "端盒六个不重样，您要不要摸一下拆开的样品？加 9.9 元还能配防尘挂袋。"
)
FACTUAL_ERROR = (
    "这款是正版联名毛绒公仔，59 元，端盒 6 个可能会重复，"
    "您摸摸样品，加 9.9 元配防尘挂袋，买一送一哦。"
)


async def _assignment_id(client) -> str:
    listing = await client.get("/api/v1/staff/assignments")
    assert listing.status_code == 200
    return listing.json()["items"][0]["assignment_id"]


async def _ready_assignment(client) -> str:
    await publish_seed_course(client)
    await login(client, "usr_linxiaomei")
    assignment_id = await _assignment_id(client)
    for key in ("ch1", "ch2", "ch3"):
        response = await client.post(
            f"/api/v1/staff/assignments/{assignment_id}/chapters/{key}/complete",
            json={},
        )
        assert response.status_code == 200, response.text
    return assignment_id


async def _create_session(client, assignment_id: str, expected: int = 201) -> dict:
    response = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-sessions",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == expected, response.text
    return response.json()


def _round_payload(client_round_id: str, answer: str, variant: str = "default") -> dict:
    return {
        "client_round_id": client_round_id,
        "answer_text": answer,
        "question_variant": variant,
    }


async def test_session_requires_chapters_and_is_idempotent(client, app):
    await publish_seed_course(client)
    await login(client, "usr_linxiaomei")
    assignment_id = await _assignment_id(client)

    denied = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-sessions",
        headers={"Content-Type": "application/json"},
    )
    assert denied.status_code == 409
    assert denied.json()["error"]["code"] == "CHAPTERS_INCOMPLETE"
    assert denied.json()["error"]["details"]["missing_chapters"] == [
        "ch1",
        "ch2",
        "ch3",
    ]

    for key in ("ch1", "ch2", "ch3"):
        assert (
            await client.post(
                f"/api/v1/staff/assignments/{assignment_id}/chapters/{key}/complete",
                json={},
            )
        ).status_code == 200

    created = await _create_session(client, assignment_id)
    assert created["session"]["last_round_no"] == 0
    assert created["persona"]["name"] == "潮流学生 · 小雨"
    assert created["persona"]["style"] == "student"
    assert created["persona"]["alt_question"]

    async with app.state.db.sessionmaker() as session:
        roleplay_session = await session.get(
            RoleplaySession, created["session"]["id"]
        )
    assert roleplay_session.assignment_id == assignment_id
    assert roleplay_session.course_version_id == COURSE_VERSION_ID
    assert roleplay_session.rubric_version_id == RUBRIC_VERSION_ID

    again = await _create_session(client, assignment_id, expected=200)
    assert again["session"]["id"] == created["session"]["id"]
    assert again["session"]["last_round_no"] == 0


async def test_preview_scores_without_persisting(client, app):
    await publish_seed_course(client)
    await login(client, "usr_linxiaomei")
    assignment_id = await _assignment_id(client)

    preview = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
        json={"answer_text": CORRECT, "question_variant": "default"},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["preview"] is True
    assert body["persisted"] is False
    assert body["total"] == 99
    assert body["passed"] is True
    assert body["threshold"] == 85
    assert [dim["score"] for dim in body["dims"]] == [99, 98, 99, 98]
    assert body["missed_required_facts"] == []
    assert body["redline_hits"] == []
    assert body["demo_pitch"]

    alt = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
        json={"answer_text": SYNONYM, "question_variant": "alt"},
    )
    assert alt.status_code == 200
    assert alt.json()["total"] == 91

    invalid_variant = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
        json={"answer_text": CORRECT, "question_variant": "other"},
    )
    assert invalid_variant.status_code == 422
    assert invalid_variant.json()["error"]["code"] == "VALIDATION_ERROR"

    async with app.state.db.sessionmaker() as session:
        session_count = await session.scalar(
            select(func.count()).select_from(RoleplaySession)
        )
        round_count = await session.scalar(
            select(func.count()).select_from(RoleplayRound)
        )
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
        assignment = await session.get(Assignment, assignment_id)
    assert session_count == 0
    assert round_count == 0
    assert attempt_count == 0
    assert assignment.status.value == "not_started"

    await login(client, "usr_chenajie")
    forbidden = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
        json={"answer_text": CORRECT, "question_variant": "default"},
    )
    assert forbidden.status_code == 404


async def test_round_scoring_replay_and_recovery(client, app):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    invalid_id = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload("not-a-uuid", SYNONYM),
    )
    assert invalid_id.status_code == 422

    client_round_id = str(uuid4())
    payload = _round_payload(client_round_id, SYNONYM)
    scored = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert scored.status_code == 201, scored.text
    body = scored.json()
    assert body["round"]["round_no"] == 1
    assert body["round"]["status"] == "scored"
    assert body["attempt"]["total"] == 91
    assert body["attempt"]["passed"] is True
    assert [dim["score"] for dim in body["attempt"]["dims"]] == [99, 82, 99, 78]
    assert body["assignment"]["status"] == "passed"
    assert body["assignment"]["qualified_at"] is not None
    assert body["open_retrain"] is None
    assert body["replayed"] is False
    attempt_id = body["attempt"]["attempt_id"]

    replay = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert replay.status_code == 201
    assert replay.json()["replayed"] is True
    assert replay.json()["round"]["round_no"] == 1
    assert replay.json()["attempt"]["attempt_id"] == attempt_id

    again = await _create_session(client, assignment_id, expected=200)
    assert again["session"]["last_round_no"] == 1

    recovered = await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    assert recovered.status_code == 200
    rounds = recovered.json()["rounds"]
    assert len(rounds) == 1
    assert rounds[0]["status"] == "scored"
    assert rounds[0]["attempt"]["total"] == 91

    token = client.cookies.get("sk_session")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as restarted:
        restarted.cookies.set("sk_session", token)
        restored = await restarted.get(
            f"/api/v1/staff/roleplay-sessions/{session_id}"
        )
    assert restored.status_code == 200
    assert restored.json()["rounds"][0]["attempt"]["total"] == 91

    second = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), CORRECT),
    )
    assert second.status_code == 201, second.text
    assert second.json()["round"]["round_no"] == 2
    assert second.json()["attempt"]["total"] == 99

    recovered = await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    rounds = recovered.json()["rounds"]
    assert [item["round_no"] for item in rounds] == [1, 2]
    assert [item["attempt"]["total"] for item in rounds] == [91, 99]

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    assignment = detail.json()["assignment"]
    assert assignment["status"] == "passed"
    assert assignment["last_score"] == 99
    assert assignment["best_score"] == 99
    assert detail.json()["roleplay_session_id"] == session_id
    assert [item["total"] for item in detail.json()["attempts"]] == [99, 91]


async def test_round_requires_chapters(client, app):
    await publish_seed_course(client)
    await login(client, "usr_linxiaomei")
    assignment_id = await _assignment_id(client)

    async with app.state.db.sessionmaker() as session:
        session.add(
            RoleplaySession(
                id="rps_direct",
                assignment_id=assignment_id,
                course_version_id=COURSE_VERSION_ID,
                rubric_version_id=RUBRIC_VERSION_ID,
                last_round_no=0,
            )
        )
        await session.commit()

    response = await client.post(
        "/api/v1/staff/roleplay-sessions/rps_direct/rounds",
        json=_round_payload(str(uuid4()), CORRECT),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CHAPTERS_INCOMPLETE"
    assert response.json()["error"]["details"]["missing_chapters"] == [
        "ch1",
        "ch2",
        "ch3",
    ]

    async with app.state.db.sessionmaker() as session:
        round_count = await session.scalar(
            select(func.count()).select_from(RoleplayRound)
        )
    assert round_count == 0


async def test_roleplay_routes_are_scoped_and_staff_only(client):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    await login(client, "usr_chenajie")
    assert (
        await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    ).status_code == 404
    assert (
        await client.post(
            f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
            json=_round_payload(str(uuid4()), CORRECT),
        )
    ).status_code == 404
    assert (
        await client.post(
            f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
            json={"answer_text": CORRECT, "question_variant": "default"},
        )
    ).status_code == 404

    await login(client, "usr_liming")
    assert (
        await client.post(
            f"/api/v1/staff/assignments/{assignment_id}/roleplay-sessions",
            headers={"Content-Type": "application/json"},
        )
    ).status_code == 403
    assert (
        await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    ).status_code == 403


async def test_scoring_unavailable_keeps_failed_round_and_retry(client, monkeypatch):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]
    payload = _round_payload(str(uuid4()), CORRECT)

    original = roleplay_service.score_answer

    async def down(*args, **kwargs):
        _ = args, kwargs
        raise ScoringUnavailableError("provider down")

    monkeypatch.setattr(roleplay_service, "score_answer", down)
    failed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "SCORING_UNAVAILABLE"
    assert failed.json()["error"]["details"]["status"] == "failed"

    recovered = await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    round_body = recovered.json()["rounds"][0]
    assert round_body["status"] == "failed"
    assert round_body["failure_code"] == "SCORING_UNAVAILABLE"
    assert "attempt" not in round_body

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    assert detail.json()["attempts"] == []
    assert detail.json()["assignment"]["status"] == "ready_for_roleplay"

    monkeypatch.setattr(roleplay_service, "score_answer", original)
    retried = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert retried.status_code == 201, retried.text
    assert retried.json()["replayed"] is False
    assert retried.json()["attempt"]["total"] == 99
    assert retried.json()["assignment"]["status"] == "passed"


async def test_invalid_model_output_marks_round_failed(client, monkeypatch):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    async def invalid(*args, **kwargs):
        _ = args, kwargs
        raise ScoringInvalidOutputError("invalid candidate")

    monkeypatch.setattr(roleplay_service, "score_answer", invalid)
    failed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), CORRECT),
    )
    assert failed.status_code == 502
    assert failed.json()["error"]["code"] == "SCORING_INVALID_OUTPUT"

    recovered = await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    round_body = recovered.json()["rounds"][0]
    assert round_body["status"] == "failed"
    assert round_body["failure_code"] == "SCORING_INVALID_OUTPUT"


async def test_scoring_timeout_marks_round_failed(client, monkeypatch):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    async def slow(*args, **kwargs):
        _ = args, kwargs
        await asyncio.sleep(0.05)
        raise AssertionError("timeout should cancel the scorer")

    monkeypatch.setattr(roleplay_service, "score_answer", slow)
    monkeypatch.setattr(roleplay_service, "SCORING_TIMEOUT_SECONDS", 0.001)
    failed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), CORRECT),
    )
    assert failed.status_code == 503
    assert failed.json()["error"]["code"] == "SCORING_UNAVAILABLE"

    recovered = await client.get(f"/api/v1/staff/roleplay-sessions/{session_id}")
    assert recovered.json()["rounds"][0]["status"] == "failed"
    assert recovered.json()["rounds"][0]["failure_code"] == "SCORING_UNAVAILABLE"


async def test_scoring_in_progress_conflict(client, app):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]
    client_round_id = str(uuid4())

    async with app.state.db.sessionmaker() as session:
        roleplay_session = await session.scalar(
            select(RoleplaySession).where(
                RoleplaySession.assignment_id == assignment_id
            )
        )
        roleplay_session.last_round_no = 1
        session.add(
            RoleplayRound(
                id="rnd_in_progress",
                session_id=roleplay_session.id,
                round_no=1,
                client_round_id=client_round_id,
                question_variant=QuestionVariant.default,
                question_text="问题",
                answer_text="作答",
                answer_source=AnswerSource.text,
                status=RoundStatus.scoring,
                submitted_at=utcnow(),
            )
        )
        await session.commit()

    response = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(client_round_id, CORRECT),
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SCORING_IN_PROGRESS"
    assert response.json()["error"]["details"]["status"] == "scoring"
    assert response.json()["error"]["details"]["retry_after_seconds"] >= 1

    async with app.state.db.sessionmaker() as session:
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
    assert attempt_count == 0


async def test_stale_scoring_round_is_reclaimed(client, app):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]
    client_round_id = str(uuid4())
    stale_at = utcnow() - timedelta(
        seconds=roleplay_service.SCORING_LEASE_SECONDS + 1
    )

    async with app.state.db.sessionmaker() as session:
        roleplay_session = await session.scalar(
            select(RoleplaySession).where(
                RoleplaySession.assignment_id == assignment_id
            )
        )
        roleplay_session.last_round_no = 1
        session.add(
            RoleplayRound(
                id="rnd_stale_scoring",
                session_id=roleplay_session.id,
                round_no=1,
                client_round_id=client_round_id,
                question_variant=QuestionVariant.default,
                question_text="问题",
                answer_text=CORRECT,
                answer_source=AnswerSource.text,
                status=RoundStatus.scoring,
                submitted_at=stale_at,
                scoring_started_at=stale_at,
            )
        )
        await session.commit()

    payload = _round_payload(client_round_id, CORRECT)
    recovered = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert recovered.status_code == 201, recovered.text
    body = recovered.json()
    assert body["replayed"] is False
    assert body["round"]["round_no"] == 1
    assert body["round"]["status"] == "scored"
    assert body["attempt"]["total"] == 99
    attempt_id = body["attempt"]["attempt_id"]

    async with app.state.db.sessionmaker() as session:
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
        roleplay_round = await session.get(RoleplayRound, "rnd_stale_scoring")
    assert attempt_count == 1
    assert roleplay_round.status is RoundStatus.scored

    replay = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert replay.status_code == 201
    assert replay.json()["replayed"] is True
    assert replay.json()["attempt"]["attempt_id"] == attempt_id


@pytest.mark.parametrize("mode", ["failure", "success"])
async def test_stale_claim_cannot_write_after_takeover(
    client, app, monkeypatch, mode
):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]
    client_round_id = str(uuid4())
    payload = _round_payload(client_round_id, CORRECT)
    started = asyncio.Event()
    release = asyncio.Event()
    original = roleplay_service.score_answer

    async def blocked_score(*args, **kwargs):
        started.set()
        await release.wait()
        if mode == "failure":
            raise ScoringUnavailableError("late failure")
        return await original(*args, **kwargs)

    monkeypatch.setattr(roleplay_service, "score_answer", blocked_score)
    request = asyncio.create_task(
        client.post(
            f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
            json=payload,
        )
    )
    try:
        await asyncio.wait_for(started.wait(), timeout=3)
        async with app.state.db.sessionmaker() as session:
            roleplay_round = await session.scalar(
                select(RoleplayRound).where(
                    RoleplayRound.client_round_id == client_round_id
                )
            )
            # 模拟租约到期后新请求接管；旧请求仍持有原来的认领时间。
            roleplay_round.scoring_started_at = utcnow() + timedelta(seconds=5)
            await session.commit()
    finally:
        release.set()

    stale = await request
    assert stale.status_code == 409, stale.text
    assert stale.json()["error"]["code"] == "SCORING_IN_PROGRESS"

    async with app.state.db.sessionmaker() as session:
        roleplay_round = await session.scalar(
            select(RoleplayRound).where(
                RoleplayRound.client_round_id == client_round_id
            )
        )
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
    assert roleplay_round.status is RoundStatus.scoring
    assert attempt_count == 0

    monkeypatch.setattr(roleplay_service, "score_answer", original)
    async with app.state.db.sessionmaker() as session:
        roleplay_round = await session.scalar(
            select(RoleplayRound).where(
                RoleplayRound.client_round_id == client_round_id
            )
        )
        roleplay_round.scoring_started_at = utcnow() - timedelta(seconds=31)
        await session.commit()

    resumed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert resumed.status_code == 201, resumed.text
    assert resumed.json()["attempt"]["total"] == 99
    async with app.state.db.sessionmaker() as session:
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
    assert attempt_count == 1


async def test_incompatible_rubric_returns_defined_errors(client, app):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    async with app.state.db.sessionmaker() as session:
        rubric = await session.get(RubricVersion, RUBRIC_VERSION_ID)
        rubric.rules = incompatible_rubric()
        await session.commit()

    preview = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/roleplay-preview",
        json={"answer_text": CORRECT, "question_variant": "default"},
    )
    assert preview.status_code == 422
    assert preview.json()["error"]["code"] == "VALIDATION_ERROR"
    assert any(
        "M1 四维" in field["msg"]
        for field in preview.json()["error"]["details"]["fields"]
    )

    payload = _round_payload(str(uuid4()), CORRECT)
    formal = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=payload,
    )
    assert formal.status_code == 422
    error = formal.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["status"] == "failed"

    async with app.state.db.sessionmaker() as session:
        roleplay_round = await session.scalar(
            select(RoleplayRound).where(
                RoleplayRound.client_round_id == payload["client_round_id"]
            )
        )
        attempt_count = await session.scalar(
            select(func.count()).select_from(RoleplayAttempt)
        )
    assert roleplay_round.status is RoundStatus.failed
    assert roleplay_round.failure_code == "RUBRIC_INCOMPATIBLE"
    assert attempt_count == 0

    recovered = await client.get(
        f"/api/v1/staff/roleplay-sessions/{session_id}"
    )
    round_body = next(
        item
        for item in recovered.json()["rounds"]
        if item["client_round_id"] == payload["client_round_id"]
    )
    assert round_body["status"] == "failed"
    assert round_body["failure_code"] == "RUBRIC_INCOMPATIBLE"
    assert "attempt" not in round_body


async def test_retrain_advances_to_review_and_freezes(client, app):
    assignment_id = await _ready_assignment(client)
    created = await _create_session(client, assignment_id)
    session_id = created["session"]["id"]

    async with app.state.db.sessionmaker() as session:
        assignment = await session.get(Assignment, assignment_id)
        retrain = Retrain(
            assignment_id=assignment_id,
            release_id=assignment.release_id,
            focus_fact_key="fact_box_rule",
            focus_fact_label="端盒 6 个不重复",
            status=RetrainStatus.pending,
            baseline_round_no=0,
            issued_by="usr_liming",
            version=1,
        )
        session.add(retrain)
        await session.commit()
        retrain_id = retrain.id

    failed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), FACTUAL_ERROR),
    )
    assert failed.status_code == 201, failed.text
    assert failed.json()["attempt"]["total"] == 69
    assert failed.json()["assignment"]["status"] == "retrain_unfixed"
    assert failed.json()["open_retrain"]["status"] == "submitted_unfixed"

    async with app.state.db.sessionmaker() as session:
        retrain = await session.get(Retrain, retrain_id)
    assert retrain.status is RetrainStatus.submitted_unfixed
    assert retrain.version == 2
    assert retrain.evidence_round_no == 1
    assert retrain.evidence_attempt_id is None

    passed = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), CORRECT),
    )
    assert passed.status_code == 201, passed.text
    assert passed.json()["attempt"]["total"] == 99
    assert passed.json()["assignment"]["status"] == "pending_review"
    assert passed.json()["assignment"]["qualified_at"] is not None
    assert passed.json()["open_retrain"]["status"] == "fixed_pending_review"

    async with app.state.db.sessionmaker() as session:
        retrain = await session.get(Retrain, retrain_id)
    assert retrain.status is RetrainStatus.fixed_pending_review
    assert retrain.version == 3
    assert retrain.evidence_round_no == 2
    assert retrain.evidence_attempt_id == passed.json()["attempt"]["attempt_id"]

    frozen = await client.post(
        f"/api/v1/staff/roleplay-sessions/{session_id}/rounds",
        json=_round_payload(str(uuid4()), FACTUAL_ERROR),
    )
    assert frozen.status_code == 201, frozen.text
    assert frozen.json()["assignment"]["status"] == "pending_review"
    assert frozen.json()["open_retrain"]["status"] == "fixed_pending_review"

    async with app.state.db.sessionmaker() as session:
        retrain = await session.get(Retrain, retrain_id)
    assert retrain.status is RetrainStatus.fixed_pending_review
    assert retrain.version == 3
    assert retrain.evidence_attempt_id == passed.json()["attempt"]["attempt_id"]