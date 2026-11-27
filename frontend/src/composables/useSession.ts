import { computed, readonly, shallowRef } from 'vue'
import * as authApi from '@/api/auth'
import { ApiClientError, setUnauthorizedHandler } from '@/api/client'
import type { UserRef } from '@/types/api'

/**
 * 单例服务端会话状态管理。
 * 所有页面均以服务端 /api/v1/me 返回的 user 与 capabilities 为唯一可信来源，
 * 客户端绝不自行缓存或伪造角色、门店归属。
 */
const currentUser = shallowRef<UserRef | null>(null)
const capabilities = shallowRef<readonly string[]>([])
const serverTime = shallowRef<string | null>(null)
const initialized = shallowRef(false)
const loading = shallowRef(false)

/** 合并并发初始化请求，避免路由切换瞬间重复请求 /me */
let pendingInit: Promise<UserRef | null> | null = null

export function useSession() {
  const isAuthenticated = computed(() => currentUser.value !== null)

  /** 注册全局 401 回调，确保会话失效时清理状态并跳回登录页 */
  function bindUnauthorizedCallback(onExpired: (err: ApiClientError) => void): void {
    setUnauthorizedHandler((err) => {
      currentUser.value = null
      capabilities.value = []
      initialized.value = true
      onExpired(err)
    })
  }

  /** 向服务端刷新当前会话身份 */
  async function refreshSession(): Promise<UserRef | null> {
    loading.value = true
    try {
      const me = await authApi.fetchMe({ skipAuthRedirect: true })
      currentUser.value = me.user
      capabilities.value = me.capabilities
      serverTime.value = me.server_time
      initialized.value = true
      return me.user
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        currentUser.value = null
        capabilities.value = []
        initialized.value = true
        return null
      }
      throw err
    } finally {
      loading.value = false
    }
  }

  /** 应用首次启动或页面刷新时确保已查询过服务端会话 */
  async function ensureSessionLoaded(): Promise<UserRef | null> {
    if (initialized.value) {
      return currentUser.value
    }
    if (!pendingInit) {
      pendingInit = refreshSession().finally(() => {
        pendingInit = null
      })
    }
    return pendingInit
  }

  /** 使用开发身份登录并拉取 /me 能力集 */
  async function loginWithDevUser(userId: string): Promise<UserRef> {
    loading.value = true
    try {
      const res = await authApi.devLogin(userId)
      currentUser.value = res.user
      initialized.value = true
      // 登录后紧接着拉取一次 /me 以同步 capabilities 和 server_time
      try {
        const me = await authApi.fetchMe({ skipAuthRedirect: true })
        currentUser.value = me.user
        capabilities.value = me.capabilities
        serverTime.value = me.server_time
      } catch {
        // 若后续 /me 短暂波动，仍保留 dev-login 返回的用户对象
      }
      return currentUser.value
    } finally {
      loading.value = false
    }
  }

  /** 撤销服务端会话并清空本地会话引用 */
  async function logoutSession(): Promise<void> {
    loading.value = true
    try {
      await authApi.logout()
    } finally {
      currentUser.value = null
      capabilities.value = []
      serverTime.value = null
      initialized.value = true
      loading.value = false
    }
  }

  /** 仅用于测试重置内存状态 */
  function resetLocalSessionState(): void {
    currentUser.value = null
    capabilities.value = []
    serverTime.value = null
    initialized.value = false
    pendingInit = null
  }

  return {
    user: readonly(currentUser),
    capabilities: readonly(capabilities),
    serverTime: readonly(serverTime),
    initialized: readonly(initialized),
    loading: readonly(loading),
    isAuthenticated,
    bindUnauthorizedCallback,
    refreshSession,
    ensureSessionLoaded,
    loginWithDevUser,
    logoutSession,
    resetLocalSessionState,
  }
}
