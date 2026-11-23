"""会话解析和当前用户上下文。

这个模块不信任任何客户端身份字段：只根据 Cookie 中的令牌哈希查 sessions 表，
再加载 users 和 store_memberships 得到角色与门店范围。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import Settings
from app.models.identity import StoreMembership, User, UserRole, UserSession
from app.models.base import utcnow
from app.schemas.auth import StoreRef, UserRef
from app.security import generate_session_token, hash_token

# 仅用于前端显隐；后端每个接口仍会独立校验角色和门店范围。
CAPABILITIES: dict[UserRole, list[str]] = {
    UserRole.staff: [
        "staff.assignment.read",
        "staff.progress.write",
        "staff.roleplay.submit",
    ],
    UserRole.store_manager: [
        "manager.release.read",
        "manager.retrain.issue",
        "manager.retrain.review",
        "manager.stats.read",
    ],
    UserRole.hq_ops: [
        "hq.course.manage",
        "hq.release.publish",
        "hq.stats.read",
    ],
}


@dataclass(frozen=True)
class CurrentUser:
    """一次请求内的身份快照，包含已过滤的有效成员关系。"""

    user: User
    memberships: tuple[StoreMembership, ...]
    session_id: str

    def has_role(self, *roles: UserRole) -> bool:
        return self.user.role in roles

    def can_access_store(self, store_id: str) -> bool:
        # 总部可跨门店读取；员工和店长只认有效成员关系。
        if self.user.role is UserRole.hq_ops:
            return True
        return any(membership.store_id == store_id for membership in self.memberships)


def capabilities_for(role: UserRole) -> list[str]:
    return CAPABILITIES[role]


def user_ref(user: User, memberships: tuple[StoreMembership, ...]) -> UserRef:
    """把 ORM 用户和成员关系转换成 API 响应对象。"""
    stores = [
        StoreRef(id=membership.store.id, name=membership.store.name, role=membership.role.value)
        for membership in sorted(memberships, key=lambda item: item.store_id)
    ]
    return UserRef(id=user.id, name=user.name, role=user.role.value, stores=stores)


def active_memberships(user: User) -> tuple[StoreMembership, ...]:
    return tuple(membership for membership in user.memberships if membership.active)


async def get_user_with_memberships(session: AsyncSession, user_id: str) -> User | None:
    """登录时一次性加载用户和门店，避免后续触发异步懒加载。"""
    result = await session.execute(
        select(User)
        .options(selectinload(User.memberships).selectinload(StoreMembership.store))
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def load_current_user(
    session: AsyncSession, token: str
) -> tuple[str, CurrentUser | None]:
    """返回 (状态, 用户上下文)。

    missing: Cookie 有值但数据库没有对应会话，通常是伪造或旧令牌；
    invalid: 会话存在但已过期、已撤销或用户已停用；
    ok: 身份和有效成员关系都可用。
    """
    result = await session.execute(
        select(UserSession)
        .options(
            selectinload(UserSession.user)
            .selectinload(User.memberships)
            .selectinload(StoreMembership.store)
        )
        .where(UserSession.token_hash == hash_token(token))
    )
    user_session = result.scalar_one_or_none()
    if user_session is None:
        return "missing", None
    if (
        user_session.revoked_at is not None
        or user_session.expires_at <= utcnow()
        or not user_session.user.active
    ):
        return "invalid", None
    memberships = active_memberships(user_session.user)
    return (
        "ok",
        CurrentUser(
            user=user_session.user,
            memberships=memberships,
            session_id=user_session.id,
        ),
    )


async def create_session(
    session: AsyncSession, user: User, settings: Settings
) -> tuple[str, UserSession]:
    """创建服务端会话，返回明文令牌和会话行；明文只下发给 Cookie。"""
    token = generate_session_token()
    user_session = UserSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
    )
    session.add(user_session)
    await session.flush()
    return token, user_session


async def revoke_session(session: AsyncSession, token: str) -> None:
    """撤销会话；重复登出保持幂等。"""
    result = await session.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    )
    user_session = result.scalar_one_or_none()
    if user_session is not None and user_session.revoked_at is None:
        user_session.revoked_at = utcnow()