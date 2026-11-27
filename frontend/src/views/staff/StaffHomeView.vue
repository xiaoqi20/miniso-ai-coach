<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import * as staffApi from '@/api/staff'
import AppShellMobile from '@/components/AppShellMobile.vue'
import ProductIcon from '@/components/ProductIcon.vue'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import type { StaffAssignmentSummary } from '@/types/api'
import { formatDeadlineSummary, presentAssignmentStatus } from '@/utils/assignment'

/**
 * 员工首页（1:1 复刻 static/index.html #screen-home 原型视觉与排版）。
 * 严格依据 GET /api/v1/me 与 GET /api/v1/staff/assignments 渲染：
 * 支持待学习、学习中、待对练、未通关、待补训、复练未改正、待复查、已通关、复查通过及空名单隔离态。
 */
const router = useRouter()
const { user, logoutSession } = useSession()
const { showToast } = useToast()

const assignments = shallowRef<readonly StaffAssignmentSummary[]>([])
const loading = shallowRef(true)
const errorMessage = shallowRef('')
const errorRequestId = shallowRef('')

const storeLabel = computed(() => user.value?.stores[0]?.name ?? '未分配门店')

/** 服务端已按「进行中补训优先 -> 截止时间升序」排好序，优先取首条未完成任务 */
const primaryAssignment = computed(() => {
  const actionable = assignments.value.find(
    (item) => item.status !== 'passed' && item.status !== 'verified',
  )
  return actionable ?? assignments.value[0] ?? null
})

const allCompleted = computed(
  () =>
    assignments.value.length > 0 &&
    assignments.value.every(
      (item) => item.status === 'passed' || item.status === 'verified',
    ),
)

const primaryPresentation = computed(() => {
  const item = primaryAssignment.value
  if (!item) return null
  return presentAssignmentStatus({
    status: item.status,
    completedCount: item.completed_chapter_count,
    requiredCount: item.required_chapters,
    lastScore: item.last_score,
    bestScore: item.best_score,
    openRetrain: item.open_retrain,
  })
})

/** 首页三栏 KPI 概览（100% 来自当前已下发任务真实字段，绝不编造 M2 积分/排名数据） */
const kpiStats = computed(() => {
  const total = assignments.value.length
  const passedCount = assignments.value.filter(
    (item) => item.status === 'passed' || item.status === 'verified',
  ).length
  const bestScores = assignments.value
    .map((item) => item.best_score)
    .filter((score): score is number => typeof score === 'number')
  const topScore = bestScores.length > 0 ? `${Math.max(...bestScores)}` : '—'
  return { total, passedCount, topScore }
})

const assignmentCards = computed(() =>
  assignments.value.map((item) => ({
    item,
    view: presentAssignmentStatus({
      status: item.status,
      completedCount: item.completed_chapter_count,
      requiredCount: item.required_chapters,
      lastScore: item.last_score,
      bestScore: item.best_score,
      openRetrain: item.open_retrain,
    }),
    deadlineLabel: formatDeadlineSummary(item.deadline_at),
  })),
)

