from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app
from app.models import Base
from app.seed import seed_foundation


@pytest.fixture
def settings() -> Settings:
    # 单元测试使用共享内存 SQLite，避免依赖本机 MySQL；
    # 迁移和 MySQL 约束由 README 中的 alembic 验证步骤覆盖。
    return Settings(
        _env_file=None,
        app_env="development",
        dev_auth_enabled=True,
        app_origins="http://testserver",
        database_url="sqlite+aiosqlite://",
        cookie_secure=False,
    )


@pytest.fixture
async def app(settings: Settings):
    application = create_app(settings)
    async with application.state.db.engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with application.state.db.sessionmaker() as session:
        await seed_foundation(session)
    yield application
    await application.state.db.dispose()


@pytest.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as http_client:
        yield http_client


async def login(client: AsyncClient, user_id: str):
    """测试助手的登录入口，与前端一样通过开发身份换取服务端 Cookie。"""
    response = await client.post("/api/v1/auth/dev-login", json={"user_id": user_id})
    assert response.status_code == 200, response.text
    return response