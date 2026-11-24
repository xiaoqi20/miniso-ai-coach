<script setup lang="ts">
import { computed, reactive, shallowRef, watch } from 'vue'
import { MOCK_STORES } from '@/mock/seed'
import type {
  HqCourseVersionDetail,
  HqPublishReleasePayload,
  HqPublishRequest,
  HqReviewChecklist,
} from '@/types/api'
import { createClientUuid, formatDateTimeLabel, formatDeadlineSummary } from '@/utils/assignment'
import type { FormattedApiError } from '@/utils/errors'

/**
 * 总部审校清单与定向门店发布面板。
 * 职责：管理三项审校清单、目标门店、截止时间与发布幂等键（同参防重复、改参轮换新键）。
 */
const {
  version,
  reviewing = false,
  publishing = false,
  lastPublished = null,
  lastPublishReplayed = false,
  actionError = null,
  reviewBlockers = [],
  hasUnsavedDraft = false,
} = defineProps<{
  version: HqCourseVersionDetail
  reviewing?: boolean
  publishing?: boolean
  lastPublished?: HqPublishReleasePayload | null
  lastPublishReplayed?: boolean
  actionError?: FormattedApiError | null
  reviewBlockers?: readonly string[]
  hasUnsavedDraft?: boolean
}>()

const emit = defineEmits<{
  review: [payload: { checklist: HqReviewChecklist; note: string }]
  publish: [payload: { body: HqPublishRequest; idempotencyKey: string }]
  openRelease: [releaseId: string]
  refresh: []
}>()

const checklist = reactive<HqReviewChecklist>({
  price_verified: false,
  spec_verified: false,
  redline_verified: false,
})
const reviewNote = shallowRef('')

const selectedStoreIds = shallowRef<string[]>(['store_bj'])
const extraStoreInput = shallowRef('')
const deadlineHours = shallowRef(48)
const publishKey = shallowRef(createClientUuid())

const isDraft = computed(() => version.status === 'draft')
const canPublish = computed(
  () => version.status === 'approved' || version.status === 'published',
)
const isSuperseded = computed(() => version.status === 'superseded')

const effectiveStoreIds = computed(() => {
  const extra = extraStoreInput.value
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return Array.from(new Set([...selectedStoreIds.value, ...extra]))
})

const checklistComplete = computed(
  () => checklist.price_verified && checklist.spec_verified && checklist.redline_verified,
)

// 版本或修订号真正变化时才重置审校勾选与发布幂等键；使用原始字符串避免对象替换引起数组引用误触发
watch(
  () => `${version.id}:${version.revision}`,
  () => {
    checklist.price_verified = false
    checklist.spec_verified = false
    checklist.redline_verified = false
    reviewNote.value = ''
    publishKey.value = createClientUuid()
  },
)

watch(
  () => `${effectiveStoreIds.value.join(',')}:${deadlineHours.value}`,
  () => {
    publishKey.value = createClientUuid()
  },
)

function toggleStore(storeId: string): void {
  if (selectedStoreIds.value.includes(storeId)) {
    selectedStoreIds.value = selectedStoreIds.value.filter((id) => id !== storeId)
  } else {
    selectedStoreIds.value = [...selectedStoreIds.value, storeId]
  }
}

function handleSubmitReview(): void {
  if (reviewing) return
  emit('review', {
    checklist: { ...checklist },
    note: reviewNote.value.trim(),
  })
}

function handleSubmitPublish(): void {
  if (publishing) return
  emit('publish', {
    body: {
      store_ids: effectiveStoreIds.value,
      deadline_hours: Number(deadlineHours.value),
      expected_revision: version.revision,
    },
    idempotencyKey: publishKey.value,
  })
}

function handlePrepareNewPublish(): void {
  publishKey.value = createClientUuid()
}
</script>

