"""会话令牌、Cookie 和时间格式工具。"""

import hashlib
import secrets
from datetime import UTC, datetime

from fastapi import Response

from app.config import Settings


def generate_session_token() -> str:
    """生成不可预测的 256 位随机令牌。"""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """数据库只存哈希；查询会话时用同一哈希定位。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def iso_utc(value: datetime) -> str:
    """统一输出带毫秒的 UTC ISO 8601，例如 2026-11-24T09:00:00.000Z。"""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    # HttpOnly + SameSite=Lax 防止脚本读取和大多数跨站表单提交；
    # HTTPS 环境由 Settings 强制加上 Secure。
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    """登出时同时清理浏览器 Cookie；服务端会话另行标记撤销。"""
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )