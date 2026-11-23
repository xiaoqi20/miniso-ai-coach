"""审计日志与幂等记录。

audit_events 只追加，用于回答“谁在什么时间审校、发布、指派或确认了复查”；
idempotency_records 保存首次响应，保证发布/补训/复查重复提交得到同一结果。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import (
    JSON,
    Enum as SAEnum,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, UTCDateTime, new_id, utcnow


class AuditAction(str, Enum):
    course_reviewed = "course.reviewed"
    release_published = "release.published"
    retrain_issued = "retrain.issued"
    retrain_confirmed = "retrain.confirmed"
    retrain_rejected = "retrain.rejected"


class AuditEvent(Base):
    """关键人工操作的不可变审计记录。"""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("aud"))
    actor_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    # 审计动作对外使用带点号的稳定编码（如 course.reviewed），
    # 必须显式按枚举值入库，不能使用 Python 成员名。
    action: Mapped[AuditAction] = mapped_column(
        SAEnum(
            AuditAction,
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
            validate_strings=True,
        ),
        nullable=False,
    )
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(40), nullable=False)
    store_id: Mapped[str | None] = mapped_column(ForeignKey("stores.id"), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    request_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_audit_events_entity_created", "entity_type", "entity_id", "created_at"),
        Index("ix_audit_events_actor_created", "actor_user_id", "created_at"),
    )


class IdempotencyRecord(Base):
    """按“用户 + 路由 + 幂等键”保存首次响应，默认保留 24 小时。"""

    __tablename__ = "idempotency_records"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("idm"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    route: Mapped[str] = mapped_column(String(128), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    response_body: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "user_id", "route", "key_hash", name="uq_idempotency_records_user_route_key"
        ),
        Index("ix_idempotency_records_expires_at", "expires_at"),
    )