"""ORM 公共基类、时间类型和 ID 生成。

这里集中处理三个容易在不同数据库/迁移工具间产生差异的点：
1. 约束命名规范，保证 Alembic batch 迁移能稳定引用约束；
2. UTC 时间在应用层是带时区的 datetime，在 MySQL 中存无时区 UTC；
3. 运行时 ID 使用“类型前缀 + ULID”，便于日志和跨表排查。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, MetaData
from sqlalchemy.dialects import mysql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator
from ulid import ULID

# 统一约束名，避免后续 Alembic 自动生成迁移时出现无法回滚的匿名约束。
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(column_0_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def utcnow() -> datetime:
    """业务代码统一使用带时区的 UTC 时间，避免依赖服务器本地时区。"""
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    """生成带类型前缀的字符串 ID，例如 rls_01J...。"""
    return f"{prefix}_{ULID()}"


class UTCDateTime(TypeDecorator[datetime]):
    """UTC 时间类型。

    MySQL 使用 DATETIME(3) 保留毫秒，SQLite 测试库退回普通 DATETIME。
    写入时统一转为 UTC 后去掉 tzinfo，读取时再补回 UTC 时区。
    """

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect: Any):
        if dialect.name == "mysql":
            return dialect.type_descriptor(mysql.DATETIME(fsp=3))
        return dialect.type_descriptor(DateTime())

    def process_bind_param(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect: Any) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class TimestampMixin:
    """需要创建/更新时间的基础混入；时间由应用写入，不用数据库本地时钟。"""

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )