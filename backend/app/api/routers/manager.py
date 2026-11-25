"""店长看板、补训指派、人工复查与 48 小时统计路由。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.api.deps import CurrentUser, DbDep, require_roles
from app.models.identity import UserRole
from app.schemas.manager import IssueRetrainRequest, ReviewRetrainRequest
from app.services import manager as manager_service
from app.services.common import decode_cursor

manager_router = APIRouter(prefix="/manager", tags=["manager"])
ManagerUserDep = Annotated[CurrentUser, Depends(require_roles(UserRole.store_manager))]


def _managed_store_ids(current_user: CurrentUser) -> set[str]:
    """提取店长当前有效的管辖门店 ID 集合。"""
    return {membership.store_id for membership in current_user.memberships}


@manager_router.get("/releases")
async def list_releases(
    current_user: ManagerUserDep,
    session: DbDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> dict:
    return await manager_service.list_manager_releases(
        session,
        _managed_store_ids(current_user),
        limit=limit,
        offset=decode_cursor(cursor),
    )


@manager_router.get("/releases/{release_id}")
async def get_release(
    release_id: str,
    current_user: ManagerUserDep,
    session: DbDep,
) -> dict:
    return await manager_service.get_manager_release_detail(
        session,
        release_id,
        _managed_store_ids(current_user),
    )


@manager_router.get("/releases/{release_id}/assignees")
async def list_release_assignees(
    release_id: str,
    current_user: ManagerUserDep,
    session: DbDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> dict:
    return await manager_service.list_manager_release_assignees(
        session,
        release_id,
        _managed_store_ids(current_user),
        limit=limit,
        offset=decode_cursor(cursor),
    )


@manager_router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: str,
    current_user: ManagerUserDep,
    session: DbDep,
) -> dict:
    return await manager_service.get_manager_assignment_detail(
        session,
        assignment_id,
        _managed_store_ids(current_user),
    )


@manager_router.post("/assignments/{assignment_id}/retrains", status_code=201)
async def issue_retrain(
    assignment_id: str,
    body: IssueRetrainRequest,
    request: Request,
    current_user: ManagerUserDep,
    session: DbDep,
) -> JSONResponse:
    return await manager_service.issue_retrain(
        session,
        assignment_id,
        body,
        current_user.user,
        _managed_store_ids(current_user),
        request,
    )


@manager_router.post("/retrains/{retrain_id}/review")
async def review_retrain(
    retrain_id: str,
    body: ReviewRetrainRequest,
    request: Request,
    current_user: ManagerUserDep,
    session: DbDep,
) -> JSONResponse:
    return await manager_service.review_retrain(
        session,
        retrain_id,
        body,
        current_user.user,
        _managed_store_ids(current_user),
        request,
    )


@manager_router.get("/releases/{release_id}/stats")
async def get_release_stats(
    release_id: str,
    current_user: ManagerUserDep,
    session: DbDep,
) -> dict:
    return await manager_service.get_release_stats(
        session,
        release_id,
        allowed_store_ids=_managed_store_ids(current_user),
    )
