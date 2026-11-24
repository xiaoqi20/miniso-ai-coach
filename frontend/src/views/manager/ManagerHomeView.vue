<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as managerApi from '@/api/manager'
import AppShellMobile from '@/components/AppShellMobile.vue'
import ReleaseStatsCard from '@/components/ReleaseStatsCard.vue'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import type {
  AssignmentStatus,
  ManagerReleaseAssigneeItem,
  ManagerReleaseListItem,
  ReleaseStatsResponse,
} from '@/types/api'
import {
  formatDateTimeLabel,
  formatDeadlineSummary,
  presentAssignmentStatus,
} from '@/utils/assignment'
import { formatApiError, type FormattedApiError } from '@/utils/errors'

type FilterKey = 'all' | 'pending_review' | 'retrain' | 'unfinished' | 'completed'

const router = useRouter()
const { user, logoutSession } = useSession()
const { showToast } = useToast()

const releases = shallowRef<readonly ManagerReleaseListItem[]>([])
const selectedReleaseId = shallowRef('')
const assignees = shallowRef<readonly ManagerReleaseAssigneeItem[]>([])
const stats = shallowRef<ReleaseStatsResponse | null>(null)
const statusFilter = shallowRef<FilterKey>('all')

const loadingReleases = shallowRef(true)
const loadingDetail = shallowRef(false)
const loadError = shallowRef<FormattedApiError | null>(null)
const detailError = shallowRef<FormattedApiError | null>(null)

const storeNamesLabel = computed(() => {
  const stores = user.value?.stores ?? []
  return stores.length > 0 ? stores.map((s) => s.name).join(' / ') : '未分配门店'
})

const selectedRelease = computed(
  () => releases.value.find((item) => item.release_id === selectedReleaseId.value) ?? null,
)

const totalPendingReview = computed(() =>
  releases.value.reduce((sum, item) => sum + item.pending_review, 0),
)

const totalOpenRetrains = computed(() =>
  releases.value.reduce((sum, item) => sum + item.open_retrains, 0),
)

function matchesFilter(status: AssignmentStatus, filter: FilterKey): boolean {
  if (filter === 'all') return true
  if (filter === 'pending_review') return status === 'pending_review'
  if (filter === 'retrain') {
    return status === 'retrain_pending' || status === 'retrain_unfixed' || status === 'pending_review'
  }
  if (filter === 'unfinished') {
    return status !== 'passed' && status !== 'verified'
  }
  return status === 'passed' || status === 'verified'
}

const filteredAssignees = computed(() =>
  assignees.value
    .filter((item) => matchesFilter(item.status, statusFilter.value))
    .map((item) => ({
      item,
      view: presentAssignmentStatus({
        status: item.status,
        completedCount: item.completed_chapter_count,
        requiredCount: item.required_chapters ?? 3,
        lastScore: item.last_score,
        bestScore: item.best_score,
        openRetrain: item.open_retrain,
      }),
    })),
)

const filterOptions: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部店员' },
  { key: 'pending_review', label: '待复查' },
  { key: 'retrain', label: '补训中' },
  { key: 'unfinished', label: '未达标' },
  { key: 'completed', label: '已达标' },
]

async function loadReleaseBoard(releaseId: string): Promise<void> {
  if (!releaseId) {
    assignees.value = []
    stats.value = null
    return
  }
  loadingDetail.value = true
  detailError.value = null
  try {
    const [assigneesRes, statsRes] = await Promise.all([
      managerApi.listManagerReleaseAssignees(releaseId),
      managerApi.getManagerReleaseStats(releaseId),
    ])
    assignees.value = assigneesRes.items
    stats.value = statsRes
  } catch (err) {
    detailError.value = formatApiError(err, '加载本店批次进度与统计失败')
    assignees.value = []
    stats.value = null
  } finally {
    loadingDetail.value = false
  }
}

async function loadReleases(): Promise<void> {
  loadingReleases.value = true
  loadError.value = null
  try {
    const res = await managerApi.listManagerReleases()
    releases.value = res.items
    if (res.items.length === 0) {
      selectedReleaseId.value = ''
      assignees.value = []
      stats.value = null
      return
    }
    const nextId = res.items.some((r) => r.release_id === selectedReleaseId.value)
      ? selectedReleaseId.value
      : res.items[0].release_id
    selectedReleaseId.value = nextId
    await loadReleaseBoard(nextId)
  } catch (err) {
    loadError.value = formatApiError(err, '加载本店发布批次失败')
  } finally {
    loadingReleases.value = false
  }
}

watch(selectedReleaseId, (nextId, prevId) => {
  if (nextId && nextId !== prevId && !loadingReleases.value) {
    void loadReleaseBoard(nextId)
  }
})

