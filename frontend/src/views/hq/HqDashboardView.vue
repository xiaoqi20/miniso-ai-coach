<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { getApiMode } from '@/api/client'
import * as hqApi from '@/api/hq'
import AppShellDesktop from '@/components/AppShellDesktop.vue'
import HqQuickPublishCard from '@/components/HqQuickPublishCard.vue'
import { useToast } from '@/composables/useToast'
import { resetMockState } from '@/mock/server'
import type {
  CourseVersionStatus,
  HqCourseListItem,
  HqPublishReleasePayload,
  HqReleaseDetailResponse,
  ReleaseStatsResponse,
} from '@/types/api'
import { formatDateTimeLabel } from '@/utils/assignment'
import { formatApiError, formatPassRate, type FormattedApiError } from '@/utils/errors'
import {
  loadRecentReleaseRefs,
  saveRecentReleaseRef,
  type RecentReleaseRef,
} from '@/utils/hqReleases'

const router = useRouter()
const { showToast } = useToast()
const isMockMode = computed(() => getApiMode() === 'mock')

const courses = shallowRef<readonly HqCourseListItem[]>([])
const recentReleases = shallowRef<readonly RecentReleaseRef[]>(loadRecentReleaseRefs())
const latestReleaseDetail = shallowRef<HqReleaseDetailResponse['release'] | null>(null)
const latestReleaseStats = shallowRef<ReleaseStatsResponse | null>(null)

const loading = shallowRef(true)
const loadError = shallowRef<FormattedApiError | null>(null)
const lookupReleaseId = shallowRef('')

const summaryMetrics = computed(() => {
  const list = courses.value
  const draftCount = list.filter((c) => c.latest_version?.status === 'draft').length
  const totalReleases = list.reduce((sum, c) => sum + c.published_release_count, 0)
  return { total: list.length, draftCount, totalReleases }
})

const latestRateText = computed(() => {
  if (latestReleaseStats.value) {
    return formatPassRate(latestReleaseStats.value.rate, latestReleaseStats.value.empty_roster)
  }
  const rel = latestReleaseDetail.value
  if (!rel) return '—'
  if (rel.assigned_total === 0) return '暂无应训人员'
  return `${((rel.qualified_in_window / rel.assigned_total) * 100).toFixed(1)}%`
})

function versionStatusMeta(status: CourseVersionStatus | undefined) {
  switch (status) {
    case 'draft':
      return { text: '待审校', cls: 'status-warn' }
    case 'approved':
      return { text: '已审校待发布', cls: 'status-info' }
    case 'published':
      return { text: '已发布', cls: 'status-ok' }
    case 'superseded':
      return { text: '已被替代', cls: 'status-warn' }
    default:
      return { text: '无版本', cls: 'status-warn' }
  }
}

async function loadLatestReleaseSnapshot(refs: readonly RecentReleaseRef[]): Promise<void> {
  const first = refs[0]
  if (!first) {
    latestReleaseDetail.value = null
    latestReleaseStats.value = null
    return
  }
  try {
    const detail = await hqApi.getHqReleaseDetail(first.release_id)
    latestReleaseDetail.value = detail.release
    try {
      latestReleaseStats.value = await hqApi.getHqReleaseStats(first.release_id)
    } catch {
      latestReleaseStats.value = null
    }
  } catch {
    latestReleaseDetail.value = null
    latestReleaseStats.value = null
  }
}

async function loadCourses(silentToast = false): Promise<void> {
  if (courses.value.length === 0) loading.value = true
  loadError.value = null
  try {
    const res = await hqApi.listHqCourses()
    courses.value = res.items
    const refs = loadRecentReleaseRefs()
    recentReleases.value = refs
    await loadLatestReleaseSnapshot(refs)
    if (silentToast) showToast('已同步最新进度')
  } catch (err) {
    loadError.value = formatApiError(err, '加载总部课程列表失败')
  } finally {
    loading.value = false
  }
}

async function handleQuickCreated(payload: {
  courseId: string
  courseName: string
  publishedRelease?: HqPublishReleasePayload
}): Promise<void> {
  if (payload.publishedRelease) {
    const rel = payload.publishedRelease
    recentReleases.value = saveRecentReleaseRef({
      release_id: rel.id,
      course_name: payload.courseName,
      published_at: rel.published_at,
      store_names: rel.targets.map((t) => t.store_name),
      assigned_total: rel.assigned_total,
    })
  }
  await loadCourses()
}

function handleLookupRelease(): void {
  const id = lookupReleaseId.value.trim()
  if (!id) {
    showToast('请输入发布批次 ID')
    return
  }
  void router.push(`/hq/releases/${encodeURIComponent(id)}`)
}

