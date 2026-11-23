import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError, httpRequest, setUnauthorizedHandler } from '@/api/client'

describe('真实 API 客户端请求头与错误解析契约测试', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    setUnauthorizedHandler(null)
  })

  it('POST 请求即使无请求体也自动携带 Content-Type: application/json 与同源凭证', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: { 'X-Request-Id': 'req_test_204' },
      }),
    )

    await httpRequest('/auth/logout', { method: 'POST' })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/auth/logout')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('same-origin')
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('统一解析 FastAPI ApiErrorEnvelope，并在 401 时触发会话失效回调', async () => {
    const expiredSpy = vi.fn()
    setUnauthorizedHandler(expiredSpy)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'SESSION_EXPIRED',
            message: '会话已过期，请重新登录',
            request_id: 'req_test_401',
          },
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req_test_401' },
        },
      ),
    )

    let caught: unknown
    try {
      await httpRequest('/staff/assignments')
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(ApiClientError)
    const apiErr = caught as ApiClientError
    expect(apiErr.status).toBe(401)
    expect(apiErr.code).toBe('SESSION_EXPIRED')
    expect(apiErr.requestId).toBe('req_test_401')
    expect(expiredSpy).toHaveBeenCalledTimes(1)
  })
})
