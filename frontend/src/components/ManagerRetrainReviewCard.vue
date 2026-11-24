<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import type {
  IssueRetrainRequest,
  ManagerAttemptDetail,
  ManagerRetrainDetail,
  ReviewRetrainRequest,
} from '@/types/api'
import { createClientUuid, formatDateTimeLabel } from '@/utils/assignment'

/**
 * 店长补训指派与待复查确认/驳回操作卡片。
 * 严格遵循 M1 §5.4 / §6.7.5 / §6.7.6：
 * - 单开补训：存在进行中补训时不重复指派；
 * - 补训考点只能选最近一次正式成绩中的 missed_required_facts；
 * - 复查必须基于冻结的 evidence_attempt_id 与 expected_version，携带 Idempotency-Key。
 */
const {
  attempts,
  retrains,
  submitting = false,
} = defineProps<{
  attempts: readonly ManagerAttemptDetail[]
  retrains: readonly ManagerRetrainDetail[]
  submitting?: boolean
}>()

const emit = defineEmits<{
  issueRetrain: [payload: { body: IssueRetrainRequest; idempotencyKey: string }]
  reviewRetrain: [
    payload: { retrainId: string; body: ReviewRetrainRequest; idempotencyKey: string },
  ]
}>()

const openRetrain = computed<ManagerRetrainDetail | null>(
  () =>
    retrains.find(
      (item) =>
        item.status === 'pending' ||
        item.status === 'submitted_unfixed' ||
        item.status === 'fixed_pending_review',
    ) ?? null,
)

const latestAttempt = computed<ManagerAttemptDetail | null>(() => attempts[0] ?? null)

const missedOptions = computed(() => latestAttempt.value?.missed_required_facts ?? [])

const frozenEvidence = computed<ManagerAttemptDetail | null>(() => {
  const id = openRetrain.value?.evidence_attempt_id
  if (!id) return null
  return attempts.find((att) => att.attempt_id === id) ?? null
})

const selectedFocusKey = shallowRef('')
const retrainNote = shallowRef('')
const reviewNote = shallowRef('')
const issueKey = shallowRef(createClientUuid())
const confirmKey = shallowRef(createClientUuid())
const rejectKey = shallowRef(createClientUuid())

watch(
  missedOptions,
  (opts) => {
    if (opts.length > 0 && !opts.some((o) => o.key === selectedFocusKey.value)) {
      selectedFocusKey.value = opts[0].key
    } else if (opts.length === 0) {
      selectedFocusKey.value = ''
    }
  },
  { immediate: true },
)

// 表单输入或补训版本变化时轮换对应幂等键，防止 409 IDEMPOTENCY_KEY_REUSED
watch([selectedFocusKey, retrainNote], () => {
  issueKey.value = createClientUuid()
})

watch(
  () => `${openRetrain.value?.id ?? ''}:${openRetrain.value?.version ?? ''}:${reviewNote.value}`,
  () => {
    confirmKey.value = createClientUuid()
    rejectKey.value = createClientUuid()
  },
)

function handleIssue(): void {
  if (!selectedFocusKey.value || submitting) return
  emit('issueRetrain', {
    body: {
      focus_fact_key: selectedFocusKey.value,
      note: retrainNote.value.trim(),
    },
    idempotencyKey: issueKey.value,
  })
}

function handleConfirm(): void {
  const rt = openRetrain.value
  if (!rt || !rt.evidence_attempt_id || submitting) return
  emit('reviewRetrain', {
    retrainId: rt.id,
    body: {
      decision: 'confirm',
      expected_version: rt.version,
      evidence_attempt_id: rt.evidence_attempt_id,
      note: reviewNote.value.trim(),
    },
    idempotencyKey: confirmKey.value,
  })
}

function handleReject(): void {
  const rt = openRetrain.value
  if (!rt || submitting) return
  emit('reviewRetrain', {
    retrainId: rt.id,
    body: {
      decision: 'reject',
      expected_version: rt.version,
      note: reviewNote.value.trim(),
    },
    idempotencyKey: rejectKey.value,
  })
}
</script>

