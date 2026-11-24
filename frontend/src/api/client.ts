import { MockHttpError } from '@/mock/server'
import type { ApiErrorEnvelope } from '@/types/api'

export type ApiMode = 'mock' | 'real'

/**
 * 解析当前接口运行模式。
 * 通过 VITE_API_MODE=mock|real 切换；未配置时默认使用 mock 以便无后端独立运行。
 */
export function getApiMode(): ApiMode {
  return import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock'
}

/**
 * 前端统一的业务错误对象：无论来自真实 FastAPI 还是 Mock，结构完全一致。
 */
export class ApiClientError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string
  readonly details?: Record<string, unknown>

  constructor(
    status: number,
    code: string,
    message: string,
    requestId = '',
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

type UnauthorizedHandler = (error: ApiClientError) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

/** 注册全局 401 会话失效处理器，由会话管理层挂载 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

function normalizeError(
  status: number,
  envelope: ApiErrorEnvelope | null,
  fallbackMessage: string,
  headerRequestId = '',
): ApiClientError {
  if (envelope?.error) {
    return new ApiClientError(
      status,
      envelope.error.code || 'INTERNAL_ERROR',
      envelope.error.message || fallbackMessage,
      envelope.error.request_id || headerRequestId,
      envelope.error.details,
    )
  }
  return new ApiClientError(status, 'HTTP_ERROR', fallbackMessage, headerRequestId)
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  /** 显式跳过 401 自动登出回调（如初始化 /me 探测登录态时使用） */
  skipAuthRedirect?: boolean
  /** 可选响应头读取钩子（如读取 Idempotent-Replay） */
  onResponse?: (response: Response) => void
}

/**
 * 发起同域 /api/v1 HTTP 请求，供 real 模式与 T007 后续拓展模块共用。
 * 强制满足 M1 契约：写请求一律携带 Content-Type: application/json。
 */
export async function httpRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  }

  // 后端中间件要求所有 POST/PUT/PATCH/DELETE 均显式携带 application/json（即使无正文）
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
  }

  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch (cause) {
    throw new ApiClientError(
      0,
      'NETWORK_ERROR',
      cause instanceof Error ? `网络请求失败：${cause.message}` : '网络连接异常，请稍后重试',
    )
  }

  options.onResponse?.(response)

  const requestId = response.headers.get('X-Request-Id') ?? ''
  if (response.status === 204) {
    return undefined as T
  }

  let parsed: unknown = null
  try {
    const text = await response.text()
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const apiErr = normalizeError(
      response.status,
      parsed as ApiErrorEnvelope | null,
      `请求失败 (${response.status})`,
      requestId,
    )
    if (response.status === 401 && !options.skipAuthRedirect) {
      unauthorizedHandler?.(apiErr)
    }
    throw apiErr
  }

  return parsed as T
}

/**
 * 统一执行接口调用：real 模式走 httpRequest，mock 模式调用本地契约模拟器并统一包装错误。
 */
export async function executeApi<T>(
  realCall: () => Promise<T>,
  mockCall: () => Promise<T>,
  options: { skipAuthRedirect?: boolean } = {},
): Promise<T> {
  if (getApiMode() === 'real') {
    return realCall()
  }
  try {
    return await mockCall()
  } catch (err) {
    if (err instanceof MockHttpError) {
      const apiErr = normalizeError(err.status, err.payload, err.message)
      if (err.status === 401 && !options.skipAuthRedirect) {
        unauthorizedHandler?.(apiErr)
      }
      throw apiErr
    }
    throw err
  }
}
