import { executeApi, httpRequest } from '@/api/client'
import { mockDevLogin, mockFetchMe, mockLogout } from '@/mock/server'
import type { DevLoginRequest, DevLoginResponse, MeResponse } from '@/types/api'

/**
 * 开发身份登录：向服务端交换 sk_session HttpOnly Cookie。
 */
export function devLogin(userId: string): Promise<DevLoginResponse> {
  const payload: DevLoginRequest = { user_id: userId }
  return executeApi(
    () =>
      httpRequest<DevLoginResponse>('/auth/dev-login', {
        method: 'POST',
        body: payload,
        skipAuthRedirect: true,
      }),
    () => mockDevLogin(userId),
    { skipAuthRedirect: true },
  )
}

/**
 * 登出并撤销服务端会话。
 */
export function logout(): Promise<void> {
  return executeApi(
    () =>
      httpRequest<void>('/auth/logout', {
        method: 'POST',
        skipAuthRedirect: true,
      }),
    () => mockLogout(),
    { skipAuthRedirect: true },
  )
}

/**
 * 从服务端恢复当前登录身份与权限范围；未登录或会话过期将抛出 401 ApiClientError。
 */
export function fetchMe(options: { skipAuthRedirect?: boolean } = {}): Promise<MeResponse> {
  return executeApi(
    () =>
      httpRequest<MeResponse>('/me', {
        method: 'GET',
        skipAuthRedirect: options.skipAuthRedirect,
      }),
    () => mockFetchMe(),
    options,
  )
}
