"""FastAPI 公共依赖：数据库会话、当前用户、角色和门店范围。

错误语义保持稳定：未登录 401，角色不足 403，资源超出范围 404。
越界资源统一返回 404，避免客户端通过状态码探测其他门店或草稿。
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import Database
from app.errors import ApiError
from app.models.identity import Store, UserRole
from app.services.auth import CurrentUser, load_current_user


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_database(request: Request) -> Database:
    return request.app.state.db


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    # 每个请求一个短会话；业务层负责 commit，请求结束自动关闭。
    database: Database = request.app.state.db
    async with database.sessionmaker() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
DbDep = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(request: Request, session: DbDep, settings: SettingsDep) -> CurrentUser:
    # 身份只来自 HttpOnly Cookie；请求头、查询参数和请求体都不参与身份判定。
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise ApiError(401, "AUTH_REQUIRED", "请先登录")
    status, current_user = await load_current_user(session, token)
    if current_user is not None:
        return current_user
    if status == "missing":
        raise ApiError(401, "AUTH_REQUIRED", "会话无效，请重新登录")
    raise ApiError(401, "SESSION_EXPIRED", "会话已过期，请重新登录")


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(
    *roles: UserRole,
) -> Callable[[CurrentUserDep], Awaitable[CurrentUser]]:
    """生成角色依赖，例如 Depends(require_roles(UserRole.hq_ops))。"""

    async def dependency(current_user: CurrentUserDep) -> CurrentUser:
        if not current_user.has_role(*roles):
            raise ApiError(403, "FORBIDDEN_ROLE", "当前角色无权执行该操作")
        return current_user

    return dependency


async def ensure_store_access(
    current_user: CurrentUser, store_id: str, session: AsyncSession
) -> None:
    """业务路由可复用的门店范围检查。

    总部需要确认门店确实存在；员工/店长只检查有效成员关系，
    两者在无权时都抛 404，不泄露资源是否存在。
    """
    if current_user.user.role is UserRole.hq_ops:
        store = await session.get(Store, store_id)
        if store is None or not store.active:
            raise ApiError(404, "NOT_FOUND", "门店不存在")
        return
    if not current_user.can_access_store(store_id):
        raise ApiError(404, "NOT_FOUND", "门店不存在或无权访问")


async def require_store_access(
    store_id: str,
    current_user: CurrentUserDep,
    session: DbDep,
) -> CurrentUser:
    """适合路径带 {store_id} 的路由直接 Depends 使用。"""
    await ensure_store_access(current_user, store_id, session)
    return current_user