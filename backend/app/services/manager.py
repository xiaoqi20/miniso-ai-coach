"""店长看板、补训指派、人工复查与 48 小时统计服务。

关键不变量：
- 店长读写全部按服务端会话的管辖门店过滤，越界返回 404 NOT_FOUND；
- 批次名单和 48 小时统计只读取发布时冻结的 assignments 快照与 qualified_at，
  不因成员变更、重复练习、补训或窗口外复查回写历史统计；
- 同一任务的补训写入（指派、复查、T004 复练回写）统一先获取 Assignment 主键行锁
  串行化，再使用普通读读取 retrains，避免 InnoDB REPEATABLE READ 下未命中锁定读
  引入间隙锁导致不同任务的并发首次补训死锁（Error 1213）。
"""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ApiError
from app.models import (
    Assignment,
    AssignmentStatus,
    AuditAction,
    AuditEvent,
    CourseVersion,
    Release,
    ReleaseTarget,
    Retrain,
    RetrainStatus,
    RoleplayAttempt,
    RoleplayRound,
    RoleplaySession,
    RubricVersion,
    User,
)
from app.models.base import new_id, utcnow
from app.security import iso_utc
from app.services.common import (
    chapter_keys,
    encode_cursor,
    iso_or_none,
    open_retrain_for,
    open_retrain_payload,
    page_items,
    user_brief,
)
from app.services.idempotency import (
    hash_payload,
    hash_value,
    replay_or_clear,
    require_idempotency_key,
    save_record,
)
from app.services.learning import derive_assignment_status

STATS_WINDOW_HOURS = 48
RATE_QUANT = Decimal("0.0001")


