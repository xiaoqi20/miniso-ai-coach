from datetime import UTC, datetime

from sqlalchemy import select

from app.models import (
    AnswerSource,
    Assignment,
    ChapterProgress,
    QuestionVariant,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    RoleplaySession,
    RoundStatus,
)
from app.models.base import utcnow
from app.seed_data import COURSE_VERSION_ID, RUBRIC_VERSION_ID
from tests.conftest import login
from tests.helpers import publish_seed_course, publish_version


async def _staff_assignment(client, user_id: str) -> dict:
    await login(client, user_id)
    listing = await client.get("/api/v1/staff/assignments")
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert items
    return items[0]


async def test_staff_assignment_list_detail_and_attempts(client, app):
    release = await publish_seed_course(client)
    item = await _staff_assignment(client, "usr_linxiaomei")
    assignment_id = item["assignment_id"]

    assert item["release_id"] == release["id"]
    assert item["store"] == {"id": "store_bj", "name": "北京路旗舰店"}
    assert item["course"]["chapter_count"] == 3
    assert item["status"] == "not_started"
    assert item["completed_chapters"] == []
    assert item["open_retrain"] is None

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["assignment"]["assignment_id"] == assignment_id
    assert body["assignment"]["required_chapters"] == 3
    assert body["course_version"]["id"] == COURSE_VERSION_ID
    assert body["progress"] == {
        "completed_chapters": [],
        "chapter_completed_at": {},
    }
    assert body["attempts"] == []
    assert body["roleplay_session_id"] is None

    now = utcnow()
    async with app.state.db.sessionmaker() as session:
        session.add(
            RoleplaySession(
                id="rps_learning_test",
                assignment_id=assignment_id,
                course_version_id=COURSE_VERSION_ID,
                rubric_version_id=RUBRIC_VERSION_ID,
                last_round_no=1,
            )
        )
        session.add(
            RoleplayRound(
                id="rnd_learning_test",
                session_id="rps_learning_test",
                round_no=1,
                client_round_id="11111111-1111-1111-1111-111111111111",
                question_variant=QuestionVariant.default,
                question_text="这个挂件盲盒一个就要 59 块，万一抽不到乌萨奇岂不是亏了？",
                answer_text="这款是正版联名授权，端盒 6 个不重复。",
                answer_source=AnswerSource.text,
                status=RoundStatus.scored,
                submitted_at=now,
                scored_at=now,
            )
        )
        session.add(
            RoleplayAttempt(
                id="att_learning_test",
                round_id="rnd_learning_test",
                assignment_id=assignment_id,
                release_id=release["id"],
                rubric_version_id=RUBRIC_VERSION_ID,
                total=65,
                passed=False,
                dims=[],
                fact_checks=[],
                missed_required_facts=[
                    {"key": "fact_box_rule", "label": "端盒 6 个不重复"}
                ],
                missed_facts=[],
                redline_hits=[],
                evidence={},
                computed_at=now,
            )
        )
        await session.commit()

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    body = detail.json()
    assert body["roleplay_session_id"] == "rps_learning_test"
    assert len(body["attempts"]) == 1
    attempt = body["attempts"][0]
    assert attempt["attempt_id"] == "att_learning_test"
    assert attempt["round_no"] == 1
    assert attempt["total"] == 65
    assert attempt["passed"] is False
    assert attempt["missed_required_facts"] == [
        {"key": "fact_box_rule", "label": "端盒 6 个不重复"}
    ]
    assert attempt["redline_hits"] == []


