import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import { hqRoutes } from '@/router/hqRoutes'
import { managerRoutes } from '@/router/managerRoutes'
import type { UserRole } from '@/types/api'
import { homeRouteForRole } from '@/utils/assignment'

/** 扩展 vue-router 的 RouteMeta 类型声明，统一约束权限、布局和导航高亮 */
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: UserRole[]
    layout?: 'auth' | 'mobile' | 'desktop'
    title?: string
    navTab?: 'home' | 'roleplay'
  }
}

/** 员工 H5 路由模块 */
export const staffRoutes: RouteRecordRaw[] = [
  {
    path: '/staff',
    name: 'staff-home',
    component: () => import('@/views/staff/StaffHomeView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['staff'],
      layout: 'mobile',
      title: '门店员工首页',
      navTab: 'home',
    },
  },
  {
    path: '/staff/assignments/:assignmentId',
    name: 'staff-course',
    component: () => import('@/views/staff/StaffCourseView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['staff'],
      layout: 'mobile',
      title: '产品细节讲解',
      navTab: 'home',
    },
  },
  {
    path: '/staff/assignments/:assignmentId/roleplay',
    name: 'staff-roleplay',
    component: () => import('@/views/staff/StaffRoleplayView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['staff'],
      layout: 'mobile',
      title: '文字实战对练',
      navTab: 'roleplay',
    },
  },
]

export const appRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'root',
    component: () => import('@/views/LoginView.vue'),
    meta: {
      layout: 'auth',
      title: 'MINISO 门店培训入口',
    },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: {
      layout: 'auth',
      title: '选择开发测试身份',
    },
  },
  ...staffRoutes,
  ...managerRoutes,
  ...hqRoutes,
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

/**
 * 创建并挂载全局路由守卫：
 * 1. 首次导航自动通过 /api/v1/me 恢复服务端会话；
 * 2. 未登录访问受保护路由时跳转 /login（保留 redirect）；
 * 3. 已登录访问根路径 / 或越权访问非本角色路由时，自动导向对应角色主页。
 */
export function createAppRouter(history = createWebHistory()): Router {
  const router = createRouter({
    history,
    routes: appRoutes,
  })

  const { ensureSessionLoaded, user, bindUnauthorizedCallback } = useSession()
  const { showToast } = useToast()

  bindUnauthorizedCallback(() => {
    if (router.currentRoute.value.name !== 'login') {
      showToast('服务端会话已失效，请重新登录')
      void router.replace({
        name: 'login',
        query: { redirect: router.currentRoute.value.fullPath },
      })
    }
  })

  router.beforeEach(async (to) => {
    let activeUser = user.value
    try {
      activeUser = await ensureSessionLoaded()
    } catch {
      // /me 请求若因非 401 网络故障失败，允许进入 /login 页面展示重试或重登
      if (to.meta.requiresAuth) {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      return true
    }

    if (to.name === 'root') {
      return activeUser ? homeRouteForRole(activeUser.role) : { name: 'login' }
    }

    if (to.meta.requiresAuth && !activeUser) {
      return { name: 'login', query: { redirect: to.fullPath } }
    }

    if (activeUser && to.meta.roles && !to.meta.roles.includes(activeUser.role)) {
      showToast('当前身份无权访问该角色页面，已返回本角色首页')
      return homeRouteForRole(activeUser.role)
    }

    if (to.meta.title && typeof document !== 'undefined') {
      document.title = `${to.meta.title} · MINISO 名创优品`
    }
    return true
  })

  return router
}
