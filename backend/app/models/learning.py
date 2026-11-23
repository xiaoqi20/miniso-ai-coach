"""员工应训任务、章节进度和读模型状态。

assignments 既是发布时的应训名单快照，也是员工首页需要的物化读模型：
status 由章节、正式成绩和补训状态推导后写入，列表查询不必每次聚合。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import (
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
from app.models.course import Release
from app.models.identity import Store, User


class AssignmentStatus(str, Enum):
    """覆盖学习、对练和补训的完整任务状态；具体迁移见 m1.md 第 5 节。"""

    not_started = "not_started"
    learning = "learning"
    ready_for_roleplay = "ready_for_roleplay"
    failed = "failed"
    passed = "passed"
    retrain_pending = "retrain_pending"
    retrain_unfixed = "retrain_unfixed"
    pending_review = "pending_review"
    verified = "verified"


class Assignment(Base):
    """发布批次中的一条应训记录。

    qualified_at 一旦写入不再回退，48 小时统计只读这个字段；
    后续补训、复查确认或继续练习都不能改写历史通关时间。
    """

    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("asg"))
    release_id: Mapped[str] = mapped_column(ForeignKey("releases.id"), nullable=False)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    status: Mapped[AssignmentStatus] = mapped_column(
        SAEnum(AssignmentStatus, validate_strings=True),
        default=AssignmentStatus.not_started,
        nullable=False,
    )
    completed_chapter_count: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    last_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    best_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    first_passed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    qualified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    state_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    release: Mapped[Release] = relationship(back_populates="assignments")
    store: Mapped[Store] = relationship()
    user: Mapped[User] = relationship()
    chapter_progress: Mapped[list[ChapterProgress]] = relationship(
        back_populates="assignment", order_by="ChapterProgress.completed_at"
    )
    roleplay_session: Mapped["RoleplaySession | None"] = relationship(
        back_populates="assignment", uselist=False
    )
    retrains: Mapped[list["Retrain"]] = relationship(back_populates="assignment")

    __table_args__ = (
        UniqueConstraint("release_id", "user_id", name="uq_assignments_release_user"),
        Index("ix_assignments_store_release_status", "store_id", "release_id", "status"),
        Index("ix_assignments_user_release", "user_id", "release_id"),
        Index("ix_assignments_release_qualified", "release_id", "qualified_at"),
    )


class ChapterProgress(Base):
    """章节完成是单向事实；唯一键保证重复上报不会产生第二条记录。"""

    __tablename__ = "chapter_progress"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("chp"))
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), nullable=False)
    chapter_key: Mapped[str] = mapped_column(String(32), nullable=False)
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    assignment: Mapped[Assignment] = relationship(back_populates="chapter_progress")

    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "chapter_key", name="uq_chapter_progress_assignment_chapter"
        ),
    )