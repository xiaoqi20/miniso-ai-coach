"""总部课程、不可变版本、审校与发布批次业务。"""

from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.errors import ApiError
from app.models import (
    Assignment,
    AssignmentStatus,
    AuditAction,
    AuditEvent,
    Course,
    CourseVersion,
    CourseVersionStatus,
    MembershipRole,
    Release,
    ReleaseStatus,
    ReleaseTarget,
    Retrain,
    RetrainStatus,
    RubricVersion,
    Store,
    StoreMembership,
    User,
    UserRole,
)
from app.models.base import new_id, utcnow
from app.schemas.course import (
    CourseCreateRequest,
    CourseReviewRequest,
    CourseVersionCloneRequest,
    CourseVersionUpdateRequest,
    PublishRequest,
)
from app.security import iso_utc
from app.services.common import (
    chapter_keys,
    encode_cursor,
    ensure_rubric_compatible,
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

COURSE_READY_STATUSES = {CourseVersionStatus.approved, CourseVersionStatus.published}


def _latest_version(versions: list[CourseVersion]) -> CourseVersion | None:
    return max(versions, key=lambda item: item.version_no) if versions else None


def _version_summary(version: CourseVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "version_no": version.version_no,
        "status": version.status.value,
        "revision": version.revision,
        "updated_at": iso_utc(version.updated_at),
    }


def _version_response(version: CourseVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "course_id": version.course_id,
        "version_no": version.version_no,
        "status": version.status.value,
        "revision": version.revision,
        "created_by": version.created_by,
        "created_at": iso_utc(version.created_at),
        "updated_at": iso_utc(version.updated_at),
    }


def _rubric_response(rubric: RubricVersion) -> dict[str, Any]:
    return {
        "id": rubric.id,
        "course_version_id": rubric.course_version_id,
        "version_no": rubric.version_no,
        "created_at": iso_utc(rubric.created_at),
    }


async def list_courses(
    session: AsyncSession, *, limit: int, offset: int
) -> dict[str, Any]:
    courses = (
        await session.scalars(
            select(Course).options(
                selectinload(Course.versions).selectinload(CourseVersion.releases)
            )
        )
    ).all()
    courses = sorted(
        courses,
        key=lambda course: (
            _latest_version(course.versions).updated_at
            if _latest_version(course.versions)
            else course.created_at,
            course.id,
        ),
        reverse=True,
    )
    window, next_cursor = page_items(courses, limit, offset)
    items = []
    for course in window:
        latest = _latest_version(course.versions)
        items.append(
            {
                "course_id": course.id,
                "sku_code": course.sku_code,
                "name": course.name,
                "latest_version": _version_summary(latest) if latest else None,
                "published_release_count": sum(
                    len(version.releases) for version in course.versions
                ),
            }
        )
    return {"items": items, "next_cursor": next_cursor}


async def get_course_detail(session: AsyncSession, course_id: str) -> dict[str, Any]:
    course = await session.scalar(
        select(Course)
        .where(Course.id == course_id)
        .options(
            selectinload(Course.versions).selectinload(CourseVersion.rubric_version),
            selectinload(Course.versions).selectinload(CourseVersion.reviewer),
        )
    )
    if course is None:
        raise ApiError(404, "NOT_FOUND", "课程不存在")

    versions = []
    for version in sorted(course.versions, key=lambda item: item.version_no):
        versions.append(
            {
                "id": version.id,
                "version_no": version.version_no,
                "status": version.status.value,
                "revision": version.revision,
                "content": version.content,
                "rubric": version.rubric_version.rules
                if version.rubric_version
                else None,
                "reviewed_by": user_brief(version.reviewer)
                if version.reviewer
                else None,
                "reviewed_at": iso_or_none(version.reviewed_at),
                "created_at": iso_utc(version.created_at),
                "updated_at": iso_utc(version.updated_at),
            }
        )
    return {
        "course": {"id": course.id, "sku_code": course.sku_code, "name": course.name},
        "versions": versions,
    }


async def create_course(
    session: AsyncSession, body: CourseCreateRequest, current_user: str
) -> dict[str, Any]:
    now = utcnow()
    course = Course(
        id=new_id("crs"),
        sku_code=body.sku_code,
        name=body.name,
        created_by=current_user,
        created_at=now,
    )
    version = CourseVersion(
        id=new_id("crv"),
        course_id=course.id,
        version_no=1,
        status=CourseVersionStatus.draft,
        content=body.content.model_dump(mode="json", exclude_none=True),
        revision=1,
        created_by=current_user,
        created_at=now,
        updated_at=now,
    )
    rubric = RubricVersion(
        id=new_id("rbn"),
        course_version_id=version.id,
        version_no=1,
        rules=body.rubric.model_dump(mode="json", exclude_none=True),
        created_at=now,
    )
    try:
        async with session.begin():
            existing = await session.scalar(
                select(Course.id).where(Course.sku_code == body.sku_code)
            )
            if existing is not None:
                raise ApiError(
                    422,
                    "VALIDATION_ERROR",
                    "sku_code 已存在",
                    {
                        "fields": [
                            {
                                "loc": ["body", "sku_code"],
                                "msg": "sku_code 已存在",
                                "type": "value_error",
                            }
                        ]
                    },
                )
            session.add_all([course, version, rubric])
    except IntegrityError as exc:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "sku_code 已存在",
            {
                "fields": [
                    {
                        "loc": ["body", "sku_code"],
                        "msg": "sku_code 已存在",
                        "type": "value_error",
                    }
                ]
            },
        ) from exc

    return {
        "course": {
            "id": course.id,
            "sku_code": course.sku_code,
            "name": course.name,
            "created_by": course.created_by,
            "created_at": iso_utc(course.created_at),
        },
        "version": _version_response(version),
        "rubric_version": _rubric_response(rubric),
    }


