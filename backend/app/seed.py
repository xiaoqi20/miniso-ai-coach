"""开发种子：两家门店、三种角色、一款草稿新品。

种子函数是幂等的：已存在的门店、用户、成员关系和课程不会重复插入；
需要在干净库上重建时，先执行迁移，再运行 `python -m app.seed`。
"""

import asyncio

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import Database
from app.models.course import Course, CourseVersion, CourseVersionStatus, RubricVersion
from app.models.identity import Store, StoreMembership, User
from app.seed_data import (
    COURSE_CONTENT,
    COURSE_ID,
    COURSE_VERSION_ID,
    RUBRIC_RULES,
    RUBRIC_VERSION_ID,
    SKU_CODE,
    STORES,
    USERS,
)


async def seed_foundation(session: AsyncSession) -> dict[str, int]:
    """写入最小可重复的开发基线，并返回各表计数。"""
    # 先写门店，再写用户和成员关系；显式 ID 让前后端样例保持稳定。
    for store_data in STORES:
        if await session.get(Store, store_data["id"]) is None:
            session.add(Store(**store_data))

    for user_data in USERS:
        if await session.get(User, user_data["id"]) is None:
            session.add(
                User(
                    id=user_data["id"],
                    name=user_data["name"],
                    role=user_data["role"],
                    active=True,
                )
            )
        store_id = user_data.get("store_id")
        if not store_id:
            continue
        membership = await session.scalar(
            select(StoreMembership).where(
                StoreMembership.user_id == user_data["id"],
                StoreMembership.store_id == store_id,
            )
        )
        if membership is None:
            session.add(
                StoreMembership(
                    user_id=user_data["id"],
                    store_id=store_id,
                    role=user_data["membership_role"],
                    active=True,
                )
            )

    # 课程、版本和规则版本分表保存；这里只放一个 draft，
    # 发布批次由 T008 通过业务接口创建，种子不预置已发布任务。
    if await session.get(Course, COURSE_ID) is None:
        session.add(
            Course(
                id=COURSE_ID,
                sku_code=SKU_CODE,
                name=COURSE_CONTENT["product"]["name"],
                created_by="usr_linmin",
            )
        )

    if await session.get(CourseVersion, COURSE_VERSION_ID) is None:
        session.add(
            CourseVersion(
                id=COURSE_VERSION_ID,
                course_id=COURSE_ID,
                version_no=1,
                status=CourseVersionStatus.draft,
                content=COURSE_CONTENT,
                revision=1,
                created_by="usr_linmin",
            )
        )

    if await session.get(RubricVersion, RUBRIC_VERSION_ID) is None:
        session.add(
            RubricVersion(
                id=RUBRIC_VERSION_ID,
                course_version_id=COURSE_VERSION_ID,
                version_no=1,
                rules=RUBRIC_RULES,
            )
        )

    await session.flush()
    counts = {
        "stores": await session.scalar(select(func.count()).select_from(Store)),
        "users": await session.scalar(select(func.count()).select_from(User)),
        "memberships": await session.scalar(select(func.count()).select_from(StoreMembership)),
        "courses": await session.scalar(select(func.count()).select_from(Course)),
        "course_versions": await session.scalar(
            select(func.count()).select_from(CourseVersion)
        ),
        "rubric_versions": await session.scalar(
            select(func.count()).select_from(RubricVersion)
        ),
    }
    await session.commit()
    return {key: int(value or 0) for key, value in counts.items()}


async def main() -> None:
    settings = get_settings()
    # 与开发登录使用同一道环境开关，防止生产环境误装载测试身份。
    if settings.app_env != "development" or not settings.dev_auth_enabled:
        raise SystemExit(
            "开发种子只能在 APP_ENV=development 且 DEV_AUTH_ENABLED=true 时执行"
        )
    database = Database(settings.database_url)
    async with database.sessionmaker() as session:
        counts = await seed_foundation(session)
    await database.dispose()
    print(f"seed ok: {counts}")


if __name__ == "__main__":
    asyncio.run(main())