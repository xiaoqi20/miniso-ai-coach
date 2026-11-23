from copy import deepcopy
from datetime import timedelta

from sqlalchemy import func, select

from app.models import (
    Assignment,
    AssignmentStatus,
    AuditAction,
    AuditEvent,
    CourseVersion,
    CourseVersionStatus,
    MembershipRole,
    Release,
    ReleaseTarget,
    Retrain,
    RetrainStatus,
    RubricVersion,
    Store,
    StoreMembership,
    User,
    UserRole,
)
from app.seed_data import (
    COURSE_CONTENT,
    COURSE_ID,
    COURSE_VERSION_ID,
    RUBRIC_RULES,
    RUBRIC_VERSION_ID,
)
from tests.conftest import login
from tests.helpers import (
    course_payload,
    incompatible_rubric,
    publish_seed_course,
    publish_version,
    review_version,
)


async def test_hq_course_create_list_and_detail(client):
    await login(client, "usr_linmin")

    listing = await client.get("/api/v1/hq/courses")
    assert listing.status_code == 200
    seed_item = next(
        item for item in listing.json()["items"] if item["course_id"] == COURSE_ID
    )
    assert seed_item["latest_version"]["status"] == "draft"
    assert seed_item["published_release_count"] == 0

    created = await client.post("/api/v1/hq/courses", json=course_payload())
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["version"]["version_no"] == 1
    assert body["version"]["status"] == "draft"
    assert body["version"]["revision"] == 1
    assert body["rubric_version"]["course_version_id"] == body["version"]["id"]

    detail = await client.get(f"/api/v1/hq/courses/{body['course']['id']}")
    assert detail.status_code == 200
    versions = detail.json()["versions"]
    assert len(versions) == 1
    assert versions[0]["content"]["chapters"][0]["key"] == "ch1"
    assert versions[0]["rubric"]["pass_threshold"] == 85
    assert versions[0]["reviewed_by"] is None

    duplicate = await client.post("/api/v1/hq/courses", json=course_payload())
    assert duplicate.status_code == 422
    assert duplicate.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_clone_source_must_belong_to_course(client):
    await login(client, "usr_linmin")
    created = await client.post(
        "/api/v1/hq/courses",
        json=course_payload(sku="MINISO-OTHER-COURSE", name="另一门课程"),
    )
    assert created.status_code == 201
    other_course_id = created.json()["course"]["id"]

    wrong_course = await client.post(
        f"/api/v1/hq/courses/{other_course_id}/versions",
        json={"source_version_id": COURSE_VERSION_ID},
    )
    assert wrong_course.status_code == 404
    assert wrong_course.json()["error"]["code"] == "NOT_FOUND"

    missing_source = await client.post(
        f"/api/v1/hq/courses/{COURSE_ID}/versions",
        json={"source_version_id": "crv_missing"},
    )
    assert missing_source.status_code == 404
    assert missing_source.json()["error"]["code"] == "NOT_FOUND"


async def test_review_requires_checklist_and_writes_audit(client, app):
    await login(client, "usr_linmin")

    incomplete = await review_version(
        client,
        checklist={
            "price_verified": True,
            "spec_verified": False,
            "redline_verified": True,
        },
    )
    assert incomplete.status_code == 422
    error = incomplete.json()["error"]
    assert error["code"] == "REVIEW_CHECKLIST_INCOMPLETE"
    assert error["details"]["pending"] == ["spec_verified"]

    reviewed = await review_version(client)
    assert reviewed.status_code == 200, reviewed.text
    body = reviewed.json()
    assert body["status"] == "approved"
    assert body["revision"] == 1
    assert body["reviewed_by"] == {"id": "usr_linmin", "name": "林敏"}

    async with app.state.db.sessionmaker() as session:
        version = await session.get(CourseVersion, COURSE_VERSION_ID)
        assert version.status is CourseVersionStatus.approved
        assert version.reviewed_by == "usr_linmin"
        count = await session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.action == AuditAction.course_reviewed)
        )
    assert count == 1