async def clone_version(
    session: AsyncSession,
    course_id: str,
    body: CourseVersionCloneRequest,
    current_user: str,
) -> dict[str, Any]:
    now = utcnow()
    try:
        async with session.begin():
            course = await session.scalar(
                select(Course).where(Course.id == course_id).with_for_update()
            )
            if course is None:
                raise ApiError(404, "NOT_FOUND", "课程不存在")

            source = await session.scalar(
                select(CourseVersion).where(
                    CourseVersion.id == body.source_version_id
                )
            )
            if source is None or source.course_id != course.id:
                raise ApiError(404, "NOT_FOUND", "来源版本不存在")
            if source.status is CourseVersionStatus.draft:
                raise ApiError(
                    409,
                    "STATE_CONFLICT",
                    "草稿版本不能作为克隆来源，请直接修改草稿",
                    {"current_status": source.status.value},
                )

            source_rubric = await session.scalar(
                select(RubricVersion).where(
                    RubricVersion.course_version_id == source.id
                )
            )
            if source_rubric is None:
                raise ApiError(500, "INTERNAL_ERROR", "来源版本缺少评分规则")

            max_version_no = await session.scalar(
                select(func.max(CourseVersion.version_no)).where(
                    CourseVersion.course_id == course.id
                )
            )
            version = CourseVersion(
                id=new_id("crv"),
                course_id=course.id,
                version_no=int(max_version_no or 0) + 1,
                status=CourseVersionStatus.draft,
                content=deepcopy(source.content),
                revision=1,
                created_by=current_user,
                created_at=now,
                updated_at=now,
            )
            rubric = RubricVersion(
                id=new_id("rbn"),
                course_version_id=version.id,
                version_no=1,
                rules=deepcopy(source_rubric.rules),
                created_at=now,
            )
            session.add_all([version, rubric])
    except IntegrityError as exc:
        raise ApiError(409, "STATE_CONFLICT", "版本号冲突，请重试") from exc

    return {
        "course": {
            "id": course.id,
            "sku_code": course.sku_code,
            "name": course.name,
            "created_by": course.created_by,
            "created_at": iso_utc(course.created_at),
        },
        "version": _version_response(version),
        "rubric_version": _rubric_response(rubric),
    }


async def update_version(
    session: AsyncSession,
    version_id: str,
    body: CourseVersionUpdateRequest,
) -> dict[str, Any]:
    now = utcnow()
    async with session.begin():
        version = await session.scalar(
            select(CourseVersion)
            .where(CourseVersion.id == version_id)
            .with_for_update()
        )
        if version is None:
            raise ApiError(404, "NOT_FOUND", "课程版本不存在")
        if version.status is not CourseVersionStatus.draft:
            raise ApiError(409, "VERSION_IMMUTABLE", "已审校或已发布版本不可修改")
        if version.revision != body.expected_revision:
            raise ApiError(
                409,
                "VERSION_CONFLICT",
                "课程草稿已被更新，请刷新后重试",
                {
                    "expected_revision": body.expected_revision,
                    "current_revision": version.revision,
                },
            )
        version.content = body.content.model_dump(mode="json", exclude_none=True)
        version.revision += 1
        version.updated_at = now

    return _version_summary(version)