<template>
  <aside class="panel-stack" data-testid="hq-review-publish-panel">
    <!-- 统一操作错误反馈区 -->
    <div
      v-if="actionError"
      class="error-banner"
      role="alert"
      data-testid="hq-action-error"
    >
      <div class="error-banner-head">
        <span>{{ actionError.title }}</span>
        <button
          v-if="actionError.shouldRefresh"
          type="button"
          class="btn-pill-soft"
          data-testid="hq-error-refresh-btn"
          @click="emit('refresh')"
        >
          刷新最新状态
        </button>
      </div>
      <div>{{ actionError.detail }}</div>
      <div v-if="actionError.requestId" class="error-request-id">
        code: {{ actionError.code }} · request_id: {{ actionError.requestId }}
      </div>
    </div>

    <!-- 步骤一：人工审校确认 -->
    <section class="card panel-card">
      <div class="card-head">
        <div>
          <div class="card-title">步骤 1：人工审校确认</div>
          <div class="card-sub">审校通过即冻结本版本内容与评分规则</div>
        </div>
        <span class="status-badge" :class="isDraft ? 'status-warn' : 'status-ok'">
          {{ isDraft ? '待审校' : '已审校' }}
        </span>
      </div>

      <template v-if="isDraft">
        <div
          v-if="hasUnsavedDraft || reviewBlockers.length > 0"
          class="warn-box"
          role="status"
          data-testid="hq-review-blockers"
        >
          <strong>审校前置门槛未满足：</strong>
          <ul class="blocker-list">
            <li v-if="hasUnsavedDraft">草稿有未保存的编辑内容，请先点击「保存草稿变更」。</li>
            <li v-for="reason in reviewBlockers" :key="reason">{{ reason }}</li>
          </ul>
        </div>

        <div class="checklist-box">
          <label class="check-item">
            <input
              v-model="checklist.price_verified"
              type="checkbox"
              data-testid="hq-check-price"
            />
            <span>零售价已核对（与商品标签及必考价格规则一致）</span>
          </label>
          <label class="check-item">
            <input
              v-model="checklist.spec_verified"
              type="checkbox"
              data-testid="hq-check-spec"
            />
            <span>规格与购买规则已核对（如端盒数量、材质工艺等）</span>
          </label>
          <label class="check-item">
            <input
              v-model="checklist.redline_verified"
              type="checkbox"
              data-testid="hq-check-redline"
            />
            <span>话术禁用红线已核对（无违规疗效或促销承诺）</span>
          </label>
        </div>

        <div class="field-group">
          <label for="hq-review-note" class="field-label">审校说明（选填）</label>
          <input
            id="hq-review-note"
            v-model="reviewNote"
            type="text"
            class="text-input"
            placeholder="例如：已核对零售价、规格与话术红线"
            data-testid="hq-review-note"
          />
        </div>

        <button
          type="button"
          class="btn-cta"
          :disabled="reviewing"
          data-testid="hq-submit-review-btn"
          @click="handleSubmitReview"
        >
          {{
            reviewing
              ? '提交审校中...'
              : checklistComplete
                ? '确认三项核对 · 提交审校通过'
                : '提交审校通过（需勾选全部三项）'
          }}
        </button>
      </template>

      <div v-else class="reviewed-summary" data-testid="hq-reviewed-summary">
        <div>
          <strong>审校人：</strong>{{ version.reviewed_by?.name ?? '—' }}
        </div>
        <div>
          <strong>审校时间：</strong>{{ formatDateTimeLabel(version.reviewed_at) }}
        </div>
        <div class="reviewed-tip">版本已冻结为不可变快照，可直接定向发布至目标门店。</div>
      </div>
    </section>

    <!-- 步骤二：核对目标门店与截止时间并提交发布 -->
    <section class="card panel-card">
      <div class="card-head">
        <div>
          <div class="card-title">步骤 2：定向门店发布</div>
          <div class="card-sub">按目标门店当前在职员工生成不可变应训名单快照</div>
        </div>
      </div>

      <div v-if="isSuperseded" class="warn-box" data-testid="hq-superseded-notice">
        该版本已被更新版本替代（<code>superseded</code>），按契约禁止再次发布；请切换至最新版本或复制新草稿。
      </div>

      <template v-else>
        <div class="field-group">
          <span class="field-label">目标试点门店（可多选）</span>
          <div class="store-grid">
            <label
              v-for="store in MOCK_STORES"
              :key="store.id"
              class="store-check-card"
              :class="{ active: selectedStoreIds.includes(store.id) }"
            >
              <input
                type="checkbox"
                :checked="selectedStoreIds.includes(store.id)"
                :disabled="!canPublish"
                :data-testid="`hq-store-${store.id}`"
                @change="toggleStore(store.id)"
              />
              <div>
                <div class="store-name">{{ store.name }}</div>
                <div class="store-code">{{ store.id }} · {{ store.code }}</div>
              </div>
            </label>
          </div>
        </div>

        <div class="field-group">
          <label for="hq-extra-stores" class="field-label">
            补充门店 ID（选填，逗号分隔，用于联调自定义门店）
          </label>
          <input
            id="hq-extra-stores"
            v-model="extraStoreInput"
            type="text"
            class="text-input"
            :disabled="!canPublish"
            placeholder="例如 store_empty"
            data-testid="hq-extra-store-input"
          />
        </div>

        <div class="field-group">
          <label for="hq-deadline-hours" class="field-label">
            任务截止时间（1–168 小时，仅影响任务截止展示，不改变 48h 统计窗口）
          </label>
          <div class="deadline-row">
            <button
              v-for="hours in [24, 48, 72]"
              :key="hours"
              type="button"
              class="preset-chip"
              :class="{ active: deadlineHours === hours }"
              :disabled="!canPublish"
              :data-testid="`hq-deadline-${hours}`"
              @click="deadlineHours = hours"
            >
              {{ hours }} 小时
            </button>
            <input
              id="hq-deadline-hours"
              v-model.number="deadlineHours"
              type="number"
              min="1"
              max="168"
              class="text-input hours-input"
              :disabled="!canPublish"
              data-testid="hq-deadline-input"
            />
          </div>
        </div>

        <div class="publish-preview-line">
          拟发布门店：<strong>{{ effectiveStoreIds.join('、') || '未选择' }}</strong> · 截止
          <strong>{{ deadlineHours }}</strong> 小时 · 修订 #{{ version.revision }}
        </div>

        <div class="publish-actions">
          <button
            type="button"
            class="btn-cta"
            :disabled="!canPublish || publishing || effectiveStoreIds.length === 0"
            data-testid="hq-submit-publish-btn"
            @click="handleSubmitPublish"
          >
            {{
              !canPublish
                ? '请先完成步骤 1 人工审校'
                : publishing
                  ? '正在生成应训名单并发布...'
                  : '确认定向发布'
            }}
          </button>
          <div class="idempotency-hint">
            防重复键：<code>{{ publishKey.slice(0, 8) }}…</code>
            <button
              v-if="lastPublished"
              type="button"
              class="link-btn"
              data-testid="hq-new-publish-key-btn"
              @click="handlePrepareNewPublish"
            >
              生成新发布批次键
            </button>
          </div>
        </div>
      </template>
    </section>

    <!-- 发布结果卡 -->
    <section
      v-if="lastPublished"
      class="card result-card"
      data-testid="hq-publish-result-card"
    >
      <div class="card-head">
        <div>
          <div class="card-title">发布成功</div>
          <div class="card-sub">
            {{
              lastPublishReplayed
                ? '重复提交已命中幂等保护，直接返回首次创建的发布批次，未重复生成任务。'
                : '应训名单快照已写入，目标门店员工与店长可立即同步查看。'
            }}
          </div>
        </div>
        <span class="status-badge status-ok">{{ lastPublished.id }}</span>
      </div>
      <div class="result-meta">
        <div>发布人：{{ lastPublished.published_by.name }}</div>
        <div>发布时间：{{ formatDateTimeLabel(lastPublished.published_at) }}</div>
        <div>截止时间：{{ formatDeadlineSummary(lastPublished.deadline_at) }}</div>
        <div>
          应训总人数：<strong>{{ lastPublished.assigned_total }}</strong> 人（{{
            lastPublished.targets.map((t) => `${t.store_name} ${t.assigned_count}人`).join(' / ')
          }}）
        </div>
      </div>
      <button
        type="button"
        class="btn-pill-red result-cta"
        data-testid="hq-view-release-btn"
        @click="emit('openRelease', lastPublished.id)"
      >
        查看批次详情、应训名单与 48h 统计 →
      </button>
    </section>
  </aside>
