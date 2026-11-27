import type { RouteRecordRaw } from 'vue-router'

/**
 * 门店店长（store_manager）H5 移动端路由模块。
 * 覆盖管辖门店进度与 48 小时统计看板、店员对练证据核验、补训指派与复查确认。
 */
export const managerRoutes: RouteRecordRaw[] = [
  {
    path: '/manager',
    name: 'manager-home',
    component: () => import('@/views/manager/ManagerHomeView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['store_manager'],
      layout: 'mobile',
      title: '店长门店督学工作台',
      navTab: 'home',
    },
  },
  {
    path: '/manager/assignments/:assignmentId',
    name: 'manager-assignment-detail',
    component: () => import('@/views/manager/ManagerAssignmentDetailView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['store_manager'],
      layout: 'mobile',
      title: '店员复练证据与复查处置',
      navTab: 'home',
    },
  },
]