async def test_chapter_completion_is_idempotent_and_derives_status(client):
    await login(client, "usr_linxiaomei")
    assert (await client.get("/api/v1/staff/assignments")).json()["items"] == []

    await publish_seed_course(client)
    item = await _staff_assignment(client, "usr_linxiaomei")
    assignment_id = item["assignment_id"]

    first = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch1/complete",
        json={},
    )
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["chapter_key"] == "ch1"
    assert first_body["already_completed"] is False
    assert first_body["completed_chapter_count"] == 1
    assert first_body["required_chapters"] == 3
    assert first_body["assignment_status"] == "learning"
    assert first_body["state_version"] == 2

    repeated = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch1/complete",
        json={},
    )
    repeated_body = repeated.json()
    assert repeated_body["already_completed"] is True
    assert repeated_body["completed_at"] == first_body["completed_at"]
    assert repeated_body["state_version"] == first_body["state_version"]

    second = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch2/complete",
        json={},
    )
    assert second.json()["completed_chapter_count"] == 2
    assert second.json()["assignment_status"] == "learning"

    third = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch3/complete",
        json={},
    )
    assert third.json()["completed_chapter_count"] == 3
    assert third.json()["assignment_status"] == "ready_for_roleplay"
    assert third.json()["state_version"] == 4

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    body = detail.json()
    assert body["assignment"]["status"] == "ready_for_roleplay"
    assert body["assignment"]["completed_chapters"] == ["ch1", "ch2", "ch3"]
    assert body["progress"]["completed_chapters"] == ["ch1", "ch2", "ch3"]
    assert set(body["progress"]["chapter_completed_at"]) == {"ch1", "ch2", "ch3"}

    unknown = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch_missing/complete",
        json={},
    )
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "UNKNOWN_CHAPTER"

    await login(client, "usr_chenajie")
    forbidden = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch1/complete",
        json={},
    )
    assert forbidden.status_code == 404
    assert forbidden.json()["error"]["code"] == "NOT_FOUND"


async def test_chapter_completion_uses_persisted_millisecond_time(
    client, app, monkeypatch
):
    fixed = datetime(2026, 11, 24, 9, 35, 0, 123900, tzinfo=UTC)
    monkeypatch.setattr("app.services.learning.utcnow", lambda: fixed)
    await publish_seed_course(client)
    item = await _staff_assignment(client, "usr_linxiaomei")
    assignment_id = item["assignment_id"]

    first = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch1/complete",
        json={},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["completed_at"] == "2026-11-24T09:35:00.123Z"

    repeated = await client.post(
        f"/api/v1/staff/assignments/{assignment_id}/chapters/ch1/complete",
        json={},
    )
    assert repeated.json()["completed_at"] == body["completed_at"]
    assert repeated.json()["already_completed"] is True
    assert repeated.json()["state_version"] == body["state_version"]

    detail = await client.get(f"/api/v1/staff/assignments/{assignment_id}")
    assert detail.json()["progress"]["chapter_completed_at"]["ch1"] == body[
        "completed_at"
    ]

    async with app.state.db.sessionmaker() as session:
        progress = await session.scalar(
            select(ChapterProgress).where(
                ChapterProgress.assignment_id == assignment_id,
                ChapterProgress.chapter_key == "ch1",
            )
        )
    assert progress.completed_at.microsecond == 123000


async def test_staff_scope_and_draft_isolation(client):
    release = await publish_seed_course(client)

    lin_item = await _staff_assignment(client, "usr_linxiaomei")
    await login(client, "usr_zhoulin")
    assert (await client.get("/api/v1/staff/assignments")).json()["items"] == []
    forbidden = await client.get(
        f"/api/v1/staff/assignments/{lin_item['assignment_id']}"
    )
    assert forbidden.status_code == 404

    await login(client, "usr_chenajie")
    other_user = await client.get(
        f"/api/v1/staff/assignments/{lin_item['assignment_id']}"
    )
    assert other_user.status_code == 404

    # 佛山员工没有北京批次的任务；批次本身仍可由总部读取。
    assert release["targets"][0]["store_id"] == "store_bj"


async def test_open_retrain_priority_in_staff_list(client, app):
    first = await publish_seed_course(client)
    second = await publish_version(client, key="second-publish")
    assert second.status_code == 201, second.text
    second_release = second.json()["release"]

    async with app.state.db.sessionmaker() as session:
        assignment = await session.scalar(
            select(Assignment).where(
                Assignment.release_id == second_release["id"],
                Assignment.user_id == "usr_linxiaomei",
            )
        )
        session.add(
            Retrain(
                assignment_id=assignment.id,
                release_id=second_release["id"],
                focus_fact_key="fact_box_rule",
                focus_fact_label="端盒 6 个不重复",
                status=RetrainStatus.pending,
                baseline_round_no=0,
                issued_by="usr_liming",
                version=1,
            )
        )
        await session.commit()

    await login(client, "usr_linxiaomei")
    items = (await client.get("/api/v1/staff/assignments")).json()["items"]
    assert len(items) == 2
    assert items[0]["release_id"] == second_release["id"]
    assert items[0]["open_retrain"] is not None
    assert items[0]["open_retrain"]["focus"] == {
        "fact_key": "fact_box_rule",
        "label": "端盒 6 个不重复",
    }
    assert items[1]["release_id"] == first["id"]
    assert items[1]["open_retrain"] is None