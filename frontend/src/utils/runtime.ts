/**
 * 客户端运行时适配层（标准 H5 -> 企业微信 H5 平滑演进预留）。
 *
 * M1 阶段统一作为标准移动 H5 运行，开发身份通过 POST /api/v1/auth/dev-login 换取服务端会话；
 * M2 接入企业微信自建应用工作台后，保持同一套前端路由与服务端 sk_session 会话机制，
 * 仅通过本模块识别企微 WebView 环境并切换授权入口与安全区适配。
 */

export type ClientRuntime = 'h5' | 'wecom'

/** 根据 User-Agent 判断当前是否运行于企业微信内置浏览器（WeCom WebView） */
export function detectClientRuntime(
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
): ClientRuntime {
  return /wxwork/i.test(userAgent) ? 'wecom' : 'h5'
}

/** 是否为企业微信客户端环境 */
export function isWeComRuntime(userAgent?: string): boolean {
  return detectClientRuntime(userAgent) === 'wecom'
}

/**
 * M2 企业微信网页授权开关（默认关闭；M1 始终使用开发身份入口）。
 * 启用后可由 /login 或路由守卫跳转至后端 OAuth 入口换取同域 sk_session。
 */
export function isWeComAuthEnabled(): boolean {
  return import.meta.env.VITE_WECOM_AUTH_ENABLED === 'true'
}

/** 预留 M2 企业微信 H5 网页授权跳转路径（同域反向代理至 FastAPI） */
export function buildWeComAuthorizePath(redirectPath = '/'): string {
  const safeRedirect = redirectPath.startsWith('/') ? redirectPath : '/'
  return `/api/v1/auth/wecom/authorize?redirect=${encodeURIComponent(safeRedirect)}`
}

/** 在文档根节点同步运行时属性，供 H5 / 企微 WebView 样式与安全区无侵入适配 */
export function applyRuntimeDocumentAttributes(): ClientRuntime {
  const runtime = detectClientRuntime()
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.clientRuntime = runtime
  }
  return runtime
}
