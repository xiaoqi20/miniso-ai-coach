"""员工本人学习任务、课程详情与章节完成接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, DbDep, require_roles
from app.models.identity import UserRole
from app.schemas.learning import ChapterCompleteRequest
from app.services import learning as learning_service
from app.services.common import decode_cursor

staff_router = APIRouter(prefix="/staff", tags=["staff-learning"])
StaffUserDep = Annotated[CurrentUser, Depends(require_roles(UserRole.staff))]


@staff_router.get("/assignments")
async def list_assignments(
    current_user: StaffUserDep,
    session: DbDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query()] = None,
) -> dict:
    return await learning_service.list_staff_assignments(
        session,
        current_user.user,
        limit=limit,
        offset=decode_cursor(cursor),
    )


@staff_router.get("/assignments/{assignment_id}")
async def get_assignment(
    assignment_id: str,
    current_user: StaffUserDep,
    session: DbDep,
) -> dict:
    return await learning_service.get_staff_assignment(
        session,
        current_user.user,
        assignment_id,
    )


@staff_router.post("/assignments/{assignment_id}/chapters/{chapter_key}/complete")
async def complete_chapter(
    assignment_id: str,
    chapter_key: str,
    current_user: StaffUserDep,
    session: DbDep,
    body: ChapterCompleteRequest | None = None,
) -> dict:
    # body 可为空对象；保留可选模型以拒绝未知字段。
    _ = body
    return await learning_service.complete_chapter(
        session,
        current_user.user,
        assignment_id,
        chapter_key,
    )