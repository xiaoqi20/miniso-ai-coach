"""身份、门店成员关系和服务端会话。

权限判断只依赖这里的 users.role 和 store_memberships；
请求体永远不能直接声称自己是某个角色或某家门店。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, Enum as SAEnum, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, new_id, utcnow


class UserRole(str, Enum):
    staff = "staff"
    store_manager = "store_manager"
    hq_ops = "hq_ops"


class MembershipRole(str, Enum):
    staff = "staff"
    store_manager = "store_manager"


class Store(Base):
    """门店主数据；active=false 的门店不再接受新的发布或访问。"""

    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("store"))
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    memberships: Mapped[list[StoreMembership]] = relationship(back_populates="store")


class User(Base):
    """登录主体；wecom_userid 留给 M2 企微身份映射。"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("usr"))
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, validate_strings=True),
        nullable=False,
    )
    wecom_userid: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    memberships: Mapped[list[StoreMembership]] = relationship(back_populates="user")
    sessions: Mapped[list[UserSession]] = relationship(back_populates="user")

    __table_args__ = (Index("ix_users_role", "role"),)


class StoreMembership(Base):
    """用户与门店的成员关系，是员工/店长数据范围的唯一来源。"""

    __tablename__ = "store_memberships"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mem"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"), nullable=False)
    role: Mapped[MembershipRole] = mapped_column(
        SAEnum(MembershipRole, validate_strings=True),
        nullable=False,
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="memberships")
    store: Mapped[Store] = relationship(back_populates="memberships")

    __table_args__ = (
        UniqueConstraint("user_id", "store_id", name="uq_store_memberships_user_store"),
        Index("ix_store_memberships_store_active_role", "store_id", "active", "role"),
    )


class UserSession(Base):
    """服务端会话。

    数据库只保存令牌的 SHA-256，不保存明文；即使库被读取也无法直接冒充用户。
    会话过期使用绝对时间，登出或管理员撤销时写 revoked_at。
    """

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ses"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")

    __table_args__ = (Index("ix_sessions_expires_at", "expires_at"),)