async def test_publish_snapshot_and_release_reads(client, app):
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200

    published = await publish_version(client, key="publish-bj")
    assert published.status_code == 201, published.text
    release = published.json()["release"]
    assert release["status"] == "published"
    assert release["published_by"] == {"id": "usr_linmin", "name": "林敏"}
    assert release["targets"] == [
        {
            "store_id": "store_bj",
            "store_name": "北京路旗舰店",
            "assigned_count": 3,
        }
    ]
    assert release["assigned_total"] == 3
    release_id = release["id"]

    async with app.state.db.sessionmaker() as session:
        assignment_users = set(
            (
                await session.scalars(
                    select(Assignment.user_id).where(
                        Assignment.release_id == release_id
                    )
                )
            ).all()
        )
        version = await session.get(CourseVersion, COURSE_VERSION_ID)
        audit = await session.scalar(
            select(AuditEvent).where(
                AuditEvent.action == AuditAction.release_published
            )
        )
        target_count = await session.scalar(
            select(func.count())
            .select_from(ReleaseTarget)
            .where(ReleaseTarget.release_id == release_id)
        )
    assert assignment_users == {
        "usr_linxiaomei",
        "usr_chenajie",
        "usr_wangxiaoxue",
    }
    assert version.status is CourseVersionStatus.published
    assert audit.actor_user_id == "usr_linmin"
    assert audit.store_id == "store_bj"
    assert audit.entity_id == release_id
    assert target_count == 1

    detail = await client.get(f"/api/v1/hq/releases/{release_id}")
    assert detail.status_code == 200
    release_detail = detail.json()["release"]
    assert release_detail["course"] == {
        "id": COURSE_ID,
        "name": "Chiikawa 联名毛绒公仔盲盒",
    }
    assert release_detail["assigned_total"] == 3
    assert release_detail["qualified_in_window"] == 0
    assert release_detail["pending_review"] == 0
    assert release_detail["open_retrains"] == 0

    listing = await client.get("/api/v1/hq/courses")
    seed_item = next(
        item for item in listing.json()["items"] if item["course_id"] == COURSE_ID
    )
    assert seed_item["latest_version"]["status"] == "published"
    assert seed_item["published_release_count"] == 1

    course_detail = await client.get(f"/api/v1/hq/courses/{COURSE_ID}")
    published_version = course_detail.json()["versions"][0]
    assert published_version["status"] == "published"
    assert published_version["reviewed_by"] == {"id": "usr_linmin", "name": "林敏"}

    assignees = await client.get(f"/api/v1/hq/releases/{release_id}/assignees")
    assert assignees.status_code == 200
    items = assignees.json()["items"]
    assert {item["user"]["id"] for item in items} == assignment_users
    assert all(item["required_chapters"] == 3 for item in items)
    assert all(item["status"] == "not_started" for item in items)
    assert all(item["state_version"] == 1 for item in items)


async def test_inactive_user_is_excluded_from_roster(client, app):
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200

    async with app.state.db.sessionmaker() as session:
        user = await session.get(User, "usr_wangxiaoxue")
        user.active = False
        await session.commit()

    published = await publish_version(client, key="inactive-user")
    assert published.status_code == 201, published.text
    assert published.json()["release"]["assigned_total"] == 2

    async with app.state.db.sessionmaker() as session:
        users = set(
            (
                await session.scalars(
                    select(Assignment.user_id).where(
                        Assignment.release_id
                        == published.json()["release"]["id"]
                    )
                )
            ).all()
        )
    assert users == {"usr_linxiaomei", "usr_chenajie"}


async def test_publish_to_multiple_stores(client, app):
    release = await publish_seed_course(
        client,
        store_ids=("store_bj", "store_fs"),
        key="multi-store",
    )
    assert release["assigned_total"] == 5
    assert release["targets"] == [
        {
            "store_id": "store_bj",
            "store_name": "北京路旗舰店",
            "assigned_count": 3,
        },
        {
            "store_id": "store_fs",
            "store_name": "佛山祖庙百货店",
            "assigned_count": 2,
        },
    ]
    async with app.state.db.sessionmaker() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(Assignment)
            .where(Assignment.release_id == release["id"])
        )
    assert count == 5


