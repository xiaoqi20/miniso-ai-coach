import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { mockDevLogin, resetMockState } from '@/mock/server'
import { createAppRouter } from '@/router'

describe('路由守卫、服务端会话恢复与角色隔离', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  it('未登录访问受保护员工页自动重定向到 /login 并保留 redirect 参数', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/staff')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/staff')
  })

  it('模拟页面刷新重建路由时，从服务端 /me 自动恢复会话并放行员工路径', async () => {
    await mockDevLogin('usr_linxiaomei')

    const router = createAppRouter(createMemoryHistory())
    await router.push('/staff')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('staff-home')
    expect(useSession().user.value?.id).toBe('usr_linxiaomei')
  })

  it('越权访问其他角色路由时自动重定向至本人角色首页', async () => {
    await mockDevLogin('usr_linxiaomei')

    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('staff-home')

    // 切换为总部运营账号后访问 /staff 应导向 /hq
    useSession().resetLocalSessionState()
    await mockDevLogin('usr_linmin')

    const hqRouter = createAppRouter(createMemoryHistory())
    await hqRouter.push('/staff')
    await hqRouter.isReady()

    expect(hqRouter.currentRoute.value.name).toBe('hq-home')
  })
})