</template>

<style scoped>
.panel-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.checklist-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
}

.check-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
}

.check-item input {
  margin-top: 3px;
  accent-color: var(--red);
}

.reviewed-summary {
  background: var(--green-soft);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reviewed-tip {
  font-size: 12px;
  color: var(--text-secondary);
}

.warn-box {
  background: var(--amber-soft);
  color: var(--amber);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
}

.blocker-list {
  margin: 6px 0 0 18px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.store-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.store-check-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #ffffff;
  cursor: pointer;
}

.store-check-card.active {
  border-color: var(--red);
  background: var(--red-soft);
}

.store-check-card input {
  accent-color: var(--red);
}

.store-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.store-code {
  font-size: 11px;
  color: var(--muted);
}

.deadline-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-chip {
  height: 34px;
  padding: 0 13px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.preset-chip.active {
  background: var(--red-soft);
  color: var(--red);
  border-color: var(--red);
}

.hours-input {
  width: 82px;
}

.text-input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  background: #ffffff;
}

.publish-preview-line {
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 10px;
}

.publish-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.idempotency-hint {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--muted);
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--blue);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.result-card {
  border-color: #b7eb8f;
  background: linear-gradient(135deg, #f6ffed 0%, #ffffff 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-meta {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.result-cta {
  width: 100%;
  height: 38px;
}
</style>
