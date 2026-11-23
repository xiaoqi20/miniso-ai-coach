"""Alembic 环境配置。

迁移使用同步 PyMySQL 连接（与运行时的 aiomysql 共用同一个库）；
DB URL 从应用配置读取，不写死在 alembic.ini。
"""

from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

from app.config import get_settings
from app.models import Base
from app.models.base import UTCDateTime

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings = get_settings()
config.set_main_option("sqlalchemy.url", settings.sync_database_url)

target_metadata = Base.metadata


def render_item(type_, obj, autogen_context):
    # UTCDateTime 是应用自定义类型；迁移脚本里渲染为 MySQL DATETIME(3)，
    # 保证毫秒精度与模型在 MySQL 上的实际类型一致。
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "mysql.DATETIME(fsp=3)"
    return False


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # batch 模式让同一份迁移也能在 SQLite 上执行；
        # compare_type/default 只用于生成草稿，最终仍由人工审阅。
        render_as_batch=True,
        compare_type=True,
        compare_server_default=True,
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            compare_type=True,
            compare_server_default=True,
            render_item=render_item,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()