"""T003 测试共用的课程与发布辅助函数。"""

from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from httpx import AsyncClient

from app.seed_data import COURSE_CONTENT, COURSE_VERSION_ID, RUBRIC_RULES
from tests.conftest import login

REVIEW_CHECKLIST = {
    "price_verified": True,
    "spec_verified": True,
    "redline_verified": True,
}


def course_payload(
    *,
    sku: str = "MINISO-TEST-01",
    name: str = "测试课程",
) -> dict:
    content = deepcopy(COURSE_CONTENT)
    content["product"]["name"] = name
    return {
        "sku_code": sku,
        "name": name,
        "content": content,
        "rubric": deepcopy(RUBRIC_RULES),
    }


async def review_version(
    client: AsyncClient,
    version_id: str = COURSE_VERSION_ID,
    *,
    checklist: dict | None = None,
    note: str = "已核对零售价、规格与话术红线",
):
    return await client.post(
        f"/api/v1/hq/course-versions/{version_id}/review",
        json={"checklist": checklist or REVIEW_CHECKLIST, "note": note},
    )


async def publish_version(
    client: AsyncClient,
    version_id: str = COURSE_VERSION_ID,
    *,
    store_ids: tuple[str, ...] = ("store_bj",),
    deadline_hours: int = 48,
    expected_revision: int = 1,
    key: str | None = None,
):
    return await client.post(
        f"/api/v1/hq/course-versions/{version_id}/publish",
        headers={"Idempotency-Key": key or uuid4().hex},
        json={
            "store_ids": list(store_ids),
            "deadline_hours": deadline_hours,
            "expected_revision": expected_revision,
        },
    )


async def publish_seed_course(
    client: AsyncClient,
    *,
    store_ids: tuple[str, ...] = ("store_bj",),
    key: str | None = None,
) -> dict:
    await login(client, "usr_linmin")
    reviewed = await review_version(client)
    assert reviewed.status_code == 200, reviewed.text
    published = await publish_version(client, store_ids=store_ids, key=key)
    assert published.status_code == 201, published.text
    return published.json()["release"]