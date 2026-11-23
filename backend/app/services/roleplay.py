"""对练会话、轮次、预览和正式成绩落库。"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ApiError
from app.models import (
    AnswerSource,
    Assignment,
    ChapterProgress,
    CourseVersion,
    QuestionVariant,
    Release,
    ReleaseStatus,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    RoleplaySession,
    RoundStatus,
    RubricVersion,
    User,
)
from app.models.base import new_id, utcnow
from app.schemas.roleplay import RoleplayPreviewRequest, RoleplayRoundRequest
from app.security import iso_utc
from app.services.common import (
    chapter_keys,
    ensure_rubric_compatible,
    iso_or_none,
    open_retrain_for,
    open_retrain_payload,
)
from app.services.learning import derive_assignment_status
from app.services.roleplay_scoring import (
    DIMENSION_ORDER,
    ScoringInvalidOutputError,
    ScoringResult,
    ScoringUnavailableError,
    score_answer,
)

SCORING_TIMEOUT_SECONDS = 10
# 必须大于评分超时，确保正常执行的请求不会被另一个重试提前认领。
SCORING_LEASE_SECONDS = 30


async def _score_with_timeout(
    rubric: dict[str, Any],
    question_variant: str,
    answer_text: str,
) -> ScoringResult:
    try:
        return await asyncio.wait_for(
            score_answer(rubric, question_variant, answer_text),
            timeout=SCORING_TIMEOUT_SECONDS,
        )
    except TimeoutError as exc:
        raise ScoringUnavailableError("scoring timeout") from exc


@dataclass
class _RoundWork:
    round_id: str
    round_no: int
    client_round_id: str
    question_variant: str
    question_text: str
    answer_text: str
    session_id: str
    assignment_id: str
    release_id: str
    rubric_version_id: str
    required_chapters: int
    rubric_rules: dict[str, Any]
    replayed: bool


async def _load_assignment(
    session: AsyncSession,
    user: User,
    assignment_id: str,
    *,
    lock: bool = False,
):
    stmt = select(Assignment).where(
        Assignment.id == assignment_id,
        Assignment.user_id == user.id,
    )
    if lock:
        stmt = stmt.with_for_update()
    assignment = await session.scalar(stmt)
    if assignment is None:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")
    return assignment


async def _load_release_context(
    session: AsyncSession, assignment: Assignment
) -> tuple[Release, CourseVersion, RubricVersion]:
    release = await session.get(Release, assignment.release_id)
    if release is None or release.status is not ReleaseStatus.published:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")
    version = await session.get(CourseVersion, release.course_version_id)
    rubric = await session.get(RubricVersion, release.rubric_version_id)
    if version is None or rubric is None:
        raise ApiError(500, "INTERNAL_ERROR", "发布批次缺少课程或评分规则")
    return release, version, rubric


async def _missing_chapters(
    session: AsyncSession, assignment_id: str, content: dict[str, Any]
) -> list[str]:
    required = chapter_keys(content)
    completed = set(
        (
            await session.scalars(
                select(ChapterProgress.chapter_key).where(
                    ChapterProgress.assignment_id == assignment_id
                )
            )
        ).all()
    )
    return [key for key in required if key not in completed]


def _question_text(rubric: RubricVersion, variant: str) -> str:
    scenario = rubric.rules.get("scenario", {})
    key = "alt_question" if variant == "alt" else "question"
    text = str(scenario.get(key, "")).strip()
    if not text:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "问题变体不存在",
            {
                "fields": [
                    {
                        "loc": ["body", "question_variant"],
                        "msg": "问题变体不存在",
                        "type": "value_error",
                    }
                ]
            },
        )
    return text


def _session_payload(
    roleplay_session: RoleplaySession, rubric: RubricVersion
) -> dict[str, Any]:
    scenario = rubric.rules.get("scenario", {})
    return {
        "session": {
            "id": roleplay_session.id,
            "assignment_id": roleplay_session.assignment_id,
            "last_round_no": roleplay_session.last_round_no,
            "created_at": iso_utc(roleplay_session.created_at),
            "updated_at": iso_utc(roleplay_session.updated_at),
        },
        "persona": {
            "name": str(scenario.get("persona_name", "")),
            "style": str(scenario.get("persona_style", "")),
            "question": str(scenario.get("question", "")),
            "alt_question": str(scenario.get("alt_question", "")),
        },
    }


async def create_or_get_session(
    session: AsyncSession,
    user: User,
    assignment_id: str,
) -> tuple[dict[str, Any], int]:
    now = utcnow()
    async with session.begin():
        assignment = await _load_assignment(session, user, assignment_id, lock=True)
        _release, version, rubric = await _load_release_context(session, assignment)
        missing = await _missing_chapters(session, assignment.id, version.content)
        if missing:
            raise ApiError(
                409,
                "CHAPTERS_INCOMPLETE",
                "请先完成全部课程章节再开始正式对练",
                {"missing_chapters": missing},
            )
        existing = await session.scalar(
            select(RoleplaySession).where(
                RoleplaySession.assignment_id == assignment.id
            )
        )
        if existing is not None:
            return _session_payload(existing, rubric), 200

        roleplay_session = RoleplaySession(
            id=new_id("rps"),
            assignment_id=assignment.id,
            course_version_id=version.id,
            rubric_version_id=rubric.id,
            last_round_no=0,
            created_at=now,
            updated_at=now,
        )
        session.add(roleplay_session)
        return _session_payload(roleplay_session, rubric), 201


async def preview_answer(
    session: AsyncSession,
    user: User,
    assignment_id: str,
    body: RoleplayPreviewRequest,
) -> dict[str, Any]:
    assignment = await _load_assignment(session, user, assignment_id)
    _release, _version, rubric = await _load_release_context(session, assignment)
    ensure_rubric_compatible(rubric.rules)
    _question_text(rubric, body.question_variant)

    # 预览只读；模型调用前结束查询事务，避免等待期间占用连接。
    if session.in_transaction():
        await session.commit()
    try:
        result = await _score_with_timeout(
            rubric.rules,
            body.question_variant,
            body.answer_text,
        )
    except ScoringUnavailableError as exc:
        raise ApiError(
            503,
            "SCORING_UNAVAILABLE",
            "评分服务暂时不可用，请稍后重试",
        ) from exc
    except ScoringInvalidOutputError as exc:
        raise ApiError(
            502,
            "SCORING_INVALID_OUTPUT",
            "评分结果未通过业务核验，请稍后重试",
        ) from exc

    return {
        "preview": True,
        "persisted": False,
        "total": result.total,
        "passed": result.passed,
        "threshold": result.threshold,
        "dims": [dim.model_dump() for dim in result.dims],
        "fact_checks": [fact.model_dump() for fact in result.fact_checks],
        "missed_required_facts": [
            fact.model_dump() for fact in result.missed_required_facts
        ],
        "redline_hits": [hit.model_dump() for hit in result.redline_hits],
        "weakest": result.weakest.model_dump(),
        "advice": result.advice,
        "demo_pitch": result.demo_pitch,
    }


async def get_session(
    session: AsyncSession,
    user: User,
    session_id: str,
) -> dict[str, Any]:
    roleplay_session = await session.scalar(
        select(RoleplaySession)
        .join(Assignment, RoleplaySession.assignment_id == Assignment.id)
        .where(
            RoleplaySession.id == session_id,
            Assignment.user_id == user.id,
        )
        .options(
            selectinload(RoleplaySession.rounds).selectinload(RoleplayRound.attempt)
        )
    )
    if roleplay_session is None:
        raise ApiError(404, "NOT_FOUND", "对练会话不存在")

    rounds = []
    for roleplay_round in sorted(
        roleplay_session.rounds, key=lambda item: item.round_no
    ):
        item = {
            "round_no": roleplay_round.round_no,
            "client_round_id": roleplay_round.client_round_id,
            "question_variant": roleplay_round.question_variant.value,
            "question_text": roleplay_round.question_text,
            "answer_text": roleplay_round.answer_text,
            "status": roleplay_round.status.value,
            "submitted_at": iso_utc(roleplay_round.submitted_at),
            "scored_at": iso_or_none(roleplay_round.scored_at),
        }
        if roleplay_round.status is RoundStatus.failed:
            item["failure_code"] = roleplay_round.failure_code
        if roleplay_round.attempt is not None:
            item["attempt"] = {
                "attempt_id": roleplay_round.attempt.id,
                "total": roleplay_round.attempt.total,
                "passed": roleplay_round.attempt.passed,
                "missed_required_facts": roleplay_round.attempt.missed_required_facts,
                "computed_at": iso_utc(roleplay_round.attempt.computed_at),
            }
        rounds.append(item)

    return {
        "session": {
            "id": roleplay_session.id,
            "assignment_id": roleplay_session.assignment_id,
            "last_round_no": roleplay_session.last_round_no,
            "created_at": iso_utc(roleplay_session.created_at),
            "updated_at": iso_utc(roleplay_session.updated_at),
        },
        "rounds": rounds,
    }


async def _prepare_round(
    session: AsyncSession,
    user: User,
    session_id: str,
    body: RoleplayRoundRequest,
) -> _RoundWork:
    async with session.begin():
        roleplay_session = await session.scalar(
            select(RoleplaySession)
            .where(RoleplaySession.id == session_id)
            .with_for_update()
        )
        if roleplay_session is None:
            raise ApiError(404, "NOT_FOUND", "对练会话不存在")

        assignment = await session.scalar(
            select(Assignment).where(
                Assignment.id == roleplay_session.assignment_id,
                Assignment.user_id == user.id,
            )
        )
        if assignment is None:
            raise ApiError(404, "NOT_FOUND", "对练会话不存在")

        _release, version, rubric = await _load_release_context(session, assignment)
        missing = await _missing_chapters(session, assignment.id, version.content)
        if missing:
            raise ApiError(
                409,
                "CHAPTERS_INCOMPLETE",
                "请先完成全部课程章节再提交正式对练",
                {"missing_chapters": missing},
            )
        required_chapters = len(chapter_keys(version.content))

        existing = await session.scalar(
            select(RoleplayRound).where(
                RoleplayRound.session_id == roleplay_session.id,
                RoleplayRound.client_round_id == body.client_round_id,
            )
        )
        if existing is not None:
            attempt = await session.scalar(
                select(RoleplayAttempt).where(
                    RoleplayAttempt.round_id == existing.id
                )
            )
            if attempt is not None:
                return _RoundWork(
                    round_id=existing.id,
                    round_no=existing.round_no,
                    client_round_id=existing.client_round_id,
                    question_variant=existing.question_variant.value,
                    question_text=existing.question_text,
                    answer_text=existing.answer_text,
                    session_id=roleplay_session.id,
                    assignment_id=assignment.id,
                    release_id=assignment.release_id,
                    rubric_version_id=rubric.id,
                    required_chapters=required_chapters,
                    rubric_rules=rubric.rules,
                    replayed=True,
                )
            if existing.status is RoundStatus.scoring:
                now = utcnow()
                lease_started = existing.scoring_started_at or existing.submitted_at
                lease_expires = lease_started + timedelta(
                    seconds=SCORING_LEASE_SECONDS
                )
                if now < lease_expires:
                    # 评分进程仍在租约内，继续返回冲突；进程退出后租约到期，
                    # 同一 client_round_id 可以安全地重新认领这一轮。
                    retry_after = max(
                        1, int((lease_expires - now).total_seconds()) + 1
                    )
                    raise ApiError(
                        409,
                        "SCORING_IN_PROGRESS",
                        "该轮次正在评分，请稍后重试",
                        {
                            "round_no": existing.round_no,
                            "client_round_id": existing.client_round_id,
                            "status": existing.status.value,
                            "retry_after_seconds": retry_after,
                        },
                    )
                existing.scoring_started_at = now
                existing.failure_code = None
                existing.scored_at = None
                roleplay_session.updated_at = now
                return _RoundWork(
                    round_id=existing.id,
                    round_no=existing.round_no,
                    client_round_id=existing.client_round_id,
                    question_variant=existing.question_variant.value,
                    question_text=existing.question_text,
                    answer_text=existing.answer_text,
                    session_id=roleplay_session.id,
                    assignment_id=assignment.id,
                    release_id=assignment.release_id,
                    rubric_version_id=rubric.id,
                    required_chapters=required_chapters,
                    rubric_rules=rubric.rules,
                    replayed=False,
                )
            if existing.status is not RoundStatus.failed:
                raise ApiError(500, "INTERNAL_ERROR", "轮次状态异常")

            now = utcnow()
            existing.status = RoundStatus.scoring
            existing.failure_code = None
            existing.scoring_started_at = now
            existing.scored_at = None
            roleplay_session.updated_at = now
            return _RoundWork(
                round_id=existing.id,
                round_no=existing.round_no,
                client_round_id=existing.client_round_id,
                question_variant=existing.question_variant.value,
                question_text=existing.question_text,
                answer_text=existing.answer_text,
                session_id=roleplay_session.id,
                assignment_id=assignment.id,
                release_id=assignment.release_id,
                rubric_version_id=rubric.id,
                required_chapters=required_chapters,
                rubric_rules=rubric.rules,
                replayed=False,
            )

        question_text = _question_text(rubric, body.question_variant)
        roleplay_session.last_round_no += 1
        now = utcnow()
        roleplay_round = RoleplayRound(
            id=new_id("rnd"),
            session_id=roleplay_session.id,
            round_no=roleplay_session.last_round_no,
            client_round_id=body.client_round_id,
            question_variant=QuestionVariant(body.question_variant),
            question_text=question_text,
            answer_text=body.answer_text,
            answer_source=AnswerSource.text,
            status=RoundStatus.scoring,
            submitted_at=now,
            scoring_started_at=now,
        )
        roleplay_session.updated_at = now
        session.add(roleplay_round)
        return _RoundWork(
            round_id=roleplay_round.id,
            round_no=roleplay_round.round_no,
            client_round_id=roleplay_round.client_round_id,
            question_variant=body.question_variant,
            question_text=question_text,
            answer_text=body.answer_text,
            session_id=roleplay_session.id,
            assignment_id=assignment.id,
            release_id=assignment.release_id,
            rubric_version_id=rubric.id,
            required_chapters=required_chapters,
            rubric_rules=rubric.rules,
            replayed=False,
        )


async def _mark_round_failed(
    session: AsyncSession, round_id: str, failure_code: str
) -> None:
    async with session.begin():
        roleplay_round = await session.scalar(
            select(RoleplayRound)
            .where(RoleplayRound.id == round_id)
            .with_for_update()
        )
        if roleplay_round is None or roleplay_round.status is not RoundStatus.scoring:
            return
        roleplay_round.status = RoundStatus.failed
        roleplay_round.failure_code = failure_code
        roleplay_round.scored_at = utcnow()


def _advance_retrain(
    retrain: Retrain,
    roleplay_round: RoleplayRound,
    attempt: RoleplayAttempt,
    result: ScoringResult,
    now,
) -> None:
    if retrain.status is RetrainStatus.fixed_pending_review:
        return
    if roleplay_round.round_no <= retrain.baseline_round_no:
        return
    if (
        retrain.evidence_round_no is not None
        and roleplay_round.round_no < retrain.evidence_round_no
    ):
        return

    if result.passed:
        retrain.status = RetrainStatus.fixed_pending_review
        retrain.evidence_round_no = roleplay_round.round_no
        retrain.evidence_attempt_id = attempt.id
    else:
        retrain.status = RetrainStatus.submitted_unfixed
        retrain.evidence_round_no = roleplay_round.round_no
        retrain.evidence_attempt_id = None
    retrain.version += 1
    retrain.updated_at = now


async def _persist_attempt(
    session: AsyncSession,
    work: _RoundWork,
    result: ScoringResult,
) -> bool:
    now = utcnow()
    async with session.begin():
        roleplay_round = await session.scalar(
            select(RoleplayRound)
            .where(RoleplayRound.id == work.round_id)
            .with_for_update()
        )
        if roleplay_round is None:
            raise ApiError(500, "INTERNAL_ERROR", "轮次不存在")
        if roleplay_round.status is RoundStatus.scored:
            return True
        if roleplay_round.status is not RoundStatus.scoring:
            raise ApiError(409, "STATE_CONFLICT", "当前轮次状态不允许写入成绩")

        assignment = await session.scalar(
            select(Assignment)
            .where(Assignment.id == work.assignment_id)
            .with_for_update()
        )
        if assignment is None:
            raise ApiError(500, "INTERNAL_ERROR", "学习任务不存在")

        attempt = RoleplayAttempt(
            id=new_id("att"),
            round_id=roleplay_round.id,
            assignment_id=assignment.id,
            release_id=work.release_id,
            rubric_version_id=work.rubric_version_id,
            total=result.total,
            passed=result.passed,
            dims=[dim.model_dump() for dim in result.dims],
            fact_checks=[fact.model_dump() for fact in result.fact_checks],
            missed_required_facts=[
                fact.model_dump() for fact in result.missed_required_facts
            ],
            missed_facts=[fact.model_dump() for fact in result.missed_facts],
            redline_hits=[hit.model_dump() for hit in result.redline_hits],
            evidence={
                "source": "deterministic_stub",
                "weakest": result.weakest.model_dump(),
                "advice": result.advice,
                "demo_pitch": result.demo_pitch,
            },
            computed_at=now,
        )
        session.add(attempt)
        roleplay_round.status = RoundStatus.scored
        roleplay_round.scored_at = now
        roleplay_round.failure_code = None

        roleplay_session = await session.get(RoleplaySession, work.session_id)
        if roleplay_session is not None:
            roleplay_session.updated_at = now

        assignment.last_score = result.total
        assignment.best_score = max(assignment.best_score or 0, result.total)
        assignment.last_attempt_at = now
        if result.passed and assignment.qualified_at is None:
            assignment.first_passed_at = now
            assignment.qualified_at = now
        assignment.state_version += 1
        assignment.updated_at = now

        retrains = list(
            (
                await session.scalars(
                    select(Retrain)
                    .where(Retrain.assignment_id == assignment.id)
                    .order_by(Retrain.issued_at, Retrain.id)
                    .with_for_update()
                )
            ).all()
        )
        open_retrain = open_retrain_for(retrains)
        if open_retrain is not None:
            _advance_retrain(open_retrain, roleplay_round, attempt, result, now)
        assignment.status = derive_assignment_status(
            completed_chapter_count=assignment.completed_chapter_count,
            required_chapters=work.required_chapters,
            has_attempt=True,
            qualified_at=assignment.qualified_at,
            retrains=retrains,
        )
    return False


def _weakest_from_dims(dims: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not dims:
        return None
    order = {key: index for index, key in enumerate(DIMENSION_ORDER)}
    return min(dims, key=lambda item: (item["score"], order.get(item["key"], 99)))


async def _round_response(
    session: AsyncSession, round_id: str, *, replayed: bool
) -> dict[str, Any]:
    roleplay_round = await session.scalar(
        select(RoleplayRound)
        .where(RoleplayRound.id == round_id)
        .options(selectinload(RoleplayRound.attempt))
    )
    if roleplay_round is None or roleplay_round.attempt is None:
        raise ApiError(500, "INTERNAL_ERROR", "轮次成绩不存在")

    roleplay_session = await session.get(
        RoleplaySession, roleplay_round.session_id
    )
    if roleplay_session is None:
        raise ApiError(500, "INTERNAL_ERROR", "对练会话不存在")
    assignment = await session.get(Assignment, roleplay_session.assignment_id)
    rubric = await session.get(RubricVersion, roleplay_round.attempt.rubric_version_id)
    if assignment is None or rubric is None:
        raise ApiError(500, "INTERNAL_ERROR", "成绩关联数据不存在")

    retrains = list(
        (
            await session.scalars(
                select(Retrain)
                .where(Retrain.assignment_id == assignment.id)
                .order_by(Retrain.issued_at, Retrain.id)
            )
        ).all()
    )
    open_retrain = open_retrain_for(retrains)
    attempt = roleplay_round.attempt
    evidence = attempt.evidence if isinstance(attempt.evidence, dict) else {}
    weakest = evidence.get("weakest") or _weakest_from_dims(attempt.dims)
    advice = evidence.get("advice") or ""
    demo_pitch = evidence.get("demo_pitch") or rubric.rules.get("demo_pitch", "")
    threshold = int(rubric.rules.get("pass_threshold", 85))

    return {
        "round": {
            "round_no": roleplay_round.round_no,
            "client_round_id": roleplay_round.client_round_id,
            "question_variant": roleplay_round.question_variant.value,
            "question_text": roleplay_round.question_text,
            "answer_text": roleplay_round.answer_text,
            "status": roleplay_round.status.value,
            "submitted_at": iso_utc(roleplay_round.submitted_at),
            "scored_at": iso_or_none(roleplay_round.scored_at),
        },
        "attempt": {
            "attempt_id": attempt.id,
            "total": attempt.total,
            "passed": attempt.passed,
            "threshold": threshold,
            "dims": attempt.dims,
            "fact_checks": attempt.fact_checks,
            "missed_required_facts": attempt.missed_required_facts,
            "missed_facts": attempt.missed_facts,
            "redline_hits": attempt.redline_hits,
            "weakest": weakest,
            "advice": advice,
            "demo_pitch": demo_pitch,
            "computed_at": iso_utc(attempt.computed_at),
        },
        "assignment": {
            "assignment_id": assignment.id,
            "status": assignment.status.value,
            "state_version": assignment.state_version,
            "qualified_at": iso_or_none(assignment.qualified_at),
        },
        "open_retrain": open_retrain_payload(open_retrain),
        "replayed": replayed,
    }


async def submit_round(
    session: AsyncSession,
    user: User,
    session_id: str,
    body: RoleplayRoundRequest,
) -> dict[str, Any]:
    work = await _prepare_round(session, user, session_id, body)
    if work.replayed:
        return await _round_response(session, work.round_id, replayed=True)

    try:
        ensure_rubric_compatible(work.rubric_rules)
    except ApiError as exc:
        # 轮次已经创建或认领；把不可评分的规则落到 failed，避免永久停在
        # scoring，同时不写任何正式成绩。
        await _mark_round_failed(
            session,
            work.round_id,
            "RUBRIC_INCOMPATIBLE",
        )
        raise ApiError(
            exc.status_code,
            exc.code,
            "评分规则不兼容，轮次已保存，请修复规则后重试",
            {
                **exc.details,
                "round_no": work.round_no,
                "client_round_id": work.client_round_id,
                "status": "failed",
            },
        ) from exc

    try:
        result = await _score_with_timeout(
            work.rubric_rules,
            work.question_variant,
            work.answer_text,
        )
    except ScoringUnavailableError as exc:
        await _mark_round_failed(
            session,
            work.round_id,
            "SCORING_UNAVAILABLE",
        )
        raise ApiError(
            503,
            "SCORING_UNAVAILABLE",
            "评分服务暂时不可用，轮次已保存，请用同一轮次重试",
            {
                "round_no": work.round_no,
                "client_round_id": work.client_round_id,
                "status": "failed",
            },
        ) from exc
    except ScoringInvalidOutputError as exc:
        await _mark_round_failed(
            session,
            work.round_id,
            "SCORING_INVALID_OUTPUT",
        )
        raise ApiError(
            502,
            "SCORING_INVALID_OUTPUT",
            "评分结果未通过业务核验，轮次已保存，请稍后重试",
            {
                "round_no": work.round_no,
                "client_round_id": work.client_round_id,
                "status": "failed",
            },
        ) from exc

    replayed = await _persist_attempt(session, work, result)
    return await _round_response(session, work.round_id, replayed=replayed)