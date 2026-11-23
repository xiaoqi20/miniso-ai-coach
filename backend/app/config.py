"""运行配置。

配置只从环境变量和 backend/.env 读取。生产环境必须由部署平台注入
DATABASE_URL 等敏感值，仓库里只保留 .env.example。
"""

from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # running environment: development allows the dev-login route and seed data.
    app_env: Literal["development", "production"] = "development"
    dev_auth_enabled: bool = True
    # 多个前端调试地址用逗号分隔；生产环境只配置正式同域地址。
    app_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # 运行时使用 aiomysql；Alembic 使用同步 PyMySQL，避免迁移阶段引入事件循环。
    database_url: str = (
        "mysql+aiomysql://shouke:shouke_dev@127.0.0.1:3307/shouke?charset=utf8mb4"
    )
    alembic_database_url: str | None = None
    session_cookie_name: str = "sk_session"
    session_ttl_hours: int = 12
    cookie_secure: bool = False

    @property
    def allowed_origins(self) -> list[str]:
        """把逗号分隔的配置转换为 Origin 校验列表。"""
        return [origin.strip() for origin in self.app_origins.split(",") if origin.strip()]

    @property
    def sync_database_url(self) -> str:
        """供 Alembic 使用的同步连接串，默认复用运行时配置。"""
        if self.alembic_database_url:
            return self.alembic_database_url
        return self.database_url.replace("+aiomysql", "+pymysql")

    @model_validator(mode="after")
    def validate_environment(self) -> "Settings":
        if self.session_ttl_hours <= 0:
            raise ValueError("SESSION_TTL_HOURS must be positive")
        if self.app_env == "production":
            # 生产环境必须关闭开发登录，并强制安全 Cookie。
            # 这里让配置直接启动失败，避免误部署一个可伪造身份的入口。
            if self.dev_auth_enabled:
                raise ValueError("DEV_AUTH_ENABLED must be false when APP_ENV=production")
            self.cookie_secure = True
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()