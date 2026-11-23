"""员工对练会话、预览、恢复和正式轮次接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.api.deps import CurrentUser, DbDep, require_roles
from app.models.identity import UserRole
from app.schemas.roleplay import RoleplayPreviewRequest, RoleplayRoundRequest
from app.services import roleplay as roleplay_service

roleplay_router = APIRouter(prefix="/staff", tags=["staff-roleplay"])
StaffUserDep = Annotated[CurrentUser, Depends(require_roles(UserRole.staff))]


@roleplay_router.post(
    "/assignments/{assignment_id}/roleplay-sessions",
    status_code=201,
)
async def create_roleplay_session(
    assignment_id: str,
    response: Response,
    current_user: StaffUserDep,
    session: DbDep,
) -> dict:
    payload, status_code = await roleplay_service.create_or_get_session(
        session,
        current_user.user,
        assignment_id,
    )
    response.status_code = status_code
    return payload


@roleplay_router.post("/assignments/{assignment_id}/roleplay-preview")
async def preview_roleplay(
    assignment_id: str,
    body: RoleplayPreviewRequest,
    current_user: StaffUserDep,
    session: DbDep,
) -> dict:
    return await roleplay_service.preview_answer(
        session,
        current_user.user,
        assignment_id,
        body,
    )


@roleplay_router.get("/roleplay-sessions/{session_id}")
async def get_roleplay_session(
    session_id: str,
    current_user: StaffUserDep,
    session: DbDep,
) -> dict:
    return await roleplay_service.get_session(
        session,
        current_user.user,
        session_id,
    )


@roleplay_router.post(
    "/roleplay-sessions/{session_id}/rounds",
    status_code=201,
)
async def submit_roleplay_round(
    session_id: str,
    body: RoleplayRoundRequest,
    current_user: StaffUserDep,
    session: DbDep,
) -> dict:
    return await roleplay_service.submit_round(
        session,
        current_user.user,
        session_id,
        body,
    )