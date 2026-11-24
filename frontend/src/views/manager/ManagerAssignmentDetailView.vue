<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as managerApi from '@/api/manager'
import AppShellMobile from '@/components/AppShellMobile.vue'
import ManagerRetrainReviewCard from '@/components/ManagerRetrainReviewCard.vue'
import { useToast } from '@/composables/useToast'
import type {
  IssueRetrainRequest,
  ManagerAssignmentDetailResponse,
  OpenRetrain,
  ReviewRetrainRequest,
} from '@/types/api'
import { formatDateTimeLabel, presentAssignmentStatus } from '@/utils/assignment'
import { formatApiError, type FormattedApiError } from '@/utils/errors'

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const assignmentId = computed(() => String(route.params.assignmentId ?? ''))
const detail = shallowRef<ManagerAssignmentDetailResponse | null>(null)
const loading = shallowRef(true)
const loadError = shallowRef<FormattedApiError | null>(null)
const actionError = shallowRef<FormattedApiError | null>(null)
const submitting = shallowRef(false)

const currentOpenRetrain = computed<OpenRetrain | null>(() => {
  const rt = detail.value?.retrains.find(
    (item) =>
      item.status === 'pending' ||
      item.status === 'submitted_unfixed' ||
      item.status === 'fixed_pending_review',
  )
  if (!rt) return null
  return {
    id: rt.id,
    status: rt.status,
    focus: { ...rt.focus },
    issued_at: rt.issued_at,
    version: rt.version,
  }
})

const statusPresentation = computed(() => {
  const asg = detail.value?.assignment
  if (!asg) return null
  return presentAssignmentStatus({
    status: asg.status,
    completedCount: asg.completed_chapter_count,
    requiredCount: asg.required_chapters ?? 3,
    lastScore: asg.last_score,
    bestScore: asg.best_score,
    openRetrain: currentOpenRetrain.value,
  })
})

function auditActionLabel(action: string): string {
  switch (action) {
    case 'retrain.issued':
      return '指派补训'
    case 'retrain.confirmed':
      return '确认复查通过'
    case 'retrain.rejected':
      return '驳回复查要求重练'
    default:
      return action
  }
}

async function loadDetail(id: string): Promise<void> {
  if (!id) return
  if (!detail.value || detail.value.assignment.assignment_id !== id) {
    loading.value = true
  }
  loadError.value = null
  actionError.value = null
  try {
    detail.value = await managerApi.getManagerAssignmentDetail(id)
  } catch (err) {
    detail.value = null
    loadError.value = formatApiError(err, '加载店员训练详情失败')
  } finally {
    loading.value = false
  }
}

async function handleIssueRetrain(payload: {
  body: IssueRetrainRequest
  idempotencyKey: string
}): Promise<void> {
  if (!detail.value || submitting.value) return
  submitting.value = true
  actionError.value = null
  try {
    const res = await managerApi.issueManagerRetrain(
      detail.value.assignment.assignment_id,
      payload.body,
      payload.idempotencyKey,
    )
    showToast(
      res.replayed
        ? '重复提交已幂等返回原补训工单'
        : `已指派补训：${res.data.retrain.focus.label}`,
    )
    await loadDetail(assignmentId.value)
  } catch (err) {
    actionError.value = formatApiError(err, '指派补训失败')
  } finally {
    submitting.value = false
  }
}

async function handleReviewRetrain(payload: {
  retrainId: string
  body: ReviewRetrainRequest
  idempotencyKey: string
}): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  actionError.value = null
  try {
    const res = await managerApi.reviewManagerRetrain(
      payload.retrainId,
      payload.body,
      payload.idempotencyKey,
    )
    const msg =
      payload.body.decision === 'confirm'
        ? '已确认复查通过，审计记录已保存'
        : '已驳回复查并要求员工重新练习'
    showToast(res.replayed ? `重复提交已幂等返回结果（${msg}）` : msg)
    await loadDetail(assignmentId.value)
  } catch (err) {
    actionError.value = formatApiError(err, '提交复查结果失败')
  } finally {
    submitting.value = false
  }
}

