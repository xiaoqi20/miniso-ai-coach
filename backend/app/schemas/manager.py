"""店长补训指派与人工复查请求模型。"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class IssueRetrainRequest(BaseModel):
    """店长指派补训请求体；身份与门店只从服务端会话读取。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    focus_fact_key: str = Field(min_length=1, max_length=32)
    note: str = Field(default="", max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def normalize_note(cls, value: object) -> object:
        return "" if value is None else value


class ReviewRetrainRequest(BaseModel):
    """店长确认或驳回复查请求体。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    decision: Literal["confirm", "reject"]
    expected_version: int = Field(ge=1)
    evidence_attempt_id: str | None = Field(default=None, min_length=1, max_length=40)
    note: str = Field(default="", max_length=2000)

    @field_validator("note", mode="before")
    @classmethod
    def normalize_note(cls, value: object) -> object:
        return "" if value is None else value

    @field_validator("expected_version", mode="before")
    @classmethod
    def reject_bool_version(cls, value: object) -> object:
        # Python 中 bool 是 int 的子类，拒绝把 true/false 误当作版本号。
        if isinstance(value, bool):
            raise ValueError("expected_version 必须是正整数")
        return value

    @model_validator(mode="after")
    def validate_confirm_evidence(self) -> "ReviewRetrainRequest":
        if self.decision == "confirm" and not self.evidence_attempt_id:
            raise ValueError("确认复查必须提供 evidence_attempt_id")
        return self
