"""课程版本、评分规则版本与发布批次。

版本关系是本模块最重要的不变量：
- course_version 审校后不可变；
- rubric_version 与 course_version 一对一且不可变；
- release 永久绑定发布时的两个版本，并持有应训名单快照。
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
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, new_id, utcnow


class CourseVersionStatus(str, Enum):
    draft = "draft"
    approved = "approved"
    published = "published"
    superseded = "superseded"


class ReleaseStatus(str, Enum):
    published = "published"
    closed = "closed"


class Course(Base):
    """课程逻辑主体；具体内容放在 course_versions。"""

    __tablename__ = "courses"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("crs"))
    sku_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    versions: Mapped[list[CourseVersion]] = relationship(back_populates="course")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])


class CourseVersion(Base):
    """课程内容快照。

    draft 可以按 revision 乐观锁修改；approved/published 后内容冻结。
    需要改稿时创建新的 version_no，旧发布批次继续引用旧版本。
    """

    __tablename__ = "course_versions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("crv"))
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[CourseVersionStatus] = mapped_column(
        SAEnum(CourseVersionStatus, validate_strings=True),
        default=CourseVersionStatus.draft,
        nullable=False,
    )
    content: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    course: Mapped[Course] = relationship(back_populates="versions")
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
    rubric_version: Mapped["RubricVersion | None"] = relationship(
        back_populates="course_version", uselist=False
    )
    releases: Mapped[list["Release"]] = relationship(back_populates="course_version")

    __table_args__ = (
        UniqueConstraint("course_id", "version_no", name="uq_course_versions_course_version"),
        Index("ix_course_versions_status", "status"),
    )


class RubricVersion(Base):
    """评分规则快照；新增同义表达必须发新版本，不在运行时改旧规则。"""

    __tablename__ = "rubric_versions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rbn"))
    course_version_id: Mapped[str] = mapped_column(
        ForeignKey("course_versions.id"), unique=True, nullable=False
    )
    version_no: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    rules: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    course_version: Mapped[CourseVersion] = relationship(back_populates="rubric_version")
    releases: Mapped[list["Release"]] = relationship(back_populates="rubric_version")


class Release(Base):
    """一次定向发布。

    published_at 是 48 小时统计的唯一时间锚点；deadline_at 只用于任务展示，
    两者不能混用。发布后版本、门店名单和应训快照都不再回写。
    """

    __tablename__ = "releases"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rls"))
    course_version_id: Mapped[str] = mapped_column(
        ForeignKey("course_versions.id"), nullable=False
    )
    rubric_version_id: Mapped[str] = mapped_column(
        ForeignKey("rubric_versions.id"), nullable=False
    )
    status: Mapped[ReleaseStatus] = mapped_column(
        SAEnum(ReleaseStatus, validate_strings=True),
        default=ReleaseStatus.published,
        nullable=False,
    )
    deadline_hours: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    deadline_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    published_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    published_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    course_version: Mapped[CourseVersion] = relationship(back_populates="releases")
    rubric_version: Mapped[RubricVersion] = relationship(back_populates="releases")
    publisher: Mapped["User"] = relationship(foreign_keys=[published_by])
    targets: Mapped[list["ReleaseTarget"]] = relationship(back_populates="release")
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="release")

    __table_args__ = (
        Index("ix_releases_course_version_id", "course_version_id"),
        Index("ix_releases_published_at", "published_at"),
    )


class ReleaseTarget(Base):
    """发布批次的目标门店；真正的应训名单在 assignments 快照中。"""

    __tablename__ = "release_targets"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tgt"))
    release_id: Mapped[str] = mapped_column(ForeignKey("releases.id"), nullable=False)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"), nullable=False)

    release: Mapped[Release] = relationship(back_populates="targets")
    store: Mapped["Store"] = relationship()

    __table_args__ = (
        UniqueConstraint("release_id", "store_id", name="uq_release_targets_release_store"),
        Index("ix_release_targets_store_release", "store_id", "release_id"),
    )