<template>
  <!-- 场景 A：已改正待复查（最高优先级展示冻结证据与确认/驳回） -->
  <section
    v-if="openRetrain && openRetrain.status === 'fixed_pending_review'"
    class="card review-card"
    data-testid="mgr-pending-review-card"
  >
    <div class="card-head">
      <div>
        <div class="card-title">待复查确认 · 考点「{{ openRetrain.focus.label }}」</div>
        <div class="card-sub">
          工单版本 v{{ openRetrain.version }} · 冻结证据轮次 #{{ openRetrain.evidence_round_no ?? '—' }}
        </div>
      </div>
      <span class="status-badge status-info">待店长复查</span>
    </div>

    <div v-if="frozenEvidence" class="evidence-box" data-testid="mgr-frozen-evidence">
      <div class="evidence-head">
        <strong>复练证据（第 {{ frozenEvidence.round_no }} 轮 · {{ frozenEvidence.total }} 分）</strong>
        <span class="status-badge" :class="frozenEvidence.passed ? 'status-ok' : 'status-warn'">
          {{ frozenEvidence.passed ? '整轮达标' : '未达标' }}
        </span>
      </div>
      <p class="evidence-quote">“{{ frozenEvidence.answer_text }}”</p>
      <div class="fact-check-list">
        <div
          v-for="fc in frozenEvidence.fact_checks"
          :key="fc.key"
          class="fact-check-row"
          :class="{ focused: fc.key === openRetrain.focus.fact_key }"
        >
          <span class="fact-status" :class="fc.status === 'hit' ? 'hit' : 'miss'">
            {{ fc.status === 'hit' ? '命中' : '漏讲' }}
          </span>
          <span class="fact-label">{{ fc.label }}</span>
          <span v-if="fc.evidence" class="fact-evidence">「{{ fc.evidence }}」</span>
        </div>
      </div>
      <div v-if="frozenEvidence.redline_hits.length > 0" class="redline-alert">
        命中红线：{{ frozenEvidence.redline_hits.map((r) => `${r.term}（${r.reason}）`).join('、') }}
      </div>
    </div>

    <div class="field-group">
      <label for="mgr-review-note" class="field-label">复查意见（写入审计记录）</label>
      <input
        id="mgr-review-note"
        v-model="reviewNote"
        type="text"
        class="text-input"
        placeholder="例如：复练已讲清端盒规则，确认通过"
        data-testid="mgr-review-note-input"
      />
    </div>

    <div class="action-dual">
      <button
        type="button"
        class="btn-secondary-soft reject-btn"
        :disabled="submitting"
        data-testid="mgr-reject-review-btn"
        @click="handleReject"
      >
        {{ submitting ? '处理中...' : '驳回重练' }}
      </button>
      <button
        type="button"
        class="btn-cta confirm-btn"
        :disabled="submitting || !openRetrain.evidence_attempt_id"
        data-testid="mgr-confirm-review-btn"
        @click="handleConfirm"
      >
        {{ submitting ? '提交中...' : '确认复查通过' }}
      </button>
    </div>
  </section>

  <!-- 场景 B：已有进行中补训，等待店员提交合格复练 -->
  <section
    v-else-if="openRetrain"
    class="card open-retrain-card"
    data-testid="mgr-open-retrain-card"
  >
    <div class="card-head">
      <div>
        <div class="card-title">进行中补训 · 考点「{{ openRetrain.focus.label }}」</div>
        <div class="card-sub">
          指派人：{{ openRetrain.issued_by.name }} · {{ formatDateTimeLabel(openRetrain.issued_at) }}
        </div>
      </div>
      <span class="status-badge status-warn">
        {{ openRetrain.status === 'submitted_unfixed' ? '复练未改正' : '待店员复练' }}
      </span>
    </div>
    <p class="retrain-desc">
      基线轮次为第 {{ openRetrain.baseline_round_no }} 轮（当前版本 v{{ openRetrain.version }}）。
      <template v-if="openRetrain.status === 'submitted_unfixed'">
        店员已提交复练（第 {{ openRetrain.evidence_round_no ?? '—' }} 轮）但仍未整体通关，系统保留待办并禁止提前确认。
      </template>
      <template v-else>
        等待店员提交新的正式对练且整轮通关（≥85 分、无红线、必考事实全中）后，自动进入「待复查」。
      </template>
    </p>
    <div v-if="openRetrain.note" class="note-pill">补训说明：{{ openRetrain.note }}</div>
  </section>

  <!-- 场景 C：当前无进行中补训，支持按最近一次正式成绩漏讲项指派补训 -->
  <section v-else class="card issue-card" data-testid="mgr-issue-retrain-card">
    <div class="card-head">
      <div>
        <div class="card-title">指派漏讲补训</div>
        <div class="card-sub">仅限从最近一次正式成绩的漏讲必考事实中选取考点</div>
      </div>
    </div>

    <div v-if="!latestAttempt" class="muted-tip" data-testid="mgr-no-attempt-tip">
      该店员尚无正式对练成绩（<code>NO_ATTEMPT</code>），待其完成正式对练后再判断是否需要补训。
    </div>

    <div v-else-if="missedOptions.length === 0" class="muted-tip" data-testid="mgr-no-missed-tip">
      最近一次对练（第 {{ latestAttempt.round_no }} 轮，{{ latestAttempt.total }} 分）必考事实均已命中，当前无漏讲项可指派补训。
    </div>

    <template v-else>
      <div class="field-group">
        <span class="field-label">
          选择漏讲必考事实（来源：第 {{ latestAttempt.round_no }} 轮正式成绩）
        </span>
        <div class="chip-wrap">
          <button
            v-for="fact in missedOptions"
            :key="fact.key"
            type="button"
            class="focus-chip"
            :class="{ active: selectedFocusKey === fact.key }"
            :data-testid="`mgr-focus-option-${fact.key}`"
            @click="selectedFocusKey = fact.key"
          >
            {{ fact.label }}
          </button>
        </div>
      </div>

      <div class="field-group">
        <label for="mgr-retrain-note" class="field-label">补训说明（选填）</label>
        <input
          id="mgr-retrain-note"
          v-model="retrainNote"
          type="text"
          class="text-input"
          placeholder="例如：早会抽查未讲端盒规则，请今日内复练补齐"
          data-testid="mgr-retrain-note-input"
        />
      </div>

      <button
        type="button"
        class="btn-cta"
        :disabled="submitting || !selectedFocusKey"
        data-testid="mgr-issue-retrain-btn"
        @click="handleIssue"
      >
        {{ submitting ? '指派中...' : '确认指派补训' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.review-card {
  border: 1.5px solid #91caff;
  background: linear-gradient(180deg, #f0f7ff 0%, #ffffff 42%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.open-retrain-card,
.issue-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.evidence-box {
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.evidence-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.evidence-quote {
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 10px;
  line-height: 1.5;
}

.fact-check-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fact-check-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--bg);
}

.fact-check-row.focused {
  background: var(--green-soft);
  border: 1px solid #b7eb8f;
}

.fact-status {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
}

.fact-status.hit {
  background: var(--green-soft);
  color: var(--green);
}

.fact-status.miss {
  background: var(--red-soft);
  color: var(--red);
}

.fact-label {
  font-weight: 700;
  color: var(--text);
}

.fact-evidence {
  color: var(--text-secondary);
}

.redline-alert {
  font-size: 12px;
  color: var(--red-dark);
  background: var(--red-soft);
  border-radius: 8px;
  padding: 6px 8px;
  font-weight: 600;
}

.retrain-desc,
.muted-tip {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.55;
}

.note-pill {
  font-size: 12px;
  background: var(--amber-soft);
  color: var(--amber);
  border-radius: 10px;
  padding: 8px 10px;
  font-weight: 600;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.text-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  background: #ffffff;
}

.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.focus-chip {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
}

.focus-chip.active {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
}

.action-dual {
  display: flex;
  gap: 8px;
}

.reject-btn {
  flex: 0.9;
  height: 44px;
}

.confirm-btn {
  flex: 1.3;
  height: 44px;
}
</style>