watch(
  assignmentId,
  (id) => {
    void loadDetail(id)
  },
  { immediate: true },
)
</script>

<template>
  <AppShellMobile status-theme="light">
    <div class="subpage-nav">
      <button
        type="button"
        class="icon-btn"
        aria-label="返回店长工作台"
        data-testid="mgr-back-home-btn"
        @click="router.push('/manager')"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div class="subpage-title">
        {{ detail?.assignment.user.name ?? '店员详情' }} · 复查与补训
      </div>
      <button
        type="button"
        class="btn-pill-soft"
        data-testid="mgr-detail-refresh-btn"
        @click="loadDetail(assignmentId)"
      >
        刷新
      </button>
    </div>

    <div class="detail-body" data-testid="mgr-assignment-detail-page">
      <div v-if="loading" class="card state-box" data-testid="mgr-detail-loading">
        正在加载店员对练成绩与证据...
      </div>

      <div
        v-else-if="loadError"
        class="error-banner"
        role="alert"
        data-testid="mgr-detail-load-error"
      >
        <div class="error-banner-head">
          <span>{{ loadError.title }}</span>
          <button type="button" class="btn-pill-soft" @click="router.push('/manager')">
            返回列表
          </button>
        </div>
        <div>{{ loadError.detail }}</div>
        <div v-if="loadError.requestId" class="error-request-id">
          code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
        </div>
      </div>

      <template v-else-if="detail && statusPresentation">
        <!-- 操作错误反馈横幅（含乐观锁冲突与证据变更刷新按钮） -->
        <div
          v-if="actionError"
          class="error-banner"
          role="alert"
          data-testid="mgr-action-error"
        >
          <div class="error-banner-head">
            <span>{{ actionError.title }}</span>
            <button
              v-if="actionError.shouldRefresh"
              type="button"
              class="btn-pill-soft"
              data-testid="mgr-error-refresh-btn"
              @click="loadDetail(assignmentId)"
            >
              刷新最新状态
            </button>
          </div>
          <div>{{ actionError.detail }}</div>
          <div v-if="actionError.requestId" class="error-request-id">
            code: {{ actionError.code }} · request_id: {{ actionError.requestId }}
          </div>
        </div>

        <!-- 学员概览卡 -->
        <section class="card summary-card">
          <div class="card-head">
            <div>
              <div class="card-title">
                {{ detail.assignment.user.name }}
                <span v-if="!detail.assignment.user.active" class="inactive-tag">已离职</span>
              </div>
              <div class="card-sub">
                状态版本 v{{ detail.assignment.state_version }} · 章节
                {{ detail.assignment.completed_chapter_count }}/{{
                  detail.assignment.required_chapters ?? 3
                }}
              </div>
            </div>
            <span
              class="status-badge"
              :class="`status-${statusPresentation.badgeTone}`"
              data-testid="mgr-assignment-status-badge"
            >
              {{ statusPresentation.badgeText }}
            </span>
          </div>
          <div class="summary-grid">
            <div class="summary-cell">
              <div class="summary-val">{{ detail.assignment.last_score ?? '—' }}</div>
              <div class="summary-lbl">最近得分</div>
            </div>
            <div class="summary-cell">
              <div class="summary-val">{{ detail.assignment.best_score ?? '—' }}</div>
              <div class="summary-lbl">历史最高</div>
            </div>
            <div class="summary-cell">
              <div class="summary-val small">
                {{ formatDateTimeLabel(detail.assignment.qualified_at) }}
              </div>
              <div class="summary-lbl">首次达标时间</div>
            </div>
          </div>
        </section>

        <!-- 补训指派 / 待复查确认或驳回处置卡 -->
        <ManagerRetrainReviewCard
          :attempts="detail.attempts"
          :retrains="detail.retrains"
          :submitting="submitting"
          @issue-retrain="handleIssueRetrain"
          @review-retrain="handleReviewRetrain"
        />

        <!-- 正式对练成绩与逐项证据 -->
        <section class="card">
          <div class="card-head">
            <div>
              <div class="card-title">正式对练记录与核验证据（近 {{ detail.attempts.length }} 次）</div>
              <div class="card-sub">按轮次倒序展示员工原话、必考事实命中片段与红线检查</div>
            </div>
          </div>
          <div v-if="detail.attempts.length === 0" class="state-box">
            暂无正式对练记录。
          </div>
          <div v-else class="attempt-stack">
            <article
              v-for="att in detail.attempts"
              :key="att.attempt_id"
              class="attempt-item"
              :data-testid="`mgr-attempt-${att.attempt_id}`"
            >
              <div class="attempt-head">
                <strong>第 {{ att.round_no }} 轮 · {{ att.total }} 分</strong>
                <span class="status-badge" :class="att.passed ? 'status-ok' : 'status-warn'">
                  {{ att.passed ? '正式通关' : '未通关' }}
                </span>
              </div>
              <p class="attempt-answer">“{{ att.answer_text }}”</p>
              <div class="attempt-facts">
                <span
                  v-for="fc in att.fact_checks"
                  :key="fc.key"
                  class="fact-chip"
                  :class="fc.status === 'hit' ? 'hit' : 'miss'"
                >
                  {{ fc.status === 'hit' ? '✓' : '✗' }} {{ fc.label
                  }}{{ fc.evidence ? `（${fc.evidence}）` : '' }}
                </span>
              </div>
              <div v-if="att.redline_hits.length > 0" class="redline-line">
                红线命中：{{ att.redline_hits.map((r) => r.term).join('、') }}
              </div>
              <div class="attempt-time">{{ formatDateTimeLabel(att.computed_at) }}</div>
            </article>
          </div>
        </section>

        <!-- 补训与复查审计记录 -->
        <section class="card" data-testid="mgr-audit-section">
          <div class="card-head">
            <div>
              <div class="card-title">补训与复查审计轨迹（{{ detail.audit.length }}）</div>
              <div class="card-sub">保留操作人、服务端时间及复查结论，只追加不篡改</div>
            </div>
          </div>
          <div v-if="detail.audit.length === 0" class="state-box">暂无补训或复查审计记录。</div>
          <div v-else class="audit-stack">
            <div
              v-for="(ev, idx) in detail.audit"
              :key="`${ev.action}-${ev.at}-${idx}`"
              class="audit-row"
              data-testid="mgr-audit-item"
            >
              <div class="audit-row-top">
                <strong>{{ auditActionLabel(ev.action) }}</strong>
                <span class="audit-time">{{ formatDateTimeLabel(ev.at) }}</span>
              </div>
              <div class="audit-actor">
                操作人：{{ ev.actor.name }}（{{ ev.actor.id }}）
              </div>
              <div v-if="ev.payload.note" class="audit-note">
                说明：{{ String(ev.payload.note) }}
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.subpage-nav {
  height: 50px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.subpage-title {
  flex: 1;
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-body {
  padding: 12px 14px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.inactive-tag {
  margin-left: 6px;
  font-size: 11px;
  background: var(--bg);
  color: var(--muted);
  padding: 1px 6px;
  border-radius: 999px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.summary-cell {
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 6px;
  text-align: center;
}

.summary-val {
  font-size: 17px;
  font-weight: 800;
  color: var(--text);
}

.summary-val.small {
  font-size: 12px;
  line-height: 22px;
}

.summary-lbl {
  font-size: 11px;
  color: var(--muted);
}

.attempt-stack,
.audit-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.attempt-item {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.attempt-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.attempt-answer {
  font-size: 12px;
  color: var(--text);
  line-height: 1.5;
}

.attempt-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.fact-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
}

.fact-chip.hit {
  background: var(--green-soft);
  color: var(--green);
}

.fact-chip.miss {
  background: var(--red-soft);
  color: var(--red);
}

.redline-line {
  font-size: 12px;
  font-weight: 700;
  color: var(--red-dark);
}

.attempt-time,
.audit-time {
  font-size: 11px;
  color: var(--muted);
}

.audit-row {
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}

.audit-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.audit-actor {
  color: var(--text-secondary);
}

.audit-note {
  color: var(--text);
}

.state-box {
  text-align: center;
  padding: 20px 12px;
  font-size: 13px;
  color: var(--muted);
}
</style>