async function loadAssignments(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  errorRequestId.value = ''
  try {
    const res = await staffApi.listStaffAssignments()
    assignments.value = res.items
  } catch (err) {
    if (err instanceof ApiClientError) {
      errorMessage.value = `${err.message}（${err.code}）`
      errorRequestId.value = err.requestId
    } else {
      errorMessage.value = '加载学习任务失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function goToAssignmentTarget(
  item: StaffAssignmentSummary,
  preferred: 'course' | 'roleplay',
): void {
  const encoded = encodeURIComponent(item.assignment_id)
  if (preferred === 'roleplay') {
    void router.push(`/staff/assignments/${encoded}/roleplay`)
    return
  }
  void router.push(`/staff/assignments/${encoded}`)
}

async function handleSwitchAccount(): Promise<void> {
  await logoutSession()
  showToast('请重新选择测试身份')
  await router.push('/login')
}

onMounted(() => {
  void loadAssignments()
})
</script>

<template>
  <AppShellMobile
    status-theme="dark"
    :show-bottom-nav="true"
    :roleplay-assignment-id="primaryAssignment?.assignment_id ?? null"
  >
    <!-- 顶部名创红品牌头（与原型 .home-header 保持一致） -->
    <section class="home-header">
      <div class="home-top-row">
        <div class="home-brand">
          <span class="home-brand-pill">MINISO</span>
          <span>产品授课</span>
        </div>
        <button
          type="button"
          class="switch-role-btn"
          data-testid="switch-account-btn"
          @click="handleSwitchAccount"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="16 3 21 3 21 8" />
            <line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" />
            <line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
          <span>切换角色</span>
        </button>
      </div>
      <div class="profile-banner">
        <div class="profile-inline" data-testid="staff-profile-banner">
          <strong>{{ user?.name ?? '—' }}</strong>{{ storeLabel }} · 门店员工
        </div>
      </div>
    </section>

    <div class="home-body">
      <div v-if="loading" class="card state-card" data-testid="staff-home-loading">
        正在同步服务端培训任务...
      </div>

      <div v-else-if="errorMessage" class="error-banner" role="alert" data-testid="staff-home-error">
        <div class="error-banner-head">
          <span>{{ errorMessage }}</span>
          <button type="button" class="btn-pill-soft" @click="loadAssignments">重试</button>
        </div>
        <div v-if="errorRequestId" class="error-request-id">
          request_id: {{ errorRequestId }}
        </div>
      </div>

      <!-- 空任务态（非目标门店隔离或尚无发布批次） -->
      <section
        v-else-if="assignments.length === 0"
        class="mission-card"
        data-testid="staff-home-empty"
      >
        <div class="mission-top">
          <span class="status-badge status-warn">{{ storeLabel }} · 暂无上新任务</span>
          <span class="mission-reward-pill">等待总部发布</span>
        </div>
        <div>
          <div class="mission-title">当前门店暂无待学上新任务</div>
          <div class="mission-sub">
            总部尚未向「{{ storeLabel }}」发布或仅存草稿的新品任务均不会显示，发布后将自动同步到这里。
          </div>
        </div>
      </section>

      <template v-else>
        <!-- 1. 今日必练动态主卡（复刻原型 .mission-card） -->
        <section
          v-if="primaryAssignment && primaryPresentation"
          class="mission-card"
          :class="{ completed: allCompleted }"
          data-testid="primary-mission-card"
        >
          <div class="mission-top">
            <span
              v-if="allCompleted"
              class="status-badge status-ok"
              data-testid="primary-mission-tag"
            >
              门店上新任务已达标
            </span>
            <span v-else class="tag-pill" data-testid="primary-mission-tag">
              {{ primaryPresentation.tagText }}
            </span>

            <span class="mission-reward-pill" data-testid="primary-mission-badge">
              {{
                allCompleted
                  ? `${assignments.length}/${assignments.length} 全部通关`
                  : primaryPresentation.badgeText
              }}
            </span>
          </div>

          <template v-if="allCompleted">
            <div>
              <div class="mission-title">本周新品训练已全部达标</div>
              <div class="mission-sub">
                本店 {{ assignments.length }} 项总部上新任务已全部达标（截止：{{
                  formatDeadlineSummary(primaryAssignment.deadline_at)
                }}）
              </div>
            </div>
            <div class="mission-review-row">
              <button
                type="button"
                class="btn-secondary-soft"
                style="flex: 1"
                @click="goToAssignmentTarget(primaryAssignment, 'roleplay')"
              >
                继续复练
              </button>
              <button
                type="button"
                class="mission-action-btn"
                style="flex: 1"
                @click="goToAssignmentTarget(primaryAssignment, 'course')"
              >
                复习课程
              </button>
            </div>
          </template>

          <div v-else class="mission-main-row">
            <div class="mission-info">
              <div class="mission-title">{{ primaryAssignment.course.name }}</div>
              <div class="mission-sub">
                <template v-if="primaryAssignment.open_retrain">
                  补训考点：{{ primaryAssignment.open_retrain.focus.label }} · 截止
                  {{ formatDeadlineSummary(primaryAssignment.deadline_at) }}
                </template>
                <template v-else-if="primaryAssignment.last_score !== null">
                  最近 {{ primaryAssignment.last_score }} 分（最高
                  {{ primaryAssignment.best_score }} 分，&ge;85 且必考项全中通关）
                </template>
                <template v-else>
                  已学 {{ primaryAssignment.completed_chapter_count }}/{{
                    primaryAssignment.required_chapters
                  }}
                  节 · 截止 {{ formatDeadlineSummary(primaryAssignment.deadline_at) }}
                </template>
              </div>
            </div>
            <button
              type="button"
              class="mission-action-btn"
              data-testid="primary-mission-cta"
              @click="goToAssignmentTarget(primaryAssignment, primaryPresentation.target)"
            >
              {{ primaryPresentation.ctaLabel }}
            </button>
          </div>
        </section>

        <!-- 2. 本人训练概览（复用原型 .kpi-grid 卡片风格） -->
        <section class="card">
          <div class="card-head">
            <div class="card-title">本店上新学练概览</div>
            <span class="card-sub">{{ storeLabel }}</span>
          </div>
          <div class="kpi-grid">
            <div class="kpi-item">
              <div class="kpi-num">{{ kpiStats.total }}</div>
              <div class="kpi-label">应训课程数</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">{{ kpiStats.passedCount }}/{{ kpiStats.total }}</div>
              <div class="kpi-label">已通关达标</div>
            </div>
            <div class="kpi-item">
              <div class="kpi-num">{{ kpiStats.topScore }}</div>
              <div class="kpi-label">对练最高分</div>
            </div>
          </div>
        </section>

        <!-- 3. 本店可见商品课程列表（1:1 复刻原型 .course-card） -->
        <section class="card">
          <div class="card-head">
            <div class="card-title">本店可见商品课程</div>
            <span class="card-sub">共 {{ assignments.length }} 款</span>
          </div>
          <div class="course-list">
            <div
              v-for="row in assignmentCards"
              :key="row.item.assignment_id"
              class="course-card"
              :data-testid="`assignment-item-${row.item.assignment_id}`"
              @click="goToAssignmentTarget(row.item, row.view.target)"
            >
              <ProductIcon icon="box" class="home-sku-icon" />
              <div class="course-info">
                <div class="course-top">
                  <span v-if="row.item.course.tag" class="tag-pill">
                    {{ row.item.course.tag }}
                  </span>
                  <span class="status-badge" :class="`status-${row.view.badgeTone}`">
                    {{ row.view.badgeText }}
                  </span>
                </div>
                <div class="course-name">{{ row.item.course.name }}</div>
                <div class="course-meta">
                  <span>{{ row.item.course.price ?? '' }}</span>
                  <span>
                    {{ row.item.completed_chapter_count }}/{{ row.item.required_chapters }} 节
                  </span>
                  <span>截止 {{ row.deadlineLabel }}</span>
                </div>
              </div>
              <button
                type="button"
                class="btn-pill-red"
                :data-testid="`assignment-cta-${row.item.assignment_id}`"
                @click.stop="goToAssignmentTarget(row.item, row.view.target)"
              >
                {{ row.view.ctaLabel }}
              </button>
            </div>
          </div>
        </section>
      </template>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.home-header {
  background: linear-gradient(135deg, #ed1c24 0%, #cc121a 100%);
  color: #ffffff;
  padding: 8px 16px 14px;
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  flex-shrink: 0;
}

.home-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.home-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  min-width: 0;
  white-space: nowrap;
}

.home-brand-pill {
  background: #ffffff;
  color: var(--red);
  font-size: 12px;
  font-weight: 900;
  padding: 2px 7px;
  border-radius: 6px;
}

.switch-role-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  padding: 5px 11px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}

.profile-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.profile-inline {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.96);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.profile-inline strong {
  font-size: 15px;
  font-weight: 800;
  color: #ffffff;
  margin-right: 6px;
}

.home-body {
  padding: 12px 14px calc(88px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.state-card {
  text-align: center;
  color: var(--text-secondary);
  padding: 24px 16px;
}

.mission-card {
  background: linear-gradient(135deg, #fff5f5 0%, #ffffff 100%);
  border: 1.5px solid var(--red-border);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mission-card.completed {
  background: linear-gradient(135deg, #f0fff6 0%, #ffffff 100%);
  border-color: #b7eb8f;
}

.mission-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mission-reward-pill {
  background: var(--red);
  color: #ffffff;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
}

.mission-card.completed .mission-reward-pill {
  background: var(--green);
}

.mission-main-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.mission-info {
  flex: 1;
  min-width: 0;
}

.mission-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.3;
}

.mission-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 3px;
  line-height: 1.45;
}

.mission-action-btn {
  height: 40px;
  padding: 0 16px;
  border-radius: 999px;
  border: none;
  background: var(--red);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-shadow: 0 6px 14px rgba(237, 28, 36, 0.22);
}

.mission-card.completed .mission-action-btn {
  background: var(--green);
  box-shadow: 0 6px 14px rgba(0, 168, 84, 0.22);
}

.mission-review-row {
  display: flex;
  gap: 8px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.kpi-item {
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 6px;
  text-align: center;
}

.kpi-num {
  font-size: 18px;
  font-weight: 800;
  color: var(--red);
  line-height: 1.2;
  margin-bottom: 3px;
}

.kpi-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.course-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.course-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border-radius: 14px;
  border: 1px solid var(--border);
  background: #ffffff;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.course-card:active {
  background: var(--red-soft);
  border-color: var(--red);
}

.home-sku-icon {
  width: 42px;
  height: 42px;
  border-radius: 11px;
}

.course-info {
  flex: 1;
  min-width: 0;
}

.course-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.course-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.35;
  margin-bottom: 3px;
}

.course-meta {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
</style>