async function handleResetMock(): Promise<void> {
  resetMockState()
  window.localStorage.removeItem('shouke_hq_recent_releases_mock')
  window.sessionStorage.removeItem('shouke_hq_quick_publish_pending_mock')
  // 保持当前总部登录态方便继续操作
  const { mockDevLogin } = await import('@/mock/server')
  await mockDevLogin('usr_linmin')
  showToast('已重置试点测试数据')
  await loadCourses()
}

onMounted(() => {
  void loadCourses()
})
</script>

<template>
  <AppShellDesktop>
    <div class="hq-dashboard-grid" data-testid="hq-dashboard-page">
      <!-- 左栏：1:1 复刻原型首屏卡片「总部简版：新品录入与审校发布」 -->
      <div class="hq-col-left">
        <HqQuickPublishCard @created="handleQuickCreated" />
      </div>

      <!-- 右栏：原型卡片 2「试点上新任务跟踪」+ 原型卡片 3「首轮试点 48h 同口径概览」 -->
      <div class="hq-col-right">
        <!-- 试点上新任务跟踪（.audit-card-row 原型排版） -->
        <section class="card">
          <div class="card-head">
            <div>
              <div class="card-title">试点上新任务跟踪</div>
              <div class="card-sub">多端实时同步：员工端、店长端与总部端共享同一批次状态</div>
            </div>
            <div class="ctrl-links">
              <button
                type="button"
                class="qa-collapse-link"
                data-testid="hq-refresh-courses-btn"
                @click="loadCourses(true)"
              >
                刷新进度
              </button>
              <button
                v-if="isMockMode"
                type="button"
                class="qa-collapse-link"
                data-testid="hq-reset-mock-btn"
                @click="handleResetMock"
              >
                重置数据
              </button>
            </div>
          </div>

          <div v-if="loading" class="empty-box" data-testid="hq-courses-loading">
            正在同步总部课程与上新批次...
          </div>

          <div v-else-if="loadError" class="error-banner" role="alert" data-testid="hq-courses-error">
            <div class="error-banner-head">
              <span>{{ loadError.title }}</span>
              <button type="button" class="btn-pill-soft" @click="loadCourses()">重试</button>
            </div>
            <div>{{ loadError.detail }}</div>
            <div v-if="loadError.requestId" class="error-request-id">
              code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
            </div>
          </div>

          <div v-else-if="courses.length === 0" class="empty-box">
            暂无新品课程，请在左侧录入新品草稿或直接审校发布。
          </div>

          <div v-else class="audit-list">
            <div
              v-for="item in courses"
              :key="item.course_id"
              class="audit-card-row"
              :data-testid="`hq-course-row-${item.course_id}`"
            >
              <div class="audit-top-row">
                <div class="row-text-block">
                  <div class="list-row-main">{{ item.name }}</div>
                  <div class="list-row-sub">
                    SKU：{{ item.sku_code }}
                    <template v-if="item.latest_version">
                      · v{{ item.latest_version.version_no }}（修订 #{{ item.latest_version.revision }}）
                    </template>
                  </div>
                  <div class="list-row-sub">
                    已发布 {{ item.published_release_count }} 批次
                    <template v-if="item.latest_version">
                      · 更新于 {{ formatDateTimeLabel(item.latest_version.updated_at) }}
                    </template>
                  </div>
                </div>
                <span
                  class="status-badge"
                  :class="versionStatusMeta(item.latest_version?.status).cls"
                >
                  {{ versionStatusMeta(item.latest_version?.status).text }}
                </span>
              </div>

              <div class="audit-actions-row">
                <button
                  type="button"
                  :class="item.latest_version?.status === 'draft' ? 'btn-pill-red' : 'btn-pill-soft'"
                  :data-testid="`hq-open-course-${item.course_id}`"
                  @click="router.push(`/hq/courses/${encodeURIComponent(item.course_id)}`)"
                >
                  {{ item.latest_version?.status === 'draft' ? '进入审校并发布' : '查看版本与再发' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 最近发布批次与按 ID 查询 -->
          <div class="releases-subsection">
            <div class="sub-head-row">
              <span class="sub-section-title">最近发布批次（查看应训名单与 48h 统计）</span>
            </div>
            <div v-if="recentReleases.length > 0" class="recent-chips">
              <button
                v-for="rel in recentReleases"
                :key="rel.release_id"
                type="button"
                class="recent-release-row"
                :data-testid="`hq-recent-release-${rel.release_id}`"
                @click="router.push(`/hq/releases/${encodeURIComponent(rel.release_id)}`)"
              >
                <div>
                  <div class="list-row-main small">{{ rel.course_name }}</div>
                  <div class="list-row-sub">
                    {{ rel.store_names.join('、') || '—' }} · 应训 {{ rel.assigned_total }} 人 ·
                    {{ formatDateTimeLabel(rel.published_at) }}
                  </div>
                </div>
                <span class="release-arrow">批次详情 ›</span>
              </button>
            </div>
            <form class="lookup-form" @submit.prevent="handleLookupRelease">
              <label for="hq-release-lookup" class="sr-only">按批次 ID 查询</label>
              <input
                id="hq-release-lookup"
                v-model="lookupReleaseId"
                type="text"
                class="lookup-input"
                placeholder="按 release_id 直达批次详情（如 rls_m1_bj）"
                data-testid="hq-release-lookup-input"
              />
              <button
                type="submit"
                class="btn-pill-soft"
                data-testid="hq-release-lookup-btn"
              >
                查询批次
              </button>
            </form>
          </div>
        </section>

        <!-- 首轮试点同口径验证指标（复刻原型 .kpi-grid + .list-row，严格采用真实 48h 统计口径） -->
        <section class="card" data-testid="hq-pilot-overview-card">
          <div class="card-head">
            <div>
              <div class="card-title">首轮试点同口径 48h 概览</div>
              <div class="card-sub">聚焦「应训名单快照」与「发布后 48 小时首次通关率」</div>
            </div>
            <span
              class="status-badge"
              :class="summaryMetrics.draftCount > 0 ? 'status-warn' : 'status-ok'"
            >
              待审校 {{ summaryMetrics.draftCount }} 款
            </span>
          </div>

          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-num">{{ latestRateText }}</div>
              <div class="kpi-label">
                最新批次 48h 通关率
              </div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">{{ summaryMetrics.total }}</div>
              <div class="kpi-label">新品课程总数</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">{{ summaryMetrics.totalReleases }}</div>
              <div class="kpi-label">累计发布批次</div>
            </div>
          </div>

          <div v-if="latestReleaseDetail" class="pilot-list-rows">
            <div class="list-row">
              <div>
                <div class="list-row-main">最新批次：{{ latestReleaseDetail.course.name }}</div>
                <div class="list-row-sub">
                  应训快照 {{ latestReleaseDetail.assigned_total }} 人 · 窗口内首次通关
                  {{ latestReleaseDetail.qualified_in_window }} 人 · 待复查
                  {{ latestReleaseDetail.pending_review }} 人
                </div>
              </div>
              <button
                type="button"
                class="btn-pill-soft"
                @click="router.push(`/hq/releases/${encodeURIComponent(latestReleaseDetail.id)}`)"
              >
                查看明细
              </button>
            </div>
            <div class="list-row">
              <div>
                <div class="list-row-main">48 小时窗口口径</div>
                <div class="list-row-sub">
                  锚定服务端发布时间（{{ formatDateTimeLabel(latestReleaseDetail.published_at) }}），左闭右开计入首次正式通关
                </div>
              </div>
              <span class="status-badge status-ok">
                {{ latestReleaseStats?.window_open === false ? '窗口已定型' : '窗口进行中' }}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </AppShellDesktop>
</template>

<style scoped>
.hq-dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1.15fr);
  gap: 16px;
  align-items: start;
}

