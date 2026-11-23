"""写接口幂等键的读取、重放和落库。

幂等记录与业务写入使用同一个事务；相同键并发提交时由
(user_id, route, key_hash) 唯一键串行化，后到请求回滚业务写入后重放首次结果。
"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.models import IdempotencyRecord
from app.models.base import new_id, utcnow

IDEMPOTENCY_TTL = timedelta(hours=24)


def require_idempotency_key(request: Request) -> str:
    key = (request.headers.get("Idempotency-Key") or "").strip()
    if not key:
        raise ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "缺少 Idempotency-Key")
    if len(key) > 64:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "Idempotency-Key 最长 64 字符",
            {
                "fields": [
                    {
                        "loc": ["header", "idempotency-key"],
                        "msg": "Idempotency-Key 最长 64 字符",
                        "type": "value_error",
                    }
                ]
            },
        )
    return key


def hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_payload(payload: dict[str, Any]) -> str:
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hash_value(canonical)


async def replay_or_clear(
    session: AsyncSession,
    *,
    user_id: str,
    route: str,
    key_hash: str,
    request_hash: str,
) -> JSONResponse | None:
    """命中未过期记录时返回重放响应；过期记录清除后按新请求处理。"""
    record = await session.scalar(
        select(IdempotencyRecord).where(
            IdempotencyRecord.user_id == user_id,
            IdempotencyRecord.route == route,
            IdempotencyRecord.key_hash == key_hash,
        )
    )
    if record is None:
        return None
    if record.expires_at <= utcnow():
        await session.delete(record)
        # 同一事务后面可能用相同键写入新记录，先让 DELETE 落到数据库。
        await session.flush()
        return None
    if record.request_hash != request_hash:
        raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "相同幂等键用于不同请求体")
    return JSONResponse(
        status_code=record.status_code,
        content=record.response_body,
        headers={"Idempotent-Replay": "true"},
    )


def save_record(
    session: AsyncSession,
    *,
    user_id: str,
    route: str,
    key_hash: str,
    request_hash: str,
    status_code: int,
    response_body: dict[str, Any],
) -> None:
    now = utcnow()
    session.add(
        IdempotencyRecord(
            id=new_id("idm"),
            user_id=user_id,
            route=route,
            key_hash=key_hash,
            request_hash=request_hash,
            status_code=status_code,
            response_body=response_body,
            created_at=now,
            expires_at=now + IDEMPOTENCY_TTL,
        )
    )