async def review_version(
    session: AsyncSession,
    version_id: str,
    body: CourseReviewRequest,
    current_user: User,
    request_id: str,
) -> dict[str, Any]:
    now = utcnow()
    async with session.begin():
        version = await session.scalar(
            select(CourseVersion)
            .where(CourseVersion.id == version_id)
            .with_for_update()
        )
        if version is None:
            raise ApiError(404, "NOT_FOUND", "课程版本不存在")
        if version.status is not CourseVersionStatus.draft:
            raise ApiError(
                409,
                "STATE_CONFLICT",
                "当前状态不允许审校",
                {"current_status": version.status.value},
            )

        rubric = await session.scalar(
            select(RubricVersion).where(
                RubricVersion.course_version_id == version.id
            )
        )
        if rubric is None:
            raise ApiError(500, "INTERNAL_ERROR", "课程版本缺少评分规则")
        ensure_rubric_compatible(rubric.rules)

        checklist = body.checklist.model_dump()
        pending = [name for name, confirmed in checklist.items() if not confirmed]
        if pending:
            raise ApiError(
                422,
                "REVIEW_CHECKLIST_INCOMPLETE",
                "审校清单未全部确认",
                {"pending": pending},
            )

        version.status = CourseVersionStatus.approved
        version.reviewed_by = current_user.id
        version.reviewed_at = now
        version.updated_at = now
        session.add(
            AuditEvent(
                actor_user_id=current_user.id,
                action=AuditAction.course_reviewed,
                entity_type="course_version",
                entity_id=version.id,
                store_id=None,
                payload={"checklist": checklist, "note": body.note},
                request_id=request_id,
            )
        )

    return {
        "id": version.id,
        "status": version.status.value,
        "revision": version.revision,
        "reviewed_by": user_brief(current_user),
        "reviewed_at": iso_utc(now),
    }


def _release_target_payload(
    store: Store,
    assigned_count: int,
) -> dict[str, Any]:
    return {
        "store_id": store.id,
        "store_name": store.name,
        "assigned_count": assigned_count,
    }


async def _roster_by_store(
    session: AsyncSession, store_ids: list[str]
) -> dict[str, list[str]]:
    rows = (
        await session.execute(
            select(StoreMembership.store_id, User.id)
            .join(User, User.id == StoreMembership.user_id)
            .where(
                StoreMembership.store_id.in_(store_ids),
                StoreMembership.active.is_(True),
                StoreMembership.role == MembershipRole.staff,
                User.active.is_(True),
                User.role == UserRole.staff,
            )
            .order_by(StoreMembership.store_id, User.id)
        )
    ).all()
    roster = {store_id: [] for store_id in store_ids}
    user_stores: dict[str, list[str]] = {}
    for store_id, user_id in rows:
        roster[store_id].append(user_id)
        user_stores.setdefault(user_id, []).append(store_id)
    ambiguous = sorted(
        user_id for user_id, stores in user_stores.items() if len(stores) > 1
    )
    if ambiguous:
        raise ApiError(
            422,
            "AMBIGUOUS_STAFF_STORE",
            "同一员工属于多个目标门店",
            {"user_ids": ambiguous},
        )
    return roster


