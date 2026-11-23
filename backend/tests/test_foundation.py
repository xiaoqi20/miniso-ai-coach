from sqlalchemy import func, select, text

from app.config import Settings
from app.models import AuditAction, AuditEvent, Base, Course, Store, User
from app.seed import seed_foundation


async def test_health(client):
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "shouke-backend"}


def test_settings_production_hardening():
    settings = Settings(
        _env_file=None,
        app_env="production",
        dev_auth_enabled=False,
        app_origins="https://app.example.com, https://admin.example.com",
        database_url="mysql+aiomysql://user:pass@db:3306/app",
    )
    assert settings.cookie_secure is True
    assert settings.allowed_origins == [
        "https://app.example.com",
        "https://admin.example.com",
    ]
    assert settings.sync_database_url == "mysql+pymysql://user:pass@db:3306/app"


def test_metadata_registers_all_contract_tables():
    assert len(Base.metadata.tables) == 17


async def test_seed_is_idempotent(app):
    async with app.state.db.sessionmaker() as session:
        before = {
            "stores": await session.scalar(select(func.count()).select_from(Store)),
            "users": await session.scalar(select(func.count()).select_from(User)),
            "courses": await session.scalar(select(func.count()).select_from(Course)),
        }
        counts = await seed_foundation(session)
        after = {
            "stores": await session.scalar(select(func.count()).select_from(Store)),
            "users": await session.scalar(select(func.count()).select_from(User)),
            "courses": await session.scalar(select(func.count()).select_from(Course)),
        }

    assert counts == {
        "stores": 2,
        "users": 9,
        "memberships": 7,
        "courses": 1,
        "course_versions": 1,
        "rubric_versions": 1,
    }
    assert before == after


async def test_audit_action_is_stored_as_contract_value(app):
    async with app.state.db.sessionmaker() as session:
        session.add(
            AuditEvent(
                actor_user_id="usr_linmin",
                action=AuditAction.course_reviewed,
                entity_type="course_version",
                entity_id="crv_chiikawa_v1",
                store_id=None,
                payload={"note": "test"},
                request_id="req_test",
            )
        )
        await session.commit()

        raw = await session.scalar(select(AuditEvent.action))
        assert raw is AuditAction.course_reviewed

        db_value = await session.scalar(text("SELECT action FROM audit_events LIMIT 1"))
        assert db_value == "course.reviewed"