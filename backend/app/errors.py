"""统一错误包装。

成功响应直接返回资源；失败统一为 {"error": {code, message, request_id, details}}。
业务代码抛 ApiError，框架校验错误和未捕获异常由这里的处理器转换。
"""

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("shouke.api")


class ApiError(Exception):
    """业务可预期的错误；code 是前端分支使用的稳定标识。"""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def _request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "req_unknown")


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    request_id = _request_id(request)
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "request_id": request_id,
                "details": details or {},
            }
        },
        headers={"X-Request-Id": request_id},
    )


async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return error_response(request, exc.status_code, exc.code, exc.message, exc.details)


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    # 只返回 loc/msg/type，避免把 Pydantic 内部对象或敏感输入值回显给客户端。
    fields = [
        {
            "loc": list(error.get("loc", [])),
            "msg": error.get("msg", "Invalid value"),
            "type": error.get("type", "value_error"),
        }
        for error in exc.errors()
    ]
    return error_response(
        request,
        422,
        "VALIDATION_ERROR",
        "请求字段不合法",
        {"fields": fields},
    )


async def http_exception_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    code_map = {
        401: ("AUTH_REQUIRED", "请先登录"),
        403: ("FORBIDDEN_ROLE", "当前角色无权执行该操作"),
        404: ("NOT_FOUND", "资源不存在"),
        405: ("METHOD_NOT_ALLOWED", "请求方法不被支持"),
    }
    code, message = code_map.get(
        exc.status_code, ("HTTP_ERROR", str(exc.detail) if exc.detail else "请求失败")
    )
    return error_response(request, exc.status_code, code, message)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # 日志保留完整堆栈，响应只给 request_id，避免泄漏内部细节。
    request_id = _request_id(request)
    logger.exception("unhandled error request_id=%s path=%s", request_id, request.url.path)
    return error_response(
        request,
        500,
        "INTERNAL_ERROR",
        "服务内部错误，请稍后重试",
    )