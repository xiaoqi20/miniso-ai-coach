"""员工学习、章节进度与任务状态派生。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ApiError
from app.models import (
    Assignment,
    AssignmentStatus,
    ChapterProgress,
    CourseVersion,
    Release,
    ReleaseStatus,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    User,
)
from app.models.base import new_id, utcnow
from app.security import iso_utc
from app.services.common import (
    chapter_keys,
    iso_or_none,
    open_retrain_for,
    open_retrain_payload,
    page_items,
)


def derive_assignment_status(
    *,
    completed_chapter_count: int,
    required_chapters: int,
    has_attempt: bool,
    qualified_at: datetime | None,
    retrains: list[Retrain],
) -> AssignmentStatus:
    """按 M1 §5.1 的优先级派生任务状态。"""
    open_retrain = open_retrain_for(retrains)
    if open_retrain is not None:
        return {
            RetrainStatus.pending: AssignmentStatus.retrain_pending,
            RetrainStatus.submitted_unfixed: AssignmentStatus.retrain_unfixed,
            RetrainStatus.fixed_pending_review: AssignmentStatus.pending_review,
        }[open_retrain.status]

    if retrains:
        latest = max(retrains, key=lambda item: (item.issued_at, item.id))
        if latest.status is RetrainStatus.verified:
            return AssignmentStatus.verified

    if qualified_at is not None:
        return AssignmentStatus.passed
    if has_attempt:
        return AssignmentStatus.failed
    if required_chapters > 0 and completed_chapter_count >= required_chapters:
        return AssignmentStatus.ready_for_roleplay
    if completed_chapter_count > 0:
        return AssignmentStatus.learning
    return AssignmentStatus.not_started


async def _status_inputs(
    session: AsyncSession, assignment_id: str
) -> tuple[bool, list[Retrain]]:
    has_attempt = bool(
        await session.scalar(
            select(exists().where(RoleplayAttempt.assignment_id == assignment_id))
        )
    )
    retrains = list(
        (
            await session.scalars(
                select(Retrain)
                .where(Retrain.assignment_id == assignment_id)
                .order_by(Retrain.issued_at, Retrain.id)
            )
        ).all()
    )
    return has_attempt, retrains


def _progress_payload(assignment: Assignment) -> tuple[list[str], dict[str, str]]:
    progress = sorted(
        assignment.chapter_progress,
        key=lambda item: (item.completed_at, item.chapter_key),
    )
    completed = [item.chapter_key for item in progress]
    completed_at = {item.chapter_key: iso_utc(item.completed_at) for item in progress}
    return completed, completed_at


def _assignment_list_item(assignment: Assignment) -> dict[str, Any]:
    release = assignment.release
    version = release.course_version
    content = version.content
    chapters = chapter_keys(content)
    product = content.get("product", {}) if isinstance(content, dict) else {}
    completed, _ = _progress_payload(assignment)
    open_retrain = open_retrain_for(assignment.retrains)
    return {
        "assignment_id": assignment.id,
        "release_id": assignment.release_id,
        "store": {"id": assignment.store.id, "name": assignment.store.name},
        "course": {
            "id": version.course.id,
            "name": version.course.name,
            "tag": product.get("tag"),
            "price": product.get("price"),
            "chapter_count": len(chapters),
        },
        "published_at": iso_utc(release.published_at),
        "deadline_at": iso_utc(release.deadline_at),
        "status": assignment.status.value,
        "completed_chapters": completed,
        "completed_chapter_count": assignment.completed_chapter_count,
        "required_chapters": len(chapters),
        "last_score": assignment.last_score,
        "best_score": assignment.best_score,
        "qualified_at": iso_or_none(assignment.qualified_at),
        "open_retrain": open_retrain_payload(open_retrain),
        "state_version": assignment.state_version,
    }


async def list_staff_assignments(
    session: AsyncSession,
    user: User,
    *,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    assignments = list(
        (
            await session.scalars(
                select(Assignment)
                .join(Release, Assignment.release_id == Release.id)
                .where(
                    Assignment.user_id == user.id,
                    Release.status == ReleaseStatus.published,
                )
                .options(
                    selectinload(Assignment.release)
                    .selectinload(Release.course_version)
                    .selectinload(CourseVersion.course),
                    selectinload(Assignment.store),
                    selectinload(Assignment.chapter_progress),
                    selectinload(Assignment.retrains),
                )
            )
        ).all()
    )
    # 有进行中补训的任务优先，其次按截止时间和发布时间。
    assignments.sort(
        key=lambda assignment: (
            0 if open_retrain_for(assignment.retrains) else 1,
            assignment.release.deadline_at,
            assignment.release.published_at,
            assignment.id,
        )
    )
    window, next_cursor = page_items(assignments, limit, offset)
    return {
        "items": [_assignment_list_item(assignment) for assignment in window],
        "next_cursor": next_cursor,
    }


async def get_staff_assignment(
    session: AsyncSession,
    user: User,
    assignment_id: str,
) -> dict[str, Any]:
    assignment = await session.scalar(
        select(Assignment)
        .join(Release, Assignment.release_id == Release.id)
        .where(
            Assignment.id == assignment_id,
            Assignment.user_id == user.id,
            Release.status == ReleaseStatus.published,
        )
        .options(
            selectinload(Assignment.release).selectinload(Release.course_version),
            selectinload(Assignment.chapter_progress),
            selectinload(Assignment.retrains),
            selectinload(Assignment.roleplay_session),
        )
    )
    if assignment is None:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")

    version = assignment.release.course_version
    chapters = chapter_keys(version.content)
    completed, completed_at = _progress_payload(assignment)
    open_retrain = open_retrain_for(assignment.retrains)

    attempts = list(
        (
            await session.scalars(
                select(RoleplayAttempt)
                .join(RoleplayRound, RoleplayAttempt.round_id == RoleplayRound.id)
                .where(RoleplayAttempt.assignment_id == assignment.id)
                .options(selectinload(RoleplayAttempt.round))
                .order_by(RoleplayRound.round_no.desc())
                .limit(10)
            )
        ).all()
    )

    return {
        "assignment": {
            "assignment_id": assignment.id,
            "release_id": assignment.release_id,
            "status": assignment.status.value,
            "completed_chapters": completed,
            "required_chapters": len(chapters),
            "last_score": assignment.last_score,
            "best_score": assignment.best_score,
            "qualified_at": iso_or_none(assignment.qualified_at),
            "state_version": assignment.state_version,
            "deadline_at": iso_utc(assignment.release.deadline_at),
        },
        "course_version": {
            "id": version.id,
            "version_no": version.version_no,
            "content": version.content,
        },
        "progress": {
            "completed_chapters": completed,
            "chapter_completed_at": completed_at,
        },
        "attempts": [
            {
                "attempt_id": attempt.id,
                "round_no": attempt.round.round_no,
                "total": attempt.total,
                "passed": attempt.passed,
                "missed_required_facts": attempt.missed_required_facts,
                "redline_hits": attempt.redline_hits,
                "computed_at": iso_utc(attempt.computed_at),
            }
            for attempt in attempts
        ],
        "open_retrain": open_retrain_payload(open_retrain),
        "roleplay_session_id": assignment.roleplay_session.id
        if assignment.roleplay_session
        else None,
    }


async def complete_chapter(
    session: AsyncSession,
    user: User,
    assignment_id: str,
    chapter_key: str,
) -> dict[str, Any]:
    async with session.begin():
        assignment = await session.scalar(
            select(Assignment)
            .where(
                Assignment.id == assignment_id,
                Assignment.user_id == user.id,
            )
            .with_for_update()
        )
        if assignment is None:
            raise ApiError(404, "NOT_FOUND", "学习任务不存在")

        release = await session.get(Release, assignment.release_id)
        if release is None or release.status is not ReleaseStatus.published:
            raise ApiError(404, "NOT_FOUND", "学习任务不存在")
        version = await session.get(CourseVersion, release.course_version_id)
        if version is None:
            raise ApiError(404, "NOT_FOUND", "课程版本不存在")

        chapters = chapter_keys(version.content)
        if chapter_key not in chapters:
            raise ApiError(
                422,
                "UNKNOWN_CHAPTER",
                "章节键不属于当前课程版本",
                {"chapter_key": chapter_key},
            )

        existing = await session.scalar(
            select(ChapterProgress).where(
                ChapterProgress.assignment_id == assignment.id,
                ChapterProgress.chapter_key == chapter_key,
            )
        )
        if existing is not None:
            return {
                "chapter_key": chapter_key,
                "completed_at": iso_utc(existing.completed_at),
                "already_completed": True,
                "completed_chapter_count": assignment.completed_chapter_count,
                "required_chapters": len(chapters),
                "assignment_status": assignment.status.value,
                "state_version": assignment.state_version,
            }

        now = utcnow()
        progress = ChapterProgress(
            id=new_id("chp"),
            assignment_id=assignment.id,
            chapter_key=chapter_key,
            completed_at=now,
        )
        session.add(progress)
        assignment.completed_chapter_count += 1
        has_attempt, retrains = await _status_inputs(session, assignment.id)
        assignment.status = derive_assignment_status(
            completed_chapter_count=assignment.completed_chapter_count,
            required_chapters=len(chapters),
            has_attempt=has_attempt,
            qualified_at=assignment.qualified_at,
            retrains=retrains,
        )
        assignment.state_version += 1
        assignment.updated_at = now

    return {
        "chapter_key": chapter_key,
        "completed_at": iso_utc(now),
        "already_completed": False,
        "completed_chapter_count": assignment.completed_chapter_count,
        "required_chapters": len(chapters),
        "assignment_status": assignment.status.value,
        "state_version": assignment.state_version,
    }