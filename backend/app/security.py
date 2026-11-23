"""会话令牌、Cookie 和时间格式工具。"""

import hashlib
import secrets
from datetime import UTC, datetime

from fastapi import Request, Response

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


def request_is_https(request: Request) -> bool:
    """判断浏览器侧是否 HTTPS。

    直接 TLS 时 ASGI scheme 为 https；反向代理终止 TLS 时读取
    X-Forwarded-Proto 的第一个值。该判断只影响 Cookie 安全属性，
    不参与身份或权限判断。
    """
    # 直接 TLS 已经确定是 HTTPS，不能被客户端伪造的转发头降级；
    # 只有应用侧仍是 HTTP 时，才读取反向代理的 X-Forwarded-Proto。
    if request.url.scheme == "https":
        return True
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    return forwarded_proto.split(",", 1)[0].strip().lower() == "https"


def _cookie_secure(settings: Settings, request: Request) -> bool:
    # 生产配置强制 Secure；开发环境也按实际协议，HTTPS 下必须加 Secure，
    # 不能只依赖 COOKIE_SECURE 开关。
    return settings.cookie_secure or request_is_https(request)


def set_session_cookie(
    response: Response, settings: Settings, request: Request, token: str
) -> None:
    # HttpOnly + SameSite=Lax 防止脚本读取和大多数跨站表单提交。
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(settings, request),
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings, request: Request) -> None:
    """登出时同时清理浏览器 Cookie；服务端会话另行标记撤销。"""
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        samesite="lax",
        secure=_cookie_secure(settings, request),
        path="/",
    )
