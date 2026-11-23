"""课程、评分规则与发布请求。

课程内容和评分规则是不可变版本的一部分，入口处先做结构校验：
章节 key 必须唯一，评分维度与权重必须一一对应，必考事实键不能重复。
Pydantic 只负责请求边界；版本状态、审校与发布的业务规则在服务层处理。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChapterContent(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    key: str = Field(min_length=1, max_length=32)
    short: str = ""
    title: str = Field(min_length=1)
    preview: str = ""
    speech: str = Field(min_length=1)
    actions: list[str] = Field(default_factory=list)
    mantra: str = ""


class CourseContent(BaseModel):
    model_config = ConfigDict(extra="allow")

    product: dict[str, Any]
    chapters: list[ChapterContent] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_chapters(self) -> "CourseContent":
        if not str(self.product.get("name", "")).strip():
            raise ValueError("product.name 不能为空")
        keys = [chapter.key for chapter in self.chapters]
        if len(set(keys)) != len(keys):
            raise ValueError("章节 key 必须唯一")
        return self


class RequiredFactRule(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    key: str = Field(min_length=1, max_length=32)
    label: str = Field(min_length=1)
    type: Literal["price", "groups"]
    patterns: list[str] | None = None
    groups: list[list[str]] | None = None
    negation_guard: bool | None = None

    @model_validator(mode="after")
    def validate_shape(self) -> "RequiredFactRule":
        if self.type == "price":
            if not self.patterns:
                raise ValueError("price 必考事实必须提供 patterns")
        elif not self.groups or any(not group for group in self.groups):
            raise ValueError("groups 必考事实必须提供非空 groups")
        return self


class DimensionRule(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    label: str = Field(min_length=1)
    keywords: list[str] = Field(min_length=1)


class RedlineRule(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    term: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ScenarioRule(BaseModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    persona_name: str = Field(min_length=1)
    persona_style: str = Field(min_length=1)
    question: str = Field(min_length=1)
    alt_question: str = Field(min_length=1)
    happy_reply: str = Field(min_length=1)
    concern_reply: str = Field(min_length=1)


class RubricRules(BaseModel):
    model_config = ConfigDict(extra="allow")

    schema_version: int = Field(default=1, ge=1)
    pass_threshold: int = Field(ge=0, le=100)
    weights: dict[str, float]
    required_facts: list[RequiredFactRule] = Field(min_length=1)
    dimensions: dict[str, DimensionRule]
    redlines: list[RedlineRule] = Field(default_factory=list)
    scenario: ScenarioRule
    average_pitch: str = Field(min_length=1)
    demo_pitch: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_consistency(self) -> "RubricRules":
        fact_keys = [fact.key for fact in self.required_facts]
        if len(set(fact_keys)) != len(fact_keys):
            raise ValueError("必考事实 key 必须唯一")
        if set(self.weights) != set(self.dimensions):
            raise ValueError("weights 与 dimensions 的维度必须一一对应")
        if any(weight < 0 or weight > 1 for weight in self.weights.values()):
            raise ValueError("权重必须在 0 到 1 之间")
        if abs(sum(self.weights.values()) - 1.0) > 0.001:
            raise ValueError("权重之和必须为 1")
        return self


class CourseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    sku_code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    content: CourseContent
    rubric: RubricRules


class CourseVersionCloneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    source_version_id: str = Field(min_length=1, max_length=40)


class CourseVersionUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    content: CourseContent


class ReviewChecklist(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price_verified: bool
    spec_verified: bool
    redline_verified: bool


class CourseReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    checklist: ReviewChecklist
    note: str | None = Field(default=None, max_length=2000)


class PublishRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    store_ids: list[str] = Field(min_length=1, max_length=50)
    deadline_hours: int = Field(ge=1, le=168)
    expected_revision: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_store_ids(self) -> "PublishRequest":
        if any(not store_id or len(store_id) > 40 for store_id in self.store_ids):
            raise ValueError("store_ids 包含非法门店 ID")
        if len(set(self.store_ids)) != len(self.store_ids):
            raise ValueError("store_ids 不能重复")
        return self