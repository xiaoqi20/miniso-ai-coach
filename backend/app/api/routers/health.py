from fastapi import APIRouter

health_router = APIRouter()


@health_router.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "shouke-backend"}