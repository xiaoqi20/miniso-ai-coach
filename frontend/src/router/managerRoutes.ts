import type { RouteRecordRaw } from 'vue-router'

/**
 * 门店店长（store_manager）路由扩展模块。
 * T006 阶段仅挂载占位入口页与 H5 移动布局约定，T007 可直接在此追加进度看板、补训指派与复查路由。
 */
export const managerRoutes: RouteRecordRaw[] = [
  {
    path: '/manager',
    name: 'manager-home',
    component: () => import('@/views/stubs/ManagerEntryStubView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['store_manager'],
      layout: 'mobile',
      title: '店长工作台（T007 预留入口）',
    },
  },
]