def _truncate_ms(value: datetime) -> datetime:
    """将 UTC 时间截断到毫秒，与 DATETIME(3) 和 iso_utc 保持一致。"""
    return value.replace(microsecond=value.microsecond // 1000 * 1000)


def _compute_rate(numerator: int, denominator: int) -> float | None:
    """按 4 位小数四舍五入计算通关率；分母为 0 返回 None。"""
    if denominator <= 0:
        return None
    ratio = (Decimal(numerator) / Decimal(denominator)).quantize(
        RATE_QUANT, rounding=ROUND_HALF_UP
    )
    return float(ratio)


def _is_qualified_in_window(
    qualified_at: datetime | None,
    window_start: datetime,
    window_end: datetime,
    computed_at: datetime | None = None,
) -> bool:
    """判断达标时间是否落在左闭右开窗口 [window_start, window_end) 内。"""
    if qualified_at is None:
        return False
    if computed_at is not None and qualified_at > computed_at:
        return False
    return window_start <= qualified_at < window_end


def _summarize_assignments(
    assignments: list[Assignment],
    window_start: datetime,
    window_end: datetime,
    computed_at: datetime,
) -> dict[str, int]:
    """统计一组应训任务的概览指标。"""
    qualified_in_window = 0
    pending_review = 0
    open_retrains = 0
    for assignment in assignments:
        if _is_qualified_in_window(
            assignment.qualified_at, window_start, window_end, computed_at
        ):
            qualified_in_window += 1
        if assignment.status is AssignmentStatus.pending_review:
            pending_review += 1
        if open_retrain_for(assignment.retrains) is not None:
            open_retrains += 1
    return {
        "assigned": len(assignments),
        "qualified_in_window": qualified_in_window,
        "pending_review": pending_review,
        "open_retrains": open_retrains,
    }


def _filtered_targets(
    release: Release, allowed_store_ids: set[str] | None
) -> list[ReleaseTarget]:
    """按允许门店集合筛选批次目标门店，按 store_id 稳定排序。"""
    targets = sorted(release.targets, key=lambda item: item.store_id)
    if allowed_store_ids is None:
        return targets
    return [target for target in targets if target.store_id in allowed_store_ids]


async def list_manager_releases(
    session: AsyncSession,
    managed_store_ids: set[str],
    *,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    """列出与店长管辖门店有交集的发布批次。"""
    if not managed_store_ids:
        return {"items": [], "next_cursor": None}

    release_ids = list(
        (
            await session.scalars(
                select(ReleaseTarget.release_id)
                .where(ReleaseTarget.store_id.in_(managed_store_ids))
                .distinct()
            )
        ).all()
    )
    if not release_ids:
        return {"items": [], "next_cursor": None}

    releases = list(
        (
            await session.scalars(
                select(Release)
                .where(Release.id.in_(release_ids))
                .options(
                    selectinload(Release.course_version).selectinload(
                        CourseVersion.course
                    ),
                    selectinload(Release.targets),
                    selectinload(Release.assignments).selectinload(Assignment.retrains),
                )
                .order_by(Release.published_at.desc(), Release.id.desc())
            )
        ).all()
    )

    window, next_cursor = page_items(releases, limit, offset)
    computed_at = _truncate_ms(utcnow())
    items: list[dict[str, Any]] = []
    for release in window:
        visible_targets = _filtered_targets(release, managed_store_ids)
        visible_store_ids = [target.store_id for target in visible_targets]
        visible_set = set(visible_store_ids)
        visible_assignments = [
            assignment
            for assignment in release.assignments
            if assignment.store_id in visible_set
        ]
        window_end = release.published_at + timedelta(hours=STATS_WINDOW_HOURS)
        summary = _summarize_assignments(
            visible_assignments, release.published_at, window_end, computed_at
        )
        items.append(
            {
                "release_id": release.id,
                "course": {
                    "id": release.course_version.course.id,
                    "name": release.course_version.course.name,
                },
                "published_at": iso_utc(release.published_at),
                "deadline_at": iso_utc(release.deadline_at),
                "stores": visible_store_ids,
                **summary,
            }
        )
    return {"items": items, "next_cursor": next_cursor}


async def get_manager_release_detail(
    session: AsyncSession,
    release_id: str,
    managed_store_ids: set[str],
) -> dict[str, Any]:
    """读取店长视角下的发布批次概览，按管辖门店拆分汇总。"""
    if not managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(
            selectinload(Release.course_version).selectinload(CourseVersion.course),
            selectinload(Release.targets).selectinload(ReleaseTarget.store),
            selectinload(Release.assignments).selectinload(Assignment.retrains),
        )
    )
    if release is None:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    visible_targets = _filtered_targets(release, managed_store_ids)
    if not visible_targets:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    computed_at = _truncate_ms(utcnow())
    window_end = release.published_at + timedelta(hours=STATS_WINDOW_HOURS)
    assignments_by_store: dict[str, list[Assignment]] = {
        target.store_id: [] for target in visible_targets
    }
    for assignment in release.assignments:
        if assignment.store_id in assignments_by_store:
            assignments_by_store[assignment.store_id].append(assignment)

    stores_payload = []
    for target in visible_targets:
        summary = _summarize_assignments(
            assignments_by_store[target.store_id],
            release.published_at,
            window_end,
            computed_at,
        )
        stores_payload.append(
            {
                "id": target.store.id,
                "name": target.store.name,
                **summary,
            }
        )

    return {
        "release": {
            "id": release.id,
            "course": {
                "id": release.course_version.course.id,
                "name": release.course_version.course.name,
            },
            "published_at": iso_utc(release.published_at),
            "deadline_at": iso_utc(release.deadline_at),
            "stores": stores_payload,
        }
    }


async def list_manager_release_assignees(
    session: AsyncSession,
    release_id: str,
    managed_store_ids: set[str],
    *,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    """读取店长管辖门店在指定批次下的应训名单与学习/补训状态。"""
    if not managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(
            selectinload(Release.course_version),
            selectinload(Release.targets),
        )
    )
    if release is None:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    visible_store_ids = {
        target.store_id for target in _filtered_targets(release, managed_store_ids)
    }
    if not visible_store_ids:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    required_chapters = len(chapter_keys(release.course_version.content))
    stmt = (
        select(Assignment)
        .join(User, Assignment.user_id == User.id)
        .where(
            Assignment.release_id == release_id,
            Assignment.store_id.in_(visible_store_ids),
        )
        .options(
            selectinload(Assignment.user),
            selectinload(Assignment.retrains),
        )
        .order_by(Assignment.store_id, User.name, Assignment.id)
        .offset(offset)
        .limit(limit + 1)
    )
    assignments = list((await session.scalars(stmt)).all())
    has_more = len(assignments) > limit
    window = assignments[:limit]

    items = [
        {
            "assignment_id": assignment.id,
            "store_id": assignment.store_id,
            "user": {
                "id": assignment.user.id,
                "name": assignment.user.name,
                "active": assignment.user.active,
            },
            "status": assignment.status.value,
            "completed_chapter_count": assignment.completed_chapter_count,
            "required_chapters": required_chapters,
            "last_score": assignment.last_score,
            "best_score": assignment.best_score,
            "qualified_at": iso_or_none(assignment.qualified_at),
            "open_retrain": open_retrain_payload(open_retrain_for(assignment.retrains)),
            "state_version": assignment.state_version,
        }
        for assignment in window
    ]
    return {
        "items": items,
        "next_cursor": encode_cursor(offset + limit) if has_more else None,
    }


def _attempt_detail_payload(attempt: RoleplayAttempt) -> dict[str, Any]:
    """序列化店长详情中的单条正式成绩与逐项核验证据。"""
    return {
        "attempt_id": attempt.id,
        "round_no": attempt.round.round_no,
        "total": attempt.total,
        "passed": attempt.passed,
        "answer_text": attempt.round.answer_text,
        "fact_checks": attempt.fact_checks,
        "missed_required_facts": attempt.missed_required_facts,
        "redline_hits": attempt.redline_hits,
        "computed_at": iso_utc(attempt.computed_at),
    }


async def _load_assignment_retrains(
    session: AsyncSession, assignment_id: str
) -> list[Retrain]:
    """按创建时间顺序普通读取任务的补训记录。

    调用方必须已先持有该 Assignment 主键行锁；使用普通读而非 FOR UPDATE，
    防止首次补训查无记录时在 retrains 二级索引上加间隙锁引发并发插入死锁。
    """
    return list(
        (
            await session.scalars(
                select(Retrain)
                .where(Retrain.assignment_id == assignment_id)
                .order_by(Retrain.issued_at, Retrain.id)
            )
        ).all()
    )


async def get_manager_assignment_detail(
    session: AsyncSession,
    assignment_id: str,
    managed_store_ids: set[str],
) -> dict[str, Any]:
    """读取店员任务详情：状态、最近 10 条正式成绩与原话、补训历史（含冻结证据）和审计日志。"""
    if not managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")

    assignment = await session.scalar(
        select(Assignment)
        .where(
            Assignment.id == assignment_id,
            Assignment.store_id.in_(managed_store_ids),
        )
        .options(
            selectinload(Assignment.user),
            selectinload(Assignment.release).selectinload(Release.course_version),
            selectinload(Assignment.retrains).selectinload(Retrain.issuer),
            selectinload(Assignment.retrains).selectinload(Retrain.reviewer),
        )
    )
    if assignment is None:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")

    required_chapters = len(chapter_keys(assignment.release.course_version.content))

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

    retrains = sorted(
        assignment.retrains,
        key=lambda item: (item.issued_at, item.id),
        reverse=True,
    )
    retrain_ids = [item.id for item in retrains]

    # 保持 attempts 严格返回最近 10 条；同时补查掉出最近 10 条的冻结复查证据，
    # 确保员工继续练习后店长仍能查看冻结轮次的完整原话与逐项命中结果。
    attempt_by_id: dict[str, RoleplayAttempt] = {item.id: item for item in attempts}
    missing_evidence_ids = {
        item.evidence_attempt_id
        for item in retrains
        if item.evidence_attempt_id and item.evidence_attempt_id not in attempt_by_id
    }
    if missing_evidence_ids:
        extra_attempts = (
            await session.scalars(
                select(RoleplayAttempt)
                .where(
                    RoleplayAttempt.assignment_id == assignment.id,
                    RoleplayAttempt.id.in_(missing_evidence_ids),
                )
                .options(selectinload(RoleplayAttempt.round))
            )
        ).all()
        for extra in extra_attempts:
            attempt_by_id[extra.id] = extra

    audit_items: list[dict[str, Any]] = []
    if retrain_ids:
        audit_rows = (
            await session.execute(
                select(AuditEvent, User)
                .join(User, AuditEvent.actor_user_id == User.id)
                .where(
                    AuditEvent.entity_type == "retrain",
                    AuditEvent.entity_id.in_(retrain_ids),
                )
                .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
            )
        ).all()
        audit_items = [
            {
                "action": event.action.value,
                "actor": user_brief(actor),
                "at": iso_utc(event.created_at),
                "payload": event.payload,
            }
            for event, actor in audit_rows
        ]

    return {
        "assignment": {
            "assignment_id": assignment.id,
            "release_id": assignment.release_id,
            "store_id": assignment.store_id,
            "user": {
                "id": assignment.user.id,
                "name": assignment.user.name,
                "active": assignment.user.active,
            },
            "status": assignment.status.value,
            "completed_chapter_count": assignment.completed_chapter_count,
            "required_chapters": required_chapters,
            "last_score": assignment.last_score,
            "best_score": assignment.best_score,
            "first_passed_at": iso_or_none(assignment.first_passed_at),
            "qualified_at": iso_or_none(assignment.qualified_at),
            "state_version": assignment.state_version,
        },
        "attempts": [_attempt_detail_payload(attempt) for attempt in attempts],
        "retrains": [
            {
                "id": retrain.id,
                "status": retrain.status.value,
                "focus": {
                    "fact_key": retrain.focus_fact_key,
                    "label": retrain.focus_fact_label,
                },
                "note": retrain.note,
                "baseline_round_no": retrain.baseline_round_no,
                "evidence_round_no": retrain.evidence_round_no,
                "evidence_attempt_id": retrain.evidence_attempt_id,
                "evidence_attempt": (
                    _attempt_detail_payload(attempt_by_id[retrain.evidence_attempt_id])
                    if retrain.evidence_attempt_id
                    and retrain.evidence_attempt_id in attempt_by_id
                    else None
                ),
                "issued_by": user_brief(retrain.issuer),
                "issued_at": iso_utc(retrain.issued_at),
                "reviewed_by": user_brief(retrain.reviewer)
                if retrain.reviewer is not None
                else None,
                "reviewed_at": iso_or_none(retrain.reviewed_at),
                "review_note": retrain.review_note,
                "version": retrain.version,
            }
            for retrain in retrains
        ],
        "audit": audit_items,
    }


async def issue_retrain(
    session: AsyncSession,
    assignment_id: str,
    body: Any,
    current_user: User,
    managed_store_ids: set[str],
    request: Request,
) -> JSONResponse:
    """店长按最近正式成绩的漏讲项指派补训。

    幂等记录、补训记录、任务状态刷新与审计日志在同一短事务内提交。
    """
    key = require_idempotency_key(request)
    route = request.url.path
    key_hash = hash_value(key)
    request_hash = hash_payload(body.model_dump(mode="json"))
    user_id = current_user.id

    if not managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")

    # 先在独立只读事务验证归属范围，避免普通读提前建立写事务快照，也不泄露跨店资源。
    async with session.begin():
        assignment_store_id = await session.scalar(
            select(Assignment.store_id).where(Assignment.id == assignment_id)
        )
    if assignment_store_id is None or assignment_store_id not in managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "学习任务不存在")

    try:
        async with session.begin():
            assignment = await session.scalar(
                select(Assignment)
                .where(Assignment.id == assignment_id)
                .with_for_update()
            )
            if assignment is None or assignment.store_id not in managed_store_ids:
                raise ApiError(404, "NOT_FOUND", "学习任务不存在")

            replay = await replay_or_clear(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay

            retrains = await _load_assignment_retrains(session, assignment.id)
            existing_open = open_retrain_for(retrains)
            if existing_open is not None:
                raise ApiError(
                    409,
                    "RETRAIN_EXISTS",
                    "该学员已存在进行中的补训任务",
                    {"retrain": open_retrain_payload(existing_open)},
                )

            latest_attempt = await session.scalar(
                select(RoleplayAttempt)
                .join(RoleplayRound, RoleplayAttempt.round_id == RoleplayRound.id)
                .where(RoleplayAttempt.assignment_id == assignment.id)
                .options(selectinload(RoleplayAttempt.round))
                .order_by(RoleplayRound.round_no.desc())
                .limit(1)
            )
            if latest_attempt is None:
                raise ApiError(
                    409,
                    "NO_ATTEMPT",
                    "学员尚无正式对练成绩，无法指派补训",
                )

            missed_facts = (
                latest_attempt.missed_required_facts
                if isinstance(latest_attempt.missed_required_facts, list)
                else []
            )
            matched_fact = next(
                (
                    item
                    for item in missed_facts
                    if isinstance(item, dict) and item.get("key") == body.focus_fact_key
                ),
                None,
            )
            if matched_fact is None:
                raise ApiError(
                    422,
                    "FOCUS_NOT_MISSED",
                    "补训考点不在最近一次成绩的漏讲项中",
                    {"missed_required_facts": missed_facts},
                )

            focus_fact_label = str(matched_fact.get("label") or body.focus_fact_key)

            # 基线轮次取会话当前已分配的最大轮次号，避免发起前已提交但未评分完的旧轮次越界推进新补训。
            last_round_no = await session.scalar(
                select(RoleplaySession.last_round_no).where(
                    RoleplaySession.assignment_id == assignment.id
                )
            )
            baseline_round_no = (
                int(last_round_no)
                if last_round_no is not None
                else int(latest_attempt.round.round_no)
            )

            release = await session.scalar(
                select(Release)
                .where(Release.id == assignment.release_id)
                .options(selectinload(Release.course_version))
            )
            if release is None:
                raise ApiError(500, "INTERNAL_ERROR", "发布批次不存在")
            required_chapters = len(chapter_keys(release.course_version.content))

            now = _truncate_ms(utcnow())
            retrain = Retrain(
                id=new_id("rtn"),
                assignment_id=assignment.id,
                release_id=assignment.release_id,
                focus_fact_key=body.focus_fact_key,
                focus_fact_label=focus_fact_label,
                note=body.note,
                status=RetrainStatus.pending,
                baseline_round_no=baseline_round_no,
                evidence_round_no=None,
                evidence_attempt_id=None,
                issued_by=current_user.id,
                issued_at=now,
                updated_at=now,
                version=1,
            )
            session.add(retrain)
            retrains.append(retrain)

            # 发起补训不修改 qualified_at 和 first_passed_at，历史 48 小时统计保持不变。
            assignment.status = derive_assignment_status(
                completed_chapter_count=assignment.completed_chapter_count,
                required_chapters=required_chapters,
                has_attempt=True,
                qualified_at=assignment.qualified_at,
                retrains=retrains,
            )
            assignment.state_version += 1
            assignment.updated_at = now

            session.add(
                AuditEvent(
                    actor_user_id=current_user.id,
                    action=AuditAction.retrain_issued,
                    entity_type="retrain",
                    entity_id=retrain.id,
                    store_id=assignment.store_id,
                    payload={
                        "assignment_id": assignment.id,
                        "release_id": assignment.release_id,
                        "focus_fact_key": retrain.focus_fact_key,
                        "focus_fact_label": retrain.focus_fact_label,
                        "baseline_round_no": baseline_round_no,
                        "latest_attempt_id": latest_attempt.id,
                        "latest_score": latest_attempt.total,
                        "note": body.note,
                    },
                    request_id=request.state.request_id,
                    created_at=now,
                )
            )

            response_body = {
                "retrain": {
                    "id": retrain.id,
                    "status": retrain.status.value,
                    "focus": {
                        "fact_key": retrain.focus_fact_key,
                        "label": retrain.focus_fact_label,
                    },
                    "baseline_round_no": retrain.baseline_round_no,
                    "version": retrain.version,
                    "issued_by": user_brief(current_user),
                    "issued_at": iso_utc(now),
                },
                "assignment": {
                    "assignment_id": assignment.id,
                    "status": assignment.status.value,
                    "state_version": assignment.state_version,
                },
            }
            save_record(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
                status_code=201,
                response_body=response_body,
            )
    except IntegrityError:
        await session.rollback()
        async with session.begin():
            replay = await replay_or_clear(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay
            retrains = list(
                (
                    await session.scalars(
                        select(Retrain)
                        .where(Retrain.assignment_id == assignment_id)
                        .order_by(Retrain.issued_at, Retrain.id)
                    )
                ).all()
            )
            existing_open = open_retrain_for(retrains)
            if existing_open is not None:
                raise ApiError(
                    409,
                    "RETRAIN_EXISTS",
                    "该学员已存在进行中的补训任务",
                    {"retrain": open_retrain_payload(existing_open)},
                )
        raise

    return JSONResponse(status_code=201, content=response_body)


async def review_retrain(
    session: AsyncSession,
    retrain_id: str,
    body: Any,
    current_user: User,
    managed_store_ids: set[str],
    request: Request,
) -> JSONResponse:
    """店长确认或驳回待复查补训。

    校验状态、乐观锁版本 expected_version、冻结证据与整轮通关标准，
    并将复查写入、任务状态刷新、审计日志与幂等记录放在同一短事务。
    """
    key = require_idempotency_key(request)
    route = request.url.path
    key_hash = hash_value(key)
    request_hash = hash_payload(body.model_dump(mode="json"))
    user_id = current_user.id

    if not managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "补训记录不存在")

    # 独立只读事务定位归属任务与门店，既隐藏跨店资源，又保持写事务内锁序为 Assignment -> Retrain。
    async with session.begin():
        row = (
            await session.execute(
                select(Retrain.assignment_id, Assignment.store_id)
                .join(Assignment, Retrain.assignment_id == Assignment.id)
                .where(Retrain.id == retrain_id)
            )
        ).one_or_none()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "补训记录不存在")
    assignment_id, assignment_store_id = row
    if assignment_store_id not in managed_store_ids:
        raise ApiError(404, "NOT_FOUND", "补训记录不存在")

    try:
        async with session.begin():
            assignment = await session.scalar(
                select(Assignment)
                .where(Assignment.id == assignment_id)
                .with_for_update()
            )
            if assignment is None or assignment.store_id not in managed_store_ids:
                raise ApiError(404, "NOT_FOUND", "补训记录不存在")

            replay = await replay_or_clear(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
            )
            if replay is not None:
                return replay

            retrains = await _load_assignment_retrains(session, assignment.id)
            retrain = next((item for item in retrains if item.id == retrain_id), None)
            if retrain is None:
                raise ApiError(404, "NOT_FOUND", "补训记录不存在")

            if retrain.status is not RetrainStatus.fixed_pending_review:
                raise ApiError(
                    409,
                    "STATE_CONFLICT",
                    "当前补训状态不允许复查，请刷新后重试",
                    {
                        "current_status": retrain.status.value,
                        "current_version": retrain.version,
                        "evidence_attempt_id": retrain.evidence_attempt_id,
                    },
                )
            if retrain.version != body.expected_version:
                raise ApiError(
                    409,
                    "STATE_CONFLICT",
                    "复查状态已被其他操作更新，请刷新后重试",
                    {
                        "current_status": retrain.status.value,
                        "current_version": retrain.version,
                        "evidence_attempt_id": retrain.evidence_attempt_id,
                    },
                )

            release = await session.scalar(
                select(Release)
                .where(Release.id == assignment.release_id)
                .options(
                    selectinload(Release.course_version),
                    selectinload(Release.rubric_version),
                )
            )
            if release is None:
                raise ApiError(500, "INTERNAL_ERROR", "发布批次不存在")
            required_chapters = len(chapter_keys(release.course_version.content))
            pass_threshold = int(
                (release.rubric_version.rules or {}).get("pass_threshold", 85)
                if release.rubric_version is not None
                else 85
            )

            now = _truncate_ms(utcnow())
            prev_status = retrain.status.value
            prev_version = retrain.version
            new_version = body.expected_version + 1

            if body.decision == "confirm":
                if (
                    not retrain.evidence_attempt_id
                    or body.evidence_attempt_id != retrain.evidence_attempt_id
                ):
                    raise ApiError(
                        409,
                        "EVIDENCE_MISMATCH",
                        "复查证据与当前待复查证据不一致",
                        {
                            "expected_evidence_attempt_id": retrain.evidence_attempt_id,
                            "provided_evidence_attempt_id": body.evidence_attempt_id,
                        },
                    )
                attempt = await session.get(RoleplayAttempt, retrain.evidence_attempt_id)
                if attempt is None or attempt.assignment_id != assignment.id:
                    raise ApiError(
                        409,
                        "EVIDENCE_MISMATCH",
                        "复查证据不存在或不属于当前学习任务",
                        {
                            "expected_evidence_attempt_id": retrain.evidence_attempt_id,
                            "provided_evidence_attempt_id": body.evidence_attempt_id,
                        },
                    )

                fact_checks = (
                    attempt.fact_checks if isinstance(attempt.fact_checks, list) else []
                )
                focus_check = next(
                    (
                        item
                        for item in fact_checks
                        if isinstance(item, dict)
                        and item.get("key") == retrain.focus_fact_key
                    ),
                    None,
                )
                if focus_check is None or focus_check.get("status") != "hit":
                    raise ApiError(
                        422,
                        "FOCUS_NOT_FIXED",
                        "复查证据未证明目标考点已改正",
                        {
                            "focus_fact_key": retrain.focus_fact_key,
                            "evidence_attempt_id": attempt.id,
                        },
                    )

                missed_required = (
                    attempt.missed_required_facts
                    if isinstance(attempt.missed_required_facts, list)
                    else []
                )
                redline_hits = (
                    attempt.redline_hits
                    if isinstance(attempt.redline_hits, list)
                    else []
                )
                if (
                    not attempt.passed
                    or missed_required
                    or redline_hits
                    or attempt.total < pass_threshold
                ):
                    raise ApiError(
                        422,
                        "ATTEMPT_NOT_PASSED",
                        "复查证据未达到整轮通关标准",
                        {
                            "evidence_attempt_id": attempt.id,
                            "total": attempt.total,
                            "missed_required_facts": missed_required,
                            "redline_hits": redline_hits,
                        },
                    )

                updated = await session.execute(
                    update(Retrain)
                    .where(
                        Retrain.id == retrain.id,
                        Retrain.status == RetrainStatus.fixed_pending_review,
                        Retrain.version == body.expected_version,
                    )
                    .values(
                        status=RetrainStatus.verified,
                        reviewed_by=current_user.id,
                        reviewed_at=now,
                        review_note=body.note,
                        version=new_version,
                        updated_at=now,
                    )
                    .execution_options(synchronize_session=False)
                )
                await session.refresh(retrain)
                if updated.rowcount != 1:
                    raise ApiError(
                        409,
                        "STATE_CONFLICT",
                        "复查状态已被其他操作更新，请刷新后重试",
                        {
                            "current_status": retrain.status.value,
                            "current_version": retrain.version,
                            "evidence_attempt_id": retrain.evidence_attempt_id,
                        },
                    )

                # 确认复查绝不回写 qualified_at 或 first_passed_at。
                assignment.status = derive_assignment_status(
                    completed_chapter_count=assignment.completed_chapter_count,
                    required_chapters=required_chapters,
                    has_attempt=True,
                    qualified_at=assignment.qualified_at,
                    retrains=retrains,
                )
                assignment.state_version += 1
                assignment.updated_at = now

                session.add(
                    AuditEvent(
                        actor_user_id=current_user.id,
                        action=AuditAction.retrain_confirmed,
                        entity_type="retrain",
                        entity_id=retrain.id,
                        store_id=assignment.store_id,
                        payload={
                            "assignment_id": assignment.id,
                            "release_id": assignment.release_id,
                            "focus_fact_key": retrain.focus_fact_key,
                            "from_status": prev_status,
                            "to_status": RetrainStatus.verified.value,
                            "from_version": prev_version,
                            "to_version": new_version,
                            "evidence_attempt_id": retrain.evidence_attempt_id,
                            "evidence_round_no": retrain.evidence_round_no,
                            "score": attempt.total,
                            "note": body.note,
                        },
                        request_id=request.state.request_id,
                        created_at=now,
                    )
                )

                response_body = {
                    "retrain": {
                        "id": retrain.id,
                        "status": RetrainStatus.verified.value,
                        "evidence_attempt_id": retrain.evidence_attempt_id,
                        "reviewed_by": user_brief(current_user),
                        "reviewed_at": iso_utc(now),
                        "version": new_version,
                    },
                    "assignment": {
                        "assignment_id": assignment.id,
                        "status": assignment.status.value,
                        "qualified_at": iso_or_none(assignment.qualified_at),
                        "state_version": assignment.state_version,
                    },
                }
            else:
                if (
                    body.evidence_attempt_id is not None
                    and body.evidence_attempt_id != retrain.evidence_attempt_id
                ):
                    raise ApiError(
                        409,
                        "EVIDENCE_MISMATCH",
                        "复查证据与当前待复查证据不一致",
                        {
                            "expected_evidence_attempt_id": retrain.evidence_attempt_id,
                            "provided_evidence_attempt_id": body.evidence_attempt_id,
                        },
                    )

                prev_evidence_attempt_id = retrain.evidence_attempt_id
                prev_evidence_round_no = retrain.evidence_round_no
                prev_baseline_round_no = retrain.baseline_round_no

                last_round_no = await session.scalar(
                    select(RoleplaySession.last_round_no).where(
                        RoleplaySession.assignment_id == assignment.id
                    )
                )
                new_baseline_round_no = max(
                    int(last_round_no) if last_round_no is not None else 0,
                    int(retrain.evidence_round_no or 0),
                    int(retrain.baseline_round_no),
                )

                updated = await session.execute(
                    update(Retrain)
                    .where(
                        Retrain.id == retrain.id,
                        Retrain.status == RetrainStatus.fixed_pending_review,
                        Retrain.version == body.expected_version,
                    )
                    .values(
                        status=RetrainStatus.pending,
                        baseline_round_no=new_baseline_round_no,
                        evidence_round_no=None,
                        evidence_attempt_id=None,
                        reviewed_by=current_user.id,
                        reviewed_at=now,
                        review_note=body.note,
                        version=new_version,
                        updated_at=now,
                    )
                    .execution_options(synchronize_session=False)
                )
                await session.refresh(retrain)
                if updated.rowcount != 1:
                    raise ApiError(
                        409,
                        "STATE_CONFLICT",
                        "复查状态已被其他操作更新，请刷新后重试",
                        {
                            "current_status": retrain.status.value,
                            "current_version": retrain.version,
                            "evidence_attempt_id": retrain.evidence_attempt_id,
                        },
                    )

                assignment.status = derive_assignment_status(
                    completed_chapter_count=assignment.completed_chapter_count,
                    required_chapters=required_chapters,
                    has_attempt=True,
                    qualified_at=assignment.qualified_at,
                    retrains=retrains,
                )
                assignment.state_version += 1
                assignment.updated_at = now

                session.add(
                    AuditEvent(
                        actor_user_id=current_user.id,
                        action=AuditAction.retrain_rejected,
                        entity_type="retrain",
                        entity_id=retrain.id,
                        store_id=assignment.store_id,
                        payload={
                            "assignment_id": assignment.id,
                            "release_id": assignment.release_id,
                            "focus_fact_key": retrain.focus_fact_key,
                            "from_status": prev_status,
                            "to_status": RetrainStatus.pending.value,
                            "from_version": prev_version,
                            "to_version": new_version,
                            "previous_evidence_attempt_id": prev_evidence_attempt_id,
                            "previous_evidence_round_no": prev_evidence_round_no,
                            "previous_baseline_round_no": prev_baseline_round_no,
                            "baseline_round_no": new_baseline_round_no,
                            "note": body.note,
                        },
                        request_id=request.state.request_id,
                        created_at=now,
                    )
                )

                response_body = {
                    "retrain": {
                        "id": retrain.id,
                        "status": RetrainStatus.pending.value,
                        "evidence_attempt_id": None,
                        "baseline_round_no": new_baseline_round_no,
                        "reviewed_by": user_brief(current_user),
                        "reviewed_at": iso_utc(now),
                        "version": new_version,
                    },
                    "assignment": {
                        "assignment_id": assignment.id,
                        "status": assignment.status.value,
                        "state_version": assignment.state_version,
                    },
                }

            save_record(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
                status_code=200,
                response_body=response_body,
            )
    except IntegrityError:
        await session.rollback()
        async with session.begin():
            replay = await replay_or_clear(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
            )
        if replay is not None:
            return replay
        raise

    return JSONResponse(status_code=200, content=response_body)