async def publish_version(
    session: AsyncSession,
    version_id: str,
    body: PublishRequest,
    current_user: User,
    request: Request,
) -> JSONResponse:
    """定向发布。幂等记录与批次、门店、应训名单、审计同事务提交。"""
    key = require_idempotency_key(request)
    route = request.url.path
    key_hash = hash_value(key)
    request_hash = hash_payload(body.model_dump(mode="json"))
    user_id = current_user.id

    try:
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

            # 发布还要更新同课程的其他版本。先锁定课程行，让同课程发布和
            # 克隆按同一顺序串行化；否则两个发布各锁目标版本后再互锁，
            # InnoDB 会以 1213 死锁回滚其中一个请求。
            course_id = await session.scalar(
                select(CourseVersion.course_id).where(
                    CourseVersion.id == version_id
                )
            )
            if course_id is None:
                raise ApiError(404, "NOT_FOUND", "课程版本不存在")
            await session.scalar(
                select(Course.id).where(Course.id == course_id).with_for_update()
            )
            # 首次快照读取可能发生在同键事务提交前，等待课程锁期间原事务
            # 可能已完成并被新版本替代。此时必须用锁定读复查幂等记录，
            # 否则会把成功的原发布误判为 superseded / STATE_CONFLICT。
            replay = await replay_or_clear(
                session,
                user_id=user_id,
                route=route,
                key_hash=key_hash,
                request_hash=request_hash,
                lock=True,
            )
            if replay is not None:
                return replay
            version = await session.scalar(
                select(CourseVersion)
                .where(CourseVersion.id == version_id)
                .with_for_update()
            )
            if version is None:
                raise ApiError(404, "NOT_FOUND", "课程版本不存在")
            if version.status not in COURSE_READY_STATUSES:
                raise ApiError(
                    409,
                    "STATE_CONFLICT",
                    "课程版本尚未审校通过，不能发布",
                    {"current_status": version.status.value},
                )
            if version.revision != body.expected_revision:
                raise ApiError(
                    409,
                    "VERSION_CONFLICT",
                    "课程版本已变更，请刷新后重试",
                    {
                        "expected_revision": body.expected_revision,
                        "current_revision": version.revision,
                    },
                )

            rubric = await session.scalar(
                select(RubricVersion).where(
                    RubricVersion.course_version_id == version.id
                )
            )
            if rubric is None:
                raise ApiError(500, "INTERNAL_ERROR", "课程版本缺少评分规则")
            ensure_rubric_compatible(rubric.rules)

            stores = (
                await session.scalars(
                    select(Store).where(Store.id.in_(body.store_ids))
                )
            ).all()
            store_by_id = {store.id: store for store in stores}
            missing = [
                store_id for store_id in body.store_ids if store_id not in store_by_id
            ]
            inactive = [
                store_id
                for store_id in body.store_ids
                if store_id in store_by_id and not store_by_id[store_id].active
            ]
            if missing or inactive:
                raise ApiError(
                    422,
                    "VALIDATION_ERROR",
                    "目标门店不存在或已停用",
                    {
                        "fields": [
                            {
                                "loc": ["body", "store_ids"],
                                "msg": "目标门店不存在或已停用",
                                "type": "value_error",
                                "missing": missing,
                                "inactive": inactive,
                            }
                        ]
                    },
                )

            roster = await _roster_by_store(session, body.store_ids)
            now = utcnow()
            published_at = now
            release = Release(
                id=new_id("rls"),
                course_version_id=version.id,
                rubric_version_id=rubric.id,
                status=ReleaseStatus.published,
                deadline_hours=body.deadline_hours,
                deadline_at=published_at + timedelta(hours=body.deadline_hours),
                published_by=current_user.id,
                published_at=published_at,
                created_at=now,
            )
            targets = [
                ReleaseTarget(
                    id=new_id("tgt"),
                    release_id=release.id,
                    store_id=store_id,
                )
                for store_id in body.store_ids
            ]
            assignments = [
                Assignment(
                    id=new_id("asg"),
                    release_id=release.id,
                    store_id=store_id,
                    user_id=staff_id,
                    assigned_at=now,
                    status=AssignmentStatus.not_started,
                    completed_chapter_count=0,
                    state_version=1,
                    updated_at=now,
                )
                for store_id in body.store_ids
                for staff_id in roster[store_id]
            ]

            if version.status is CourseVersionStatus.approved:
                version.status = CourseVersionStatus.published
            version.updated_at = now
            await session.execute(
                update(CourseVersion)
                .where(
                    CourseVersion.course_id == version.course_id,
                    CourseVersion.id != version.id,
                    CourseVersion.status == CourseVersionStatus.published,
                )
                .values(
                    status=CourseVersionStatus.superseded,
                    updated_at=now,
                )
            )
            session.add_all([release, *targets, *assignments])
            session.add(
                AuditEvent(
                    actor_user_id=current_user.id,
                    action=AuditAction.release_published,
                    entity_type="release",
                    entity_id=release.id,
                    store_id=body.store_ids[0] if len(body.store_ids) == 1 else None,
                    payload={
                        "course_id": version.course_id,
                        "course_version_id": version.id,
                        "store_ids": body.store_ids,
                        "assigned_total": len(assignments),
                        "deadline_hours": body.deadline_hours,
                    },
                    request_id=request.state.request_id,
                )
            )

            response_body = {
                "release": {
                    "id": release.id,
                    "course_version_id": release.course_version_id,
                    "rubric_version_id": release.rubric_version_id,
                    "status": release.status.value,
                    "published_by": user_brief(current_user),
                    "published_at": iso_utc(published_at),
                    "deadline_hours": release.deadline_hours,
                    "deadline_at": iso_utc(release.deadline_at),
                    "targets": [
                        _release_target_payload(
                            store_by_id[store_id],
                            len(roster[store_id]),
                        )
                        for store_id in body.store_ids
                    ],
                    "assigned_total": len(assignments),
                }
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
        # 相同幂等键并发提交时，后到事务因唯一键回滚业务写入后再重放。
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

    return JSONResponse(status_code=201, content=response_body)


async def get_release_detail(
    session: AsyncSession, release_id: str
) -> dict[str, Any]:
    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(
            selectinload(Release.course_version).selectinload(CourseVersion.course),
            selectinload(Release.publisher),
            selectinload(Release.targets).selectinload(ReleaseTarget.store),
            selectinload(Release.assignments),
        )
    )
    if release is None:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")

    assigned_by_store: dict[str, int] = {}
    for assignment in release.assignments:
        assigned_by_store[assignment.store_id] = (
            assigned_by_store.get(assignment.store_id, 0) + 1
        )
    window_end = release.published_at + timedelta(hours=48)
    qualified_in_window = sum(
        1
        for assignment in release.assignments
        if assignment.qualified_at is not None
        and release.published_at <= assignment.qualified_at < window_end
    )
    pending_review = sum(
        1
        for assignment in release.assignments
        if assignment.status is AssignmentStatus.pending_review
    )
    open_retrains = await session.scalar(
        select(func.count())
        .select_from(Retrain)
        .where(
            Retrain.release_id == release.id,
            Retrain.status.in_(
                (
                    RetrainStatus.pending,
                    RetrainStatus.submitted_unfixed,
                    RetrainStatus.fixed_pending_review,
                )
            ),
        )
    )

    return {
        "release": {
            "id": release.id,
            "course": {
                "id": release.course_version.course.id,
                "name": release.course_version.course.name,
            },
            "course_version_id": release.course_version_id,
            "rubric_version_id": release.rubric_version_id,
            "status": release.status.value,
            "published_by": user_brief(release.publisher),
            "published_at": iso_utc(release.published_at),
            "deadline_hours": release.deadline_hours,
            "deadline_at": iso_utc(release.deadline_at),
            "targets": [
                _release_target_payload(
                    target.store,
                    assigned_by_store.get(target.store_id, 0),
                )
                for target in sorted(release.targets, key=lambda item: item.store_id)
            ],
            "assigned_total": len(release.assignments),
            "qualified_in_window": qualified_in_window,
            "pending_review": pending_review,
            "open_retrains": int(open_retrains or 0),
        }
    }