async def test_publish_idempotency_and_validation(client, app):
    await login(client, "usr_linmin")

    draft_publish = await publish_version(client, key="draft-key")
    assert draft_publish.status_code == 409
    assert draft_publish.json()["error"]["code"] == "STATE_CONFLICT"
    assert draft_publish.json()["error"]["details"]["current_status"] == "draft"

    assert (await review_version(client)).status_code == 200

    missing_key = await client.post(
        f"/api/v1/hq/course-versions/{COURSE_VERSION_ID}/publish",
        json={
            "store_ids": ["store_bj"],
            "deadline_hours": 48,
            "expected_revision": 1,
        },
    )
    assert missing_key.status_code == 400
    assert missing_key.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    first = await publish_version(client, key="same-key")
    assert first.status_code == 201, first.text
    first_release_id = first.json()["release"]["id"]

    replay = await publish_version(client, key="same-key")
    assert replay.status_code == 201, replay.text
    assert replay.headers["Idempotent-Replay"] == "true"
    assert replay.json()["release"]["id"] == first_release_id

    reused = await publish_version(
        client,
        store_ids=("store_fs",),
        key="same-key",
    )
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"

    stale = await publish_version(
        client,
        key="other-key",
        expected_revision=99,
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"
    assert stale.json()["error"]["details"]["current_revision"] == 1

    async with app.state.db.sessionmaker() as session:
        count = await session.scalar(select(func.count()).select_from(Release))
    assert count == 1


async def test_version_clone_update_and_supersede(client, app):
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200
    first_publish = await publish_version(client, key="v1-publish")
    assert first_publish.status_code == 201, first_publish.text
    first_release_id = first_publish.json()["release"]["id"]

    cloned = await client.post(
        f"/api/v1/hq/courses/{COURSE_ID}/versions",
        json={"source_version_id": COURSE_VERSION_ID},
    )
    assert cloned.status_code == 201, cloned.text
    cloned_body = cloned.json()
    v2 = cloned_body["version"]
    assert v2["version_no"] == 2
    assert v2["status"] == "draft"
    assert v2["revision"] == 1
    assert cloned_body["rubric_version"]["course_version_id"] == v2["id"]

    course_detail = await client.get(f"/api/v1/hq/courses/{COURSE_ID}")
    v2_detail = next(
        version for version in course_detail.json()["versions"] if version["id"] == v2["id"]
    )
    assert v2_detail["content"] == COURSE_CONTENT
    assert v2_detail["rubric"] == RUBRIC_RULES

    draft_clone = await client.post(
        f"/api/v1/hq/courses/{COURSE_ID}/versions",
        json={"source_version_id": v2["id"]},
    )
    assert draft_clone.status_code == 409
    assert draft_clone.json()["error"]["code"] == "STATE_CONFLICT"

    changed_content = deepcopy(COURSE_CONTENT)
    changed_content["product"]["summary"] = "更新后的摘要"
    updated = await client.put(
        f"/api/v1/hq/course-versions/{v2['id']}",
        json={"expected_revision": 1, "content": changed_content},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["revision"] == 2

    stale = await client.put(
        f"/api/v1/hq/course-versions/{v2['id']}",
        json={"expected_revision": 1, "content": changed_content},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"

    assert (await review_version(client, v2["id"])).status_code == 200
    immutable = await client.put(
        f"/api/v1/hq/course-versions/{v2['id']}",
        json={"expected_revision": 2, "content": changed_content},
    )
    assert immutable.status_code == 409
    assert immutable.json()["error"]["code"] == "VERSION_IMMUTABLE"

    second_publish = await publish_version(
        client,
        v2["id"],
        expected_revision=2,
        key="v2-publish",
    )
    assert second_publish.status_code == 201, second_publish.text

    async with app.state.db.sessionmaker() as session:
        v1 = await session.get(CourseVersion, COURSE_VERSION_ID)
        v2_db = await session.get(CourseVersion, v2["id"])
    assert v1.status is CourseVersionStatus.superseded
    assert v2_db.status is CourseVersionStatus.published

    old_release = await client.get(f"/api/v1/hq/releases/{first_release_id}")
    assert old_release.status_code == 200
    assert old_release.json()["release"]["course_version_id"] == COURSE_VERSION_ID

    republish_old = await publish_version(client, COURSE_VERSION_ID, key="old-key")
    assert republish_old.status_code == 409
    assert republish_old.json()["error"]["code"] == "STATE_CONFLICT"
    assert republish_old.json()["error"]["details"]["current_status"] == "superseded"


async def test_publish_store_validation_and_ambiguous_staff(client, app):
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200

    missing_store = await publish_version(
        client,
        store_ids=("store_missing",),
        key="missing-store",
    )
    assert missing_store.status_code == 422
    assert missing_store.json()["error"]["code"] == "VALIDATION_ERROR"
    assert missing_store.json()["error"]["details"]["fields"][0]["loc"] == [
        "body",
        "store_ids",
    ]

    async with app.state.db.sessionmaker() as session:
        store = await session.get(Store, "store_fs")
        store.active = False
        await session.commit()

    inactive = await publish_version(
        client,
        store_ids=("store_fs",),
        key="inactive-store",
    )
    assert inactive.status_code == 422
    assert inactive.json()["error"]["code"] == "VALIDATION_ERROR"

    async with app.state.db.sessionmaker() as session:
        store = await session.get(Store, "store_fs")
        store.active = True
        session.add(
            StoreMembership(
                user_id="usr_linxiaomei",
                store_id="store_fs",
                role=MembershipRole.staff,
                active=True,
            )
        )
        await session.commit()

    ambiguous = await publish_version(
        client,
        store_ids=("store_bj", "store_fs"),
        key="ambiguous",
    )
    assert ambiguous.status_code == 422
    assert ambiguous.json()["error"]["code"] == "AMBIGUOUS_STAFF_STORE"
    assert ambiguous.json()["error"]["details"]["user_ids"] == ["usr_linxiaomei"]

    async with app.state.db.sessionmaker() as session:
        count = await session.scalar(select(func.count()).select_from(Release))
    assert count == 0


async def test_publish_empty_roster(client, app):
    await login(client, "usr_linmin")
    assert (await review_version(client)).status_code == 200

    async with app.state.db.sessionmaker() as session:
        memberships = (
            await session.scalars(
                select(StoreMembership).where(
                    StoreMembership.store_id == "store_fs",
                    StoreMembership.role == MembershipRole.staff,
                )
            )
        ).all()
        for membership in memberships:
            membership.active = False
        await session.commit()

    published = await publish_version(
        client,
        store_ids=("store_fs",),
        key="empty-roster",
    )
    assert published.status_code == 201, published.text
    release = published.json()["release"]
    assert release["assigned_total"] == 0
    assert release["targets"][0]["assigned_count"] == 0

    detail = await client.get(f"/api/v1/hq/releases/{release['id']}")
    assert detail.json()["release"]["assigned_total"] == 0

    async with app.state.db.sessionmaker() as session:
        count = await session.scalar(
            select(func.count())
            .select_from(Assignment)
            .where(Assignment.release_id == release["id"])
        )
    assert count == 0

    await login(client, "usr_zhoulin")
    assert (await client.get("/api/v1/staff/assignments")).json()["items"] == []


async def test_roster_snapshot_is_immutable(client, app):
    release = await publish_seed_course(client)

    async with app.state.db.sessionmaker() as session:
        wang = await session.get(User, "usr_wangxiaoxue")
        wang.active = False
        session.add(
            User(
                id="usr_newstaff",
                name="新员工",
                role=UserRole.staff,
                active=True,
            )
        )
        session.add(
            StoreMembership(
                user_id="usr_newstaff",
                store_id="store_bj",
                role=MembershipRole.staff,
                active=True,
            )
        )
        await session.commit()

    assignees = await client.get(
        f"/api/v1/hq/releases/{release['id']}/assignees"
    )
    items = assignees.json()["items"]
    assert len(items) == 3
    wang_item = next(item for item in items if item["user"]["id"] == "usr_wangxiaoxue")
    assert wang_item["user"]["active"] is False
    assert all(item["user"]["id"] != "usr_newstaff" for item in items)

    await login(client, "usr_newstaff")
    assert (await client.get("/api/v1/staff/assignments")).json()["items"] == []


async def test_release_detail_counts_from_later_stages(client, app):
    release = await publish_seed_course(client)

    async with app.state.db.sessionmaker() as session:
        release_db = await session.get(Release, release["id"])
        assignments = (
            await session.scalars(
                select(Assignment).where(Assignment.release_id == release["id"])
            )
        ).all()
        by_user = {assignment.user_id: assignment for assignment in assignments}
        by_user["usr_linxiaomei"].qualified_at = release_db.published_at + timedelta(
            hours=1
        )
        by_user["usr_linxiaomei"].status = AssignmentStatus.passed
        by_user["usr_chenajie"].status = AssignmentStatus.pending_review
        session.add(
            Retrain(
                assignment_id=by_user["usr_chenajie"].id,
                release_id=release["id"],
                focus_fact_key="fact_box_rule",
                focus_fact_label="端盒 6 个不重复",
                status=RetrainStatus.fixed_pending_review,
                baseline_round_no=0,
                issued_by="usr_liming",
                version=1,
            )
        )
        await session.commit()

    detail = await client.get(f"/api/v1/hq/releases/{release['id']}")
    assert detail.status_code == 200
    release_detail = detail.json()["release"]
    assert release_detail["qualified_in_window"] == 1
    assert release_detail["pending_review"] == 1
    assert release_detail["open_retrains"] == 1


async def test_create_rejects_non_m1_dimensions(client):
    await login(client, "usr_linmin")
    payload = course_payload(sku="MINISO-SERVICE-DIM", name="不兼容维度")
    payload["rubric"] = incompatible_rubric()

    created = await client.post("/api/v1/hq/courses", json=payload)
    assert created.status_code == 422
    error = created.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert any("M1 四维" in field["msg"] for field in error["details"]["fields"])


async def test_review_and_publish_reject_incompatible_stored_rubric(client, app):
    await login(client, "usr_linmin")

    async with app.state.db.sessionmaker() as session:
        rubric = await session.get(RubricVersion, RUBRIC_VERSION_ID)
        rubric.rules = incompatible_rubric()
        await session.commit()

    rejected_review = await review_version(client)
    assert rejected_review.status_code == 422
    assert rejected_review.json()["error"]["code"] == "VALIDATION_ERROR"
    async with app.state.db.sessionmaker() as session:
        version = await session.get(CourseVersion, COURSE_VERSION_ID)
    assert version.status is CourseVersionStatus.draft

    async with app.state.db.sessionmaker() as session:
        rubric = await session.get(RubricVersion, RUBRIC_VERSION_ID)
        rubric.rules = deepcopy(RUBRIC_RULES)
        await session.commit()
    assert (await review_version(client)).status_code == 200

    async with app.state.db.sessionmaker() as session:
        rubric = await session.get(RubricVersion, RUBRIC_VERSION_ID)
        rubric.rules = incompatible_rubric()
        await session.commit()

    rejected_publish = await publish_version(client, key="invalid-rubric")
    assert rejected_publish.status_code == 422
    assert rejected_publish.json()["error"]["code"] == "VALIDATION_ERROR"
    async with app.state.db.sessionmaker() as session:
        release_count = await session.scalar(
            select(func.count()).select_from(Release)
        )
    assert release_count == 0


async def test_course_list_cursor(client):
    await login(client, "usr_linmin")
    for index in range(3):
        created = await client.post(
            "/api/v1/hq/courses",
            json=course_payload(sku=f"MINISO-CURSOR-{index}", name=f"游标课程{index}"),
        )
        assert created.status_code == 201, created.text

    first_page = await client.get("/api/v1/hq/courses?limit=2")
    assert first_page.status_code == 200
    first_items = first_page.json()["items"]
    assert len(first_items) == 2
    assert first_page.json()["next_cursor"]

    second_page = await client.get(
        f"/api/v1/hq/courses?limit=2&cursor={first_page.json()['next_cursor']}"
    )
    second_items = second_page.json()["items"]
    assert len(second_items) == 2
    assert second_page.json()["next_cursor"] is None
    assert {item["course_id"] for item in first_items}.isdisjoint(
        {item["course_id"] for item in second_items}
    )


async def test_hq_routes_require_hq_role(client):
    assert (await client.get("/api/v1/hq/courses")).status_code == 401

    await login(client, "usr_linxiaomei")
    assert (await client.get("/api/v1/hq/courses")).status_code == 403

    await login(client, "usr_liming")
    assert (await client.get("/api/v1/hq/courses")).status_code == 403