async function handleSwitchIdentity(): Promise<void> {
  await logoutSession()
  showToast('请重新选择测试身份')
  await router.push('/login')
}

onMounted(() => {
  void loadReleases()
})
</script>

<template>
  <AppShellMobile status-theme="dark">
    <!-- 顶部名创红品牌头 -->
    <section class="mgr-header">
      <div class="mgr-top-row">
        <div class="mgr-brand">
          <span class="mgr-brand-pill">MINISO</span>
          <span>店长督学</span>
        </div>
        <button
          type="button"
          class="switch-role-btn"
          data-testid="mgr-switch-account-btn"
          @click="handleSwitchIdentity"
        >
          切换角色
        </button>
      </div>
      <div class="mgr-profile" data-testid="mgr-profile-banner">
        <strong>{{ user?.name ?? '—' }}</strong>
        <span>{{ storeNamesLabel }} · 门店店长</span>
      </div>
    </section>

    <div class="mgr-body" data-testid="mgr-home-page">
      <!-- 待办提醒横幅 -->
      <section
        v-if="!loadingReleases && (totalPendingReview > 0 || totalOpenRetrains > 0)"
        class="todo-banner"
        data-testid="mgr-todo-banner"
      >
        <div class="todo-text">
          <strong>门店督学待办：</strong>
          待复查 <strong>{{ totalPendingReview }}</strong> 人 · 进行中补训
          <strong>{{ totalOpenRetrains }}</strong> 人
        </div>
        <button
          v-if="totalPendingReview > 0"
          type="button"
          class="btn-pill-red"
          @click="statusFilter = 'pending_review'"
        >
          只看待复查
        </button>
      </section>

      <div v-if="loadingReleases" class="card state-box" data-testid="mgr-loading">
        正在同步本店发布批次与 48 小时统计...
      </div>

      <div v-else-if="loadError" class="error-banner" role="alert" data-testid="mgr-load-error">
        <div class="error-banner-head">
          <span>{{ loadError.title }}</span>
          <button type="button" class="btn-pill-soft" @click="loadReleases">重试</button>
        </div>
        <div>{{ loadError.detail }}</div>
        <div v-if="loadError.requestId" class="error-request-id">
          code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
        </div>
      </div>

      <section v-else-if="releases.length === 0" class="card state-box" data-testid="mgr-empty-releases">
        <div class="card-title">当前门店暂无已发布课程批次</div>
        <p class="empty-sub">总部尚未向「{{ storeNamesLabel }}」定向发布新品课程。</p>
      </section>

      <template v-else>
        <!-- 批次选择器 -->
        <section class="card release-picker-card">
          <div class="card-head">
            <div>
              <div class="card-title">本店发布批次（{{ releases.length }}）</div>
              <div class="card-sub">切换查看不同上新批次的 48h 统计与员工卡点</div>
            </div>
            <button
              type="button"
              class="btn-pill-soft"
              data-testid="mgr-refresh-btn"
              @click="loadReleases"
            >
              刷新
            </button>
          </div>
          <div class="release-chips">
            <button
              v-for="rel in releases"
              :key="rel.release_id"
              type="button"
              class="release-chip"
              :class="{ active: rel.release_id === selectedReleaseId }"
              :data-testid="`mgr-release-chip-${rel.release_id}`"
              @click="selectedReleaseId = rel.release_id"
            >
              <div class="release-chip-title">{{ rel.course.name }}</div>
              <div class="release-chip-meta">
                <span>{{ formatDateTimeLabel(rel.published_at) }} 发布</span>
                <span>应训 {{ rel.assigned }} 人</span>
                <span v-if="rel.pending_review > 0" class="chip-alert">
                  待复查 {{ rel.pending_review }}
                </span>
              </div>
            </button>
          </div>
          <div v-if="selectedRelease" class="deadline-bar">
            任务截止：{{ formatDeadlineSummary(selectedRelease.deadline_at) }}
          </div>
        </section>

        <!-- 详情错误 -->
        <div v-if="detailError" class="error-banner" role="alert" data-testid="mgr-detail-error">
          <div class="error-banner-head">
            <span>{{ detailError.title }}</span>
            <button
              type="button"
              class="btn-pill-soft"
              @click="loadReleaseBoard(selectedReleaseId)"
            >
              重试
            </button>
          </div>
          <div>{{ detailError.detail }}</div>
        </div>

        <template v-else>
          <!-- 48 小时统计卡（紧凑 H5 模式） -->
          <ReleaseStatsCard :stats="stats" :compact="true" />

          <!-- 店员进度与卡点列表 -->
          <section class="card">
            <div class="card-head">
              <div>
                <div class="card-title">授权店员进度与卡点（{{ filteredAssignees.length }}）</div>
                <div class="card-sub">点击店员查看复练证据、指派补训或确认复查</div>
              </div>
            </div>

            <div class="filter-strip" role="tablist" aria-label="店员状态筛选">
              <button
                v-for="opt in filterOptions"
                :key="opt.key"
                type="button"
                role="tab"
                :aria-selected="statusFilter === opt.key"
                class="filter-pill"
                :class="{ active: statusFilter === opt.key }"
                :data-testid="`mgr-filter-${opt.key}`"
                @click="statusFilter = opt.key"
              >
                {{ opt.label }}
              </button>
            </div>

            <div v-if="loadingDetail" class="state-box">正在刷新本店名单...</div>
            <div v-else-if="filteredAssignees.length === 0" class="state-box">
              当前筛选条件下暂无匹配店员。
            </div>
            <div v-else class="staff-list">
              <button
                v-for="row in filteredAssignees"
                :key="row.item.assignment_id"
                type="button"
                class="staff-row"
                :data-testid="`mgr-assignee-${row.item.assignment_id}`"
                @click="
                  router.push(
                    `/manager/assignments/${encodeURIComponent(row.item.assignment_id)}`,
                  )
                "
              >
                <div class="staff-row-top">
                  <div class="staff-name-group">
                    <strong>{{ row.item.user.name }}</strong>
                    <span v-if="!row.item.user.active" class="inactive-badge">已离职</span>
                  </div>
                  <span class="status-badge" :class="`status-${row.view.badgeTone}`">
                    {{ row.view.badgeText }}
                  </span>
                </div>
                <div class="staff-row-meta">
                  <span>
                    章节 {{ row.item.completed_chapter_count }}/{{ row.item.required_chapters ?? 3 }}
                  </span>
                  <span>
                    最近 {{ row.item.last_score ?? '—' }} 分 · 最高 {{ row.item.best_score ?? '—' }} 分
                  </span>
                </div>
                <div v-if="row.item.open_retrain" class="staff-blocker">
                  补训考点：{{ row.item.open_retrain.focus.label }}（v{{
                    row.item.open_retrain.version
                  }}）
                </div>
                <div v-else-if="row.item.qualified_at" class="staff-qualified">
                  首次通关：{{ formatDateTimeLabel(row.item.qualified_at) }}
                </div>
              </button>
            </div>
          </section>
        </template>
      </template>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.mgr-header {
  background: linear-gradient(135deg, #ed1c24 0%, #cc121a 100%);
  color: #ffffff;
  padding: 8px 16px 14px;
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  flex-shrink: 0;
}

.mgr-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.mgr-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}

