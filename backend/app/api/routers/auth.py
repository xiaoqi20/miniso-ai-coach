"""开发身份登录、登出和当前用户。

dev-login 路由只在 development 且 DEV_AUTH_ENABLED=true 时注册；
生产环境接入企微后仍复用同一 sessions 表和 Cookie 机制。
"""

from fastapi import APIRouter, Request, Response

from app.api.deps import CurrentUserDep, DbDep, SettingsDep
from app.errors import ApiError
from app.models.base import utcnow
from app.schemas.auth import (
    DevLoginRequest,
    LoginResponse,
    MeResponse,
    SessionRef,
)
from app.security import clear_session_cookie, iso_utc, set_session_cookie
from app.services.auth import (
    active_memberships,
    capabilities_for,
    create_session,
    get_user_with_memberships,
    revoke_session,
    user_ref,
)

dev_router = APIRouter()
auth_router = APIRouter()
identity_router = APIRouter()


@dev_router.post("/dev-login", response_model=LoginResponse)
async def dev_login(
    body: DevLoginRequest,
    response: Response,
    session: DbDep,
    settings: SettingsDep,
) -> LoginResponse:
    # 只按稳定的开发用户 ID 查库；请求体不允许夹带 role/store_id。
    user = await get_user_with_memberships(session, body.user_id)
    if user is None or not user.active:
        raise ApiError(404, "NOT_FOUND", "用户不存在")
    # 先提交会话再下发 Cookie，避免浏览器拿到一个数据库里不存在的令牌。
    token, user_session = await create_session(session, user, settings)
    await session.commit()
    set_session_cookie(response, settings, token)
    return LoginResponse(
        user=user_ref(user, active_memberships(user)),
        session=SessionRef(expires_at=iso_utc(user_session.expires_at)),
    )


@auth_router.post("/logout", status_code=204)
async def logout(request: Request, session: DbDep, settings: SettingsDep) -> Response:
    # 登出保持幂等：没有 Cookie 或令牌已失效也返回 204。
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        await revoke_session(session, token)
        await session.commit()
    response = Response(status_code=204)
    clear_session_cookie(response, settings)
    return response


@identity_router.get("/me", response_model=MeResponse)
async def me(current_user: CurrentUserDep) -> MeResponse:
    """返回当前身份、门店范围、能力提示和服务端时间。"""
    return MeResponse(
        user=user_ref(current_user.user, current_user.memberships),
        capabilities=capabilities_for(current_user.user.role),
        server_time=iso_utc(utcnow()),
    )