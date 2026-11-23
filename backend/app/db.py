"""数据库引擎与会话工厂。

每个应用进程只创建一个 Engine；AsyncSession 按请求短生命周期使用。
测试使用共享内存 SQLite，生产/本地开发使用 MySQL + aiomysql。
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool


class Database:
    def __init__(self, url: str) -> None:
        kwargs: dict = {}
        if url.startswith("sqlite"):
            # 测试库使用 StaticPool，让所有 AsyncSession 共享同一个内存数据库；
            # 否则每个连接都会看到一份独立的空库。
            kwargs = {
                "poolclass": StaticPool,
                "connect_args": {"check_same_thread": False},
            }
        else:
            # pool_recycle 小于 MySQL wait_timeout，pool_pre_ping 负责回收失效连接。
            kwargs = {
                "pool_size": 5,
                "max_overflow": 10,
                "pool_timeout": 30,
                "pool_recycle": 240,
                "pool_pre_ping": True,
                "connect_args": {"connect_timeout": 5},
            }
        self.engine = create_async_engine(url, **kwargs)
        # expire_on_commit=False 避免提交后访问 ORM 属性触发隐式 IO；
        # autoflush=False 让业务代码显式控制 flush，便于短事务审计。
        self.sessionmaker = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )

    async def dispose(self) -> None:
        """应用关闭时释放连接池。"""
        await self.engine.dispose()