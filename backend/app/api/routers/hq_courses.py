"""总部课程、版本、审校、发布与发布批次接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.api.deps import CurrentUser, DbDep, require_roles
from app.models.identity import UserRole
from app.schemas.course import (
    CourseCreateRequest,
    CourseReviewRequest,
    CourseVersionCloneRequest,
    CourseVersionUpdateRequest,
    PublishRequest,
)
from app.services import courses as course_service
from app.services import manager as manager_service
from app.services.common import decode_cursor

hq_router = APIRouter(prefix="/hq", tags=["hq-courses"])
HqUserDep = Annotated[CurrentUser, Depends(require_roles(UserRole.hq_ops))]


@hq_router.get("/courses")
async def list_courses(
    current_user: HqUserDep,
    session: DbDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> dict:
    return await course_service.list_courses(
        session,
        limit=limit,
        offset=decode_cursor(cursor),
    )


@hq_router.post("/courses", status_code=201)
async def create_course(
    body: CourseCreateRequest,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.create_course(
        session,
        body,
        current_user.user.id,
    )


@hq_router.get("/courses/{course_id}")
async def get_course(
    course_id: str,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.get_course_detail(session, course_id)


@hq_router.post("/courses/{course_id}/versions", status_code=201)
async def clone_course_version(
    course_id: str,
    body: CourseVersionCloneRequest,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.clone_version(
        session,
        course_id,
        body,
        current_user.user.id,
    )


@hq_router.put("/course-versions/{version_id}")
async def update_course_version(
    version_id: str,
    body: CourseVersionUpdateRequest,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.update_version(session, version_id, body)


@hq_router.post("/course-versions/{version_id}/review")
async def review_course_version(
    version_id: str,
    body: CourseReviewRequest,
    request: Request,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.review_version(
        session,
        version_id,
        body,
        current_user.user,
        request.state.request_id,
    )


@hq_router.post("/course-versions/{version_id}/publish", status_code=201)
async def publish_course_version(
    version_id: str,
    body: PublishRequest,
    request: Request,
    current_user: HqUserDep,
    session: DbDep,
) -> JSONResponse:
    return await course_service.publish_version(
        session,
        version_id,
        body,
        current_user.user,
        request,
    )


@hq_router.get("/releases/{release_id}")
async def get_release(
    release_id: str,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await course_service.get_release_detail(session, release_id)


@hq_router.get("/releases/{release_id}/assignees")
async def list_release_assignees(
    release_id: str,
    current_user: HqUserDep,
    session: DbDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> dict:
    return await course_service.list_release_assignees(
        session,
        release_id,
        limit=limit,
        offset=decode_cursor(cursor),
    )


@hq_router.get("/releases/{release_id}/stats")
async def get_release_stats(
    release_id: str,
    current_user: HqUserDep,
    session: DbDep,
) -> dict:
    return await manager_service.get_release_stats(
        session,
        release_id,
        allowed_store_ids=None,
    )