.hq-col-left,
.hq-col-right {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ctrl-links {
  display: flex;
  align-items: center;
  gap: 10px;
}

.qa-collapse-link {
  border: none;
  background: transparent;
  color: var(--red);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.audit-list {
  display: flex;
  flex-direction: column;
}

.audit-card-row {
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.audit-card-row:last-child {
  border-bottom: none;
  padding-bottom: 2px;
}

.audit-top-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.row-text-block {
  flex: 1;
  min-width: 0;
}

.list-row-main {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
}

.list-row-main.small {
  font-size: 13px;
}

.list-row-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.audit-actions-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.releases-subsection {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sub-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.recent-chips {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.recent-release-row {
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 11px;
  padding: 9px 11px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.recent-release-row:hover {
  border-color: var(--red-border);
  background: var(--red-soft);
}

.release-arrow {
  font-size: 12px;
  font-weight: 700;
  color: var(--red);
  white-space: nowrap;
}

.lookup-form {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}

.lookup-input {
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  background: var(--bg);
  color: var(--text);
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.kpi-item {
  background: var(--bg);
  border-radius: 12px;
  padding: 12px 8px;
  text-align: center;
}

.kpi-num {
  font-size: 20px;
  font-weight: 800;
  color: var(--red);
  line-height: 1.25;
  margin-bottom: 4px;
}

.kpi-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.pilot-list-rows {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
}

.list-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--border);
}

.empty-box {
  text-align: center;
  padding: 24px 12px;
  color: var(--muted);
  font-size: 13px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

@media (max-width: 920px) {
  .hq-dashboard-grid {
    grid-template-columns: 1fr;
  }
}
</style>