.mgr-brand-pill {
  background: #ffffff;
  color: var(--red);
  font-size: 12px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 6px;
}

.switch-role-btn {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.mgr-profile {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.94);
}

.mgr-profile strong {
  font-size: 15px;
  font-weight: 800;
  color: #ffffff;
}

.mgr-body {
  padding: 12px 14px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.todo-banner {
  background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
  border: 1px solid var(--red-border);
  border-radius: 14px;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.todo-text {
  font-size: 12px;
  color: var(--text);
}

.release-picker-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.release-chips {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.release-chip {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg);
  cursor: pointer;
}

.release-chip.active {
  background: var(--red-soft);
  border-color: var(--red);
}

.release-chip-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 3px;
}

.release-chip-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.chip-alert {
  color: var(--blue);
  font-weight: 700;
}

.deadline-bar {
  font-size: 12px;
  color: var(--muted);
}

.filter-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.filter-pill {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.filter-pill.active {
  background: var(--red);
  color: #ffffff;
  border-color: var(--red);
}

.staff-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.staff-row {
  width: 100%;
  text-align: left;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.staff-row:active {
  background: var(--red-soft);
  border-color: var(--red);
}

.staff-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.staff-name-group {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: var(--text);
}

.inactive-badge {
  font-size: 11px;
  background: var(--bg);
  color: var(--muted);
  padding: 1px 6px;
  border-radius: 999px;
}

.staff-row-meta {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}

.staff-blocker {
  font-size: 12px;
  color: var(--amber);
  font-weight: 600;
  background: var(--amber-soft);
  border-radius: 8px;
  padding: 4px 8px;
}

.staff-qualified {
  font-size: 11px;
  color: var(--green);
}

.state-box {
  text-align: center;
  padding: 20px 12px;
  font-size: 13px;
  color: var(--muted);
}

.empty-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}
</style>