async def list_release_assignees(
    session: AsyncSession,
    release_id: str,
    *,
    limit: int,
    offset: int,
) -> dict[str, Any]:
    release = await session.scalar(
        select(Release)
        .where(Release.id == release_id)
        .options(selectinload(Release.course_version))
    )
    if release is None:
        raise ApiError(404, "NOT_FOUND", "发布批次不存在")
    required_chapters = len(chapter_keys(release.course_version.content))

    stmt = (
        select(Assignment)
        .join(User, Assignment.user_id == User.id)
        .where(Assignment.release_id == release_id)
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
    items = []
    for assignment in window:
        items.append(
            {
                "assignment_id": assignment.id,
                "user": {
                    "id": assignment.user.id,
                    "name": assignment.user.name,
                    "active": assignment.user.active,
                },
                "store_id": assignment.store_id,
                "status": assignment.status.value,
                "completed_chapter_count": assignment.completed_chapter_count,
                "required_chapters": required_chapters,
                "last_score": assignment.last_score,
                "best_score": assignment.best_score,
                "qualified_at": iso_or_none(assignment.qualified_at),
                "open_retrain": open_retrain_payload(
                    open_retrain_for(assignment.retrains)
                ),
                "state_version": assignment.state_version,
            }
        )
    return {
        "items": items,
        "next_cursor": encode_cursor(offset + limit) if has_more else None,
    }