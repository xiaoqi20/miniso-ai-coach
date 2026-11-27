import type { RouteRecordRaw } from 'vue-router'

/**
 * 总部运营（hq_ops）PC 端路由模块。
 * 覆盖课程工作台、草稿审校与定向发布、发布批次详情及 48 小时统计。
 */
export const hqRoutes: RouteRecordRaw[] = [
  {
    path: '/hq',
    name: 'hq-home',
    component: () => import('@/views/hq/HqDashboardView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['hq_ops'],
      layout: 'desktop',
      title: '总部课程与发布工作台',
    },
  },
  {
    path: '/hq/courses/:courseId',
    name: 'hq-course-workbench',
    component: () => import('@/views/hq/HqCourseWorkbenchView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['hq_ops'],
      layout: 'desktop',
      title: '新品草稿审校与定向发布',
    },
  },
  {
    path: '/hq/releases/:releaseId',
    name: 'hq-release-detail',
    component: () => import('@/views/hq/HqReleaseDetailView.vue'),
    meta: {
      requiresAuth: true,
      roles: ['hq_ops'],
      layout: 'desktop',
      title: '发布批次结果与 48 小时统计',
    },
  },
]
