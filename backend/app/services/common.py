"""跨业务路由共享的读模型、游标和展示格式。

分页游标对客户端是不透明字符串；M1 试点数据量小，内部使用偏移量编码，
避免在各列表接口重复实现排序和游标逻辑。
"""

from __future__ import annotations

import base64
import binascii
import json
from datetime import datetime
from typing import Any, Sequence, TypeVar

from pydantic import ValidationError

from app.errors import ApiError
from app.models import Retrain, RetrainStatus
from app.models.identity import User
from app.schemas.course import RubricRules
from app.security import iso_utc

T = TypeVar("T")

OPEN_RETRAIN_STATUSES = {
    RetrainStatus.pending,
    RetrainStatus.submitted_unfixed,
    RetrainStatus.fixed_pending_review,
}


def iso_or_none(value: datetime | None) -> str | None:
    return iso_utc(value) if value is not None else None


def user_brief(user: User) -> dict[str, str]:
    return {"id": user.id, "name": user.name}


def ensure_rubric_compatible(rules: dict[str, Any]) -> None:
    """拒绝会流入员工任务的已存不兼容规则。

    新建和改稿在 Pydantic 边界校验；这里补在审校、发布和评分前，
    防止历史数据或直接改库绕过维度约束后触发 500。
    """
    try:
        RubricRules.model_validate(rules)
    except ValidationError as exc:
        fields = [
            {
                "loc": ["rubric", *error.get("loc", ())],
                "msg": error.get("msg", "Invalid value"),
                "type": error.get("type", "value_error"),
            }
            for error in exc.errors()
        ]
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "评分规则不符合 M1 契约",
            {"fields": fields},
        ) from exc


def chapter_keys(content: dict[str, Any]) -> list[str]:
    chapters = content.get("chapters", [])
    if not isinstance(chapters, list):
        return []
    return [
        str(chapter["key"])
        for chapter in chapters
        if isinstance(chapter, dict) and chapter.get("key")
    ]


def open_retrain_for(retrains: Sequence[Retrain]) -> Retrain | None:
    """返回最近一条未结束的补训；唯一索引保证最多一条。"""
    for retrain in sorted(retrains, key=lambda item: (item.issued_at, item.id), reverse=True):
        if retrain.status in OPEN_RETRAIN_STATUSES:
            return retrain
    return None


def open_retrain_payload(retrain: Retrain | None) -> dict[str, Any] | None:
    if retrain is None:
        return None
    return {
        "id": retrain.id,
        "status": retrain.status.value,
        "focus": {
            "fact_key": retrain.focus_fact_key,
            "label": retrain.focus_fact_label,
        },
        "issued_at": iso_utc(retrain.issued_at),
        "version": retrain.version,
    }


def encode_cursor(offset: int) -> str:
    payload = json.dumps({"offset": offset}, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    if not cursor:
        return 0
    try:
        padding = "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        offset = payload["offset"]
        if not isinstance(offset, int) or offset < 0:
            raise ValueError("invalid offset")
        return offset
    except (binascii.Error, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "cursor 不合法",
            {
                "fields": [
                    {
                        "loc": ["query", "cursor"],
                        "msg": "cursor 不合法",
                        "type": "value_error",
                    }
                ]
            },
        ) from exc


def page_items(items: Sequence[T], limit: int, offset: int) -> tuple[list[T], str | None]:
    window = list(items[offset : offset + limit])
    next_cursor = encode_cursor(offset + limit) if offset + limit < len(items) else None
    return window, next_cursor