async def get_release_stats(
    session: AsyncSession,
    release_id: str,
    *,
    allowed_store_ids: set[str] | None,
) -> dict[str, Any]:
    """计算发布批次的 48 小时通关统计（HQ 与店长共用同一结构）。

    口径（M1 §7）：
    - 时间窗口固定为 [published_at, published_at + 48h)，不受 deadline_hours 影响；
    - 分母取发布时快照 assignments 行数；
    - 分子取 qualified_at 落在窗口内的唯一 assignment_id 数；
    - qualified_after_window 统计 qualified_at >= window_end 且 <= computed_at 的人数；
    - 空名单分母为 0 时 rate=None、empty_roster=True。
    """
    if allowed_store_ids is not None and not allowed_store_ids:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(
            selectinload(Release.targets).selectinload(ReleaseTarget.store),
            selectinload(Release.assignments),
        )
    )
    if release is None:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    visible_targets = _filtered_targets(release, allowed_store_ids)
    if allowed_store_ids is not None and not visible_targets:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    computed_at = _truncate_ms(utcnow())
    window_start = release.published_at
    window_end = window_start + timedelta(hours=STATS_WINDOW_HOURS)
    window_open = computed_at < window_end

    assignments_by_store: dict[str, list[Assignment]] = {
        target.store_id: [] for target in visible_targets
    }
    for assignment in release.assignments:
        if assignment.store_id in assignments_by_store:
            assignments_by_store[assignment.store_id].append(assignment)

    by_store: list[dict[str, Any]] = []
    total_denominator = 0
    total_numerator = 0
    total_after_window = 0

    for target in visible_targets:
        store_assignments = assignments_by_store[target.store_id]
        denominator = len(store_assignments)
        numerator = sum(
            1
            for assignment in store_assignments
            if _is_qualified_in_window(
                assignment.qualified_at,
                window_start,
                window_end,
                computed_at,
            )
        )
        qualified_after_window = sum(
            1
            for assignment in store_assignments
            if assignment.qualified_at is not None
            and window_end <= assignment.qualified_at <= computed_at
        )
        by_store.append(
            {
                "store_id": target.store.id,
                "store_name": target.store.name,
                "denominator": denominator,
                "numerator": numerator,
                "qualified_after_window": qualified_after_window,
                "rate": _compute_rate(numerator, denominator),
                "empty_roster": denominator == 0,
            }
        )
        total_denominator += denominator
        total_numerator += numerator
        total_after_window += qualified_after_window

    return {
        "release_id": release.id,
        "published_at": iso_utc(release.published_at),
        "window_start": iso_utc(window_start),
        "window_end": iso_utc(window_end),
        "window_hours": STATS_WINDOW_HOURS,
        "window_open": window_open,
        "computed_at": iso_utc(computed_at),
        "denominator": total_denominator,
        "numerator": total_numerator,
        "qualified_after_window": total_after_window,
        "rate": _compute_rate(total_numerator, total_denominator),
        "empty_roster": total_denominator == 0,
        "by_store": by_store,
    }
