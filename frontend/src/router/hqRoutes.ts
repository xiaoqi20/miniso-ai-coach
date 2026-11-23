import type { RouteRecordRaw } from 'vue-router'

/**
 * 总部运营（hq_ops）路由扩展模块。
 * T006 阶段仅挂载占位入口页与 PC 桌面布局约定，T007 可直接在此追加课程审校、发布与统计子路由。
 */
export const hqRoutes: RouteRecordRaw[] = [
  {
    path: '/hq',
    name: 'hq-home',
    component: () => import('@/views/stubs/HqEntryStubView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['hq_ops'],
      layout: 'desktop',
      title: '总部运营工作台（T007 预留入口）',
    },
  },
]
