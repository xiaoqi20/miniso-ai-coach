"""文字对练、正式成绩、补训和复查。

关键不变量：
- 一个 assignment 只有一条 roleplay_session，刷新/重启后按轮次恢复；
- client_round_id 是轮次幂等键，重复提交返回同一轮；
- roleplay_attempts 是正式成绩，只新增不修改；
- 补训通过生成的 open_flag 唯一索引保证同一任务最多一条进行中补训。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Computed,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UTCDateTime, new_id, utcnow
from app.models.course import CourseVersion, Release, RubricVersion
from app.models.identity import User
from app.models.learning import Assignment


class RoundStatus(str, Enum):
    scoring = "scoring"
    scored = "scored"
    failed = "failed"


class QuestionVariant(str, Enum):
    default = "default"
    alt = "alt"


class AnswerSource(str, Enum):
    text = "text"
    voice = "voice"


class RetrainStatus(str, Enum):
    pending = "pending"
    submitted_unfixed = "submitted_unfixed"
    fixed_pending_review = "fixed_pending_review"
    verified = "verified"


class RoleplaySession(Base):
    """员工与某次发布任务的对练会话；last_round_no 用于并发分配轮次。"""

    __tablename__ = "roleplay_sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rps"))
    assignment_id: Mapped[str] = mapped_column(
        ForeignKey("assignments.id"), unique=True, nullable=False
    )
    course_version_id: Mapped[str] = mapped_column(
        ForeignKey("course_versions.id"), nullable=False
    )
    rubric_version_id: Mapped[str] = mapped_column(
        ForeignKey("rubric_versions.id"), nullable=False
    )
    last_round_no: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )

    assignment: Mapped[Assignment] = relationship(back_populates="roleplay_session")
    course_version: Mapped[CourseVersion] = relationship()
    rubric_version: Mapped[RubricVersion] = relationship()
    rounds: Mapped[list[RoleplayRound]] = relationship(
        back_populates="session", order_by="RoleplayRound.round_no"
    )


class RoleplayRound(Base):
    """一次提交的原始作答。

    (session_id, client_round_id) 唯一，保证客户端重试不会生成重复轮次；
    评分失败时保留这一行，客户端可用同一 client_round_id 重试评分。
    """

    __tablename__ = "roleplay_rounds"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rnd"))
    session_id: Mapped[str] = mapped_column(ForeignKey("roleplay_sessions.id"), nullable=False)
    round_no: Mapped[int] = mapped_column(Integer, nullable=False)
    client_round_id: Mapped[str] = mapped_column(String(36), nullable=False)
    question_variant: Mapped[QuestionVariant] = mapped_column(
        SAEnum(QuestionVariant, validate_strings=True),
        default=QuestionVariant.default,
        nullable=False,
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_text: Mapped[str] = mapped_column(Text, nullable=False)
    answer_source: Mapped[AnswerSource] = mapped_column(
        SAEnum(AnswerSource, validate_strings=True),
        default=AnswerSource.text,
        nullable=False,
    )
    status: Mapped[RoundStatus] = mapped_column(
        SAEnum(RoundStatus, validate_strings=True),
        default=RoundStatus.scoring,
        nullable=False,
    )
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    scored_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    session: Mapped[RoleplaySession] = relationship(back_populates="rounds")
    attempt: Mapped["RoleplayAttempt | None"] = relationship(
        back_populates="round", uselist=False
    )

    __table_args__ = (
        UniqueConstraint(
            "session_id", "round_no", name="uq_roleplay_rounds_session_round"
        ),
        UniqueConstraint(
            "session_id", "client_round_id", name="uq_roleplay_rounds_session_client"
        ),
        Index("ix_roleplay_rounds_status_submitted", "status", "submitted_at"),
    )


class RoleplayAttempt(Base):
    """正式成绩，不可变。

    模型只提供候选证据，Python 业务层核验并计算 total/passed 后写入；
    演示话术预览不写本表，避免示例分数污染正式成绩和统计。
    """

    __tablename__ = "roleplay_attempts"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("att"))
    round_id: Mapped[str] = mapped_column(
        ForeignKey("roleplay_rounds.id"), unique=True, nullable=False
    )
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), nullable=False)
    release_id: Mapped[str] = mapped_column(ForeignKey("releases.id"), nullable=False)
    rubric_version_id: Mapped[str] = mapped_column(
        ForeignKey("rubric_versions.id"), nullable=False
    )
    total: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    dims: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    fact_checks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    missed_required_facts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    missed_facts: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    redline_hits: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    round: Mapped[RoleplayRound] = relationship(back_populates="attempt")
    assignment: Mapped[Assignment] = relationship()
    release: Mapped[Release] = relationship()
    rubric_version: Mapped[RubricVersion] = relationship()

    __table_args__ = (
        Index("ix_roleplay_attempts_assignment_computed", "assignment_id", "computed_at"),
        Index(
            "ix_roleplay_attempts_release_passed_computed",
            "release_id",
            "passed",
            "computed_at",
        ),
    )


class Retrain(Base):
    """店长指派的补训与后续复查。

    baseline_round_no 固化发起时的轮次水位，只有之后的正式轮次才能推进本补训；
    evidence_attempt_id 在待复查时冻结，店长只能基于该证据确认或驳回。
    """

    __tablename__ = "retrains"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("rtn"))
    assignment_id: Mapped[str] = mapped_column(ForeignKey("assignments.id"), nullable=False)
    release_id: Mapped[str] = mapped_column(ForeignKey("releases.id"), nullable=False)
    focus_fact_key: Mapped[str] = mapped_column(String(32), nullable=False)
    focus_fact_label: Mapped[str] = mapped_column(String(128), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[RetrainStatus] = mapped_column(
        SAEnum(RetrainStatus, validate_strings=True),
        default=RetrainStatus.pending,
        nullable=False,
    )
    baseline_round_no: Mapped[int] = mapped_column(Integer, nullable=False)
    evidence_round_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evidence_attempt_id: Mapped[str | None] = mapped_column(
        ForeignKey("roleplay_attempts.id"), nullable=True
    )
    issued_by: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # MySQL 不支持部分唯一索引，用生成列把“进行中”映射为 1，
# verified 后变为 NULL；唯一键 (assignment_id, open_flag) 允许多个 NULL，
# 因此同一任务最多只能有一条未结束的补训。
    open_flag: Mapped[int | None] = mapped_column(
        SmallInteger,
        Computed(
            "CASE WHEN status IN "
            "('pending','submitted_unfixed','fixed_pending_review') "
            "THEN 1 ELSE NULL END",
            persisted=True,
        ),
        nullable=True,
    )

    assignment: Mapped[Assignment] = relationship(back_populates="retrains")
    release: Mapped[Release] = relationship()
    issuer: Mapped[User] = relationship(foreign_keys=[issued_by])
    reviewer: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by])
    evidence_attempt: Mapped["RoleplayAttempt | None"] = relationship()

    __table_args__ = (
        UniqueConstraint("assignment_id", "open_flag", name="uq_retrains_assignment_open"),
        Index("ix_retrains_assignment_issued", "assignment_id", "issued_at"),
        Index("ix_retrains_status", "status"),
    )