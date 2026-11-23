"""FastAPI 应用工厂。

启动时只装配配置、数据库、错误处理和公共路由；业务路由由 T003-T005
在自己的模块中注册到 create_app 的 include_router 列表。
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from ulid import ULID

from app.api.routers.auth import auth_router, dev_router, identity_router
from app.api.routers.health import health_router
from app.config import Settings, get_settings
from app.db import Database
from app.errors import (
    ApiError,
    api_error_handler,
    error_response,
    http_exception_handler,
    unhandled_exception_handler,
    validation_error_handler,
)

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
JSON_MEDIA_TYPE = "application/json"


def _has_json_content_type(request: Request) -> bool:
    """只取媒体类型部分，允许 application/json; charset=utf-8。"""
    content_type = request.headers.get("content-type", "")
    return content_type.split(";", 1)[0].strip().lower() == JSON_MEDIA_TYPE


def create_app(settings: Settings | None = None) -> FastAPI:
    """创建应用。

    传入 settings 便于测试使用独立 SQLite；不传时读取 .env/环境变量。
    """
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        # 进程退出时释放连接池，避免测试或多实例运行留下连接。
        await app.state.db.dispose()

    app = FastAPI(
        title="MINISO 门店培训 API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = Database(settings.database_url)

    # 所有错误（包括未捕获异常）都走统一 error 包装，前端只需处理一种结构。
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        # 请求 ID 会写入错误响应和 X-Request-Id，便于联调时定位日志。
        request.state.request_id = f"req_{ULID()}"
        origin = request.headers.get("origin")
        if request.method in UNSAFE_METHODS:
            if origin and origin not in settings.allowed_origins:
                # 浏览器跨站 POST 在这里被拒绝；无 Origin 的 curl/测试客户端仍可用。
                return error_response(
                    request,
                    403,
                    "CSRF_ORIGIN_REJECTED",
                    "请求来源不受信任",
                )
            if not _has_json_content_type(request):
                # 契约要求所有写请求使用 application/json，无正文的登出等
                # 写操作也必须显式携带该头；契约未单列媒体类型错误码，
                # 统一归入 VALIDATION_ERROR，并定位到 header.content-type。
                return error_response(
                    request,
                    422,
                    "VALIDATION_ERROR",
                    "写请求必须使用 application/json",
                    {
                        "fields": [
                            {
                                "loc": ["header", "content-type"],
                                "msg": "写请求必须使用 application/json",
                                "type": "value_error",
                            }
                        ]
                    },
                )
        response = await call_next(request)
        response.headers["X-Request-Id"] = request.state.request_id
        return response

    app.include_router(health_router)
    app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
    app.include_router(identity_router, prefix="/api/v1", tags=["identity"])
    # 生产环境不注册该路由，访问直接得到 404，不暴露开发入口。
    if settings.app_env == "development" and settings.dev_auth_enabled:
        app.include_router(dev_router, prefix="/api/v1/auth", tags=["dev-auth"])
    return app


app = create_app()