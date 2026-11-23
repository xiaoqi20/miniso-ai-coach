"""对练预览与正式轮次请求。"""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

QuestionVariantLiteral = Literal["default", "alt"]


class RoleplayPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    answer_text: str = Field(min_length=1)
    question_variant: QuestionVariantLiteral = "default"


class RoleplayRoundRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    client_round_id: str = Field(min_length=1, max_length=36)
    answer_text: str = Field(min_length=1)
    question_variant: QuestionVariantLiteral = "default"

    @field_validator("client_round_id")
    @classmethod
    def normalize_client_round_id(cls, value: str) -> str:
        try:
            return str(UUID(value))
        except ValueError as exc:
            raise ValueError("client_round_id 必须是 UUID") from exc