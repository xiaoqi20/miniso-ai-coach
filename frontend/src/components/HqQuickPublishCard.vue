<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { ApiClientError, getApiMode } from '@/api/client'
import * as hqApi from '@/api/hq'
import { useToast } from '@/composables/useToast'
import { MOCK_STORES } from '@/mock/seed'
import type { HqPublishReleasePayload, HqReviewChecklist } from '@/types/api'
import { createClientUuid } from '@/utils/assignment'
import { buildCourseRubricFromForm } from '@/utils/courseRubric'
import { formatApiError, type FormattedApiError } from '@/utils/errors'

/**
 * 原型 1:1 复刻卡片：总部简版「新品录入与审校发布」。
 * 1. 评分规则、示范话术、顾客问法与关键词 100% 由当前商品表单动态生成，绝不串用其他商品；
 * 2. 支持断点续传与幂等恢复：建课后持久化 courseId / versionId / publishIdempotencyKey，
 *    当审校或发布阶段因网络中断导致响应丢失时，再次点击可沿用同一幂等键取回原批次，
 *    不会重复建课或重复生成应训任务。
 */
const emit = defineEmits<{
  created: [
    payload: {
      courseId: string
      courseName: string
      publishedRelease?: HqPublishReleasePayload
      replayed?: boolean
    },
  ]
}>()

interface PendingQuickPublish {
  skuCode: string
  courseId: string
  courseName: string
  versionId: string
  revision: number
  reviewed: boolean
  storeIds: string[]
  deadlineHours: number
  publishIdempotencyKey: string
}

const { showToast } = useToast()

function pendingStorageKey(): string {
  return `shouke_hq_quick_publish_pending_${getApiMode()}`
}

function readPendingTx(): PendingQuickPublish | null {
  try {
    const raw = window.sessionStorage.getItem(pendingStorageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingQuickPublish>
    if (
      parsed.courseId &&
      parsed.versionId &&
      parsed.publishIdempotencyKey &&
      Array.isArray(parsed.storeIds)
    ) {
      return parsed as PendingQuickPublish
    }
  } catch {
    // 忽略损坏缓存
  }
  return null
}

function persistPendingTx(tx: PendingQuickPublish | null): void {
  pendingTx.value = tx
  try {
    if (tx) {
      window.sessionStorage.setItem(pendingStorageKey(), JSON.stringify(tx))
    } else {
      window.sessionStorage.removeItem(pendingStorageKey())
    }
  } catch {
    // 忽略存储配额限制
  }
}

const initialPending = readPendingTx()

const form = reactive({
  sku_code: initialPending?.skuCode ?? '',
  name: initialPending?.courseName ?? '',
  price: '',
  cross: '',
  facts: '',
  desc: '',
})

const selectedStoreIds = shallowRef<string[]>(
  initialPending?.storeIds.length ? [...initialPending.storeIds] : ['store_bj'],
)
const deadlineHours = shallowRef(initialPending?.deadlineHours ?? 48)
const checklist = reactive<HqReviewChecklist>({
  price_verified: Boolean(initialPending),
  spec_verified: Boolean(initialPending),
  redline_verified: Boolean(initialPending),
})

const pendingTx = shallowRef<PendingQuickPublish | null>(initialPending)
const submitting = shallowRef(false)
const submitError = shallowRef<FormattedApiError | null>(null)

const hasPendingRecovery = computed(() => pendingTx.value !== null)
const allChecklistConfirmed = computed(
  () => checklist.price_verified && checklist.spec_verified && checklist.redline_verified,
)

function toggleAllChecklist(checked: boolean): void {
  checklist.price_verified = checked
  checklist.spec_verified = checked
  checklist.redline_verified = checked
}

function toggleStore(storeId: string): void {
  if (hasPendingRecovery.value) return
  if (selectedStoreIds.value.includes(storeId)) {
    if (selectedStoreIds.value.length === 1) {
      showToast('至少保留 1 家目标试点门店')
      return
    }
    selectedStoreIds.value = selectedStoreIds.value.filter((id) => id !== storeId)
  } else {
    selectedStoreIds.value = [...selectedStoreIds.value, storeId]
  }
}

function discardPendingAndReset(): void {
  persistPendingTx(null)
  submitError.value = null
  form.sku_code = ''
  form.name = ''
  form.price = ''
  form.cross = ''
  form.facts = ''
  form.desc = ''
  selectedStoreIds.value = ['store_bj']
  deadlineHours.value = 48
  toggleAllChecklist(false)
}

async function submitCourse(publishNow: boolean): Promise<void> {
  submitError.value = null
  const existingTx = pendingTx.value

  if (!existingTx) {
    const name = form.name.trim()
    if (!name) {
      submitError.value = {
        title: '请填写新品名称',
        detail: '新品名称为必填项，用于门店任务卡与学习详情页展示。',
        code: 'VALIDATION_ERROR',
        requestId: '',
        shouldRefresh: false,
      }
      return
    }
    if (publishNow) {
      const missingFields: string[] = []
      if (!form.price.trim()) missingFields.push('零售价')
      if (!form.facts.trim()) missingFields.push('必考核对事实点')
      if (!form.desc.trim()) missingFields.push('标准卖点与话术规范')
      if (missingFields.length > 0) {
        submitError.value = {
          title: '缺少经审校的完整课程内容，无法直接发布',
          detail: `请先补全「${missingFields.join('、')}」，或点击「存为待审校草稿」停留在草稿态继续完善。`,
          code: 'VALIDATION_ERROR',
          requestId: '',
          shouldRefresh: false,
        }
        return
      }
      if (!allChecklistConfirmed.value) {
        submitError.value = {
          title: '审校清单尚未全部确认',
          detail: '请先勾选人工审校确认（零售价、规格购买规则、禁用红线）后再提交发布。',
          code: 'REVIEW_CHECKLIST_INCOMPLETE',
          requestId: '',
          shouldRefresh: false,
        }
        return
      }
    }
  }

  submitting.value = true
  let tx: PendingQuickPublish | null = existingTx ? { ...existingTx } : null

  try {
    // 阶段 1：仅在尚未建课时调用 POST /hq/courses，建课后立即锁定断点状态
    if (!tx) {
      const name = form.name.trim()
      const skuCode =
        form.sku_code.trim() || `MINISO-SKU-${Date.now().toString(36).toUpperCase().slice(-6)}`
      const price = form.price.trim() || '以门店价签为准'
      const cross = form.cross.trim()
      const facts = form.facts.trim()
      const desc = form.desc.trim()

      const rubric = buildCourseRubricFromForm({ name, price, cross, facts, desc })
      const speech =
        desc ||
        `这款「${name}」零售价 ${price}${facts ? `，必考卖点包括：${facts}` : ''}。${
          cross ? `结账时可顺手推荐搭配「${cross}」提升连带。` : '接待顾客时请清晰介绍核心卖点与实用优势。'
        }`
      const actions: string[] = [
        `价格与必考事实：清晰传达零售价 ${price}${facts ? `、${facts}` : ''}。`,
      ]
      if (cross) {
        actions.push(`收银连带：主动推荐搭配「${cross}」提升客单。`)
      }

      const created = await hqApi.createHqCourse({
        sku_code: skuCode,
        name,
        content: {
          product: {
            name,
            summary: cross ? `${name} · 总部上新必考 · 推荐连带 ${cross}` : `${name} · 总部上新必考`,
            price,
            tag: '上新必考',
            icon: 'box',
          },
          chapters: [
            {
              key: 'ch1',
              short: '01 核心卖点',
              title: '核心卖点与必考核对事实',
              preview: facts || `${price} · ${name}核心卖点`,
              speech,
              actions,
              mantra: cross ? `记忆口诀：${name} + ${price} + 连带 ${cross}` : `记忆口诀：${name} + ${price}`,
            },
          ],
        },
        rubric,
      })

      if (!publishNow) {
        showToast(`已将「${name}」存为待审校草稿`)
        discardPendingAndReset()
        emit('created', {
          courseId: created.course.id,
          courseName: created.course.name,
        })
        return
      }

      tx = {
        skuCode,
        courseId: created.course.id,
        courseName: created.course.name,
        versionId: created.version.id,
        revision: created.version.revision,
        reviewed: false,
        storeIds: [...selectedStoreIds.value],
        deadlineHours: deadlineHours.value,
        publishIdempotencyKey: createClientUuid(),
      }
      persistPendingTx(tx)
    }

    // 阶段 2：审校（若上次审校成功但响应丢失，收到已 approved/published 冲突时自动视为已完成）
    if (!tx.reviewed) {
      try {
        await hqApi.reviewHqCourseVersion(tx.versionId, {
          checklist: { ...checklist },
          note: '总部简版录入并完成三项人工审校确认',
        })
      } catch (reviewErr) {
        const status =
          reviewErr instanceof ApiClientError && typeof reviewErr.details?.current_status === 'string'
            ? reviewErr.details.current_status
            : ''
        if (
          reviewErr instanceof ApiClientError &&
          reviewErr.code === 'STATE_CONFLICT' &&
          (status === 'approved' || status === 'published')
        ) {
          // 上次审校已落库仅响应丢失，直接推进至发布阶段
        } else {
          throw reviewErr
        }
      }
      tx = { ...tx, reviewed: true }
      persistPendingTx(tx)
    }

    // 阶段 3：定向发布（严格沿用固定 publishIdempotencyKey，响应丢失后重试可幂等取回原批次）
    const published = await hqApi.publishHqCourseVersion(
      tx.versionId,
      {
        store_ids: [...tx.storeIds],
        deadline_hours: tx.deadlineHours,
        expected_revision: tx.revision,
      },
      tx.publishIdempotencyKey,
    )
    const publishedRelease = published.data.release
    showToast(
      published.replayed
        ? `已恢复原发布批次 ${publishedRelease.id}（应训 ${publishedRelease.assigned_total} 人，未重复建课或建单）`
        : `已审校并发布「${tx.courseName}」至 ${tx.storeIds.length} 家门店（应训 ${publishedRelease.assigned_total} 人）`,
    )

    const doneCourseId = tx.courseId
    const doneCourseName = tx.courseName
    discardPendingAndReset()
    emit('created', {
      courseId: doneCourseId,
      courseName: doneCourseName,
      publishedRelease,
      replayed: published.replayed,
    })
  } catch (err) {
    submitError.value = formatApiError(
      err,
      tx
        ? '发布响应异常，课程草稿已保留，可直接点击「重试恢复原批次」'
        : publishNow
          ? '审校并发布失败'
          : '保存待审校草稿失败',
    )
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="card hq-quick-card" data-testid="hq-quick-publish-card">
    <div class="card-head">
      <div>
        <div class="card-title">总部简版：新品录入与审校发布</div>
        <div class="card-sub">审校价格 / 规格 / 红线后直达指定门店员工首屏</div>
      </div>
      <span class="tag-pill">人工审校把关</span>
    </div>

    <div
      v-if="pendingTx"
      class="recovery-banner"
      role="status"
      data-testid="hq-quick-recovery-banner"
    >
      <div class="recovery-head">
        <span>待恢复发布：{{ pendingTx.courseName }}（{{ pendingTx.skuCode }}）</span>
        <button
          type="button"
          class="recovery-reset-btn"
          :disabled="submitting"
          data-testid="hq-quick-discard-btn"
          @click="discardPendingAndReset"
        >
          放弃并新建
        </button>
      </div>
      <div class="recovery-sub">
        草稿已创建，再次点击主按钮将沿用同一防重键（<code>{{ pendingTx.publishIdempotencyKey.slice(0, 8) }}…</code>）取回原发布批次，不会重复创建课程或应训任务。
      </div>
    </div>

    <div v-if="submitError" class="error-banner" role="alert" data-testid="hq-quick-error">
      <div class="error-banner-head">
        <span>{{ submitError.title }}</span>
        <span class="error-request-id">{{ submitError.code }}</span>
      </div>
      <div>{{ submitError.detail }}</div>
    </div>

    <div class="field-label">1. 商品基础资料与核对事实</div>
    <div class="form-row-equal">
      <div class="input-wrap">
        <label for="hq-sku-name" class="sr-only">新品名称</label>
        <input
          id="hq-sku-name"
          v-model="form.name"
          type="text"
          class="input-field"
          :disabled="hasPendingRecovery"
          placeholder="新品名称（必填，如 39元桌面收纳盒）"
          data-testid="hq-quick-name"
        />
      </div>
      <div class="input-wrap">
        <label for="hq-sku-code" class="sr-only">SKU 编码</label>
        <input
          id="hq-sku-code"
          v-model="form.sku_code"
          type="text"
          class="input-field"
          :disabled="hasPendingRecovery"
          placeholder="SKU 编码（留空自动生成）"
          data-testid="hq-quick-sku"
        />
      </div>
    </div>

    <div class="form-row-2">
      <div class="input-wrap">
        <label for="hq-sku-price" class="sr-only">零售价</label>
        <input
          id="hq-sku-price"
          v-model="form.price"
          type="text"
          class="input-field"
          :disabled="hasPendingRecovery"
          placeholder="零售价（如 ¥39.00）"
          data-testid="hq-quick-price"
        />
      </div>
      <div class="input-wrap">
        <label for="hq-sku-cross" class="sr-only">连带商品</label>
        <input
          id="hq-sku-cross"
          v-model="form.cross"
          type="text"
          class="input-field"
          :disabled="hasPendingRecovery"
          placeholder="连带商品（如 分隔板 / 抽屉贴）"
          data-testid="hq-quick-cross"
        />
      </div>
    </div>

    <div class="input-wrap">
      <label for="hq-sku-facts" class="sr-only">必考核对事实点</label>
      <input
        id="hq-sku-facts"
        v-model="form.facts"
        type="text"
        class="input-field"
        :disabled="hasPendingRecovery"
        placeholder="必考核对事实点（逗号分隔，如 食品级PP材质, 可叠加防尘）"
        data-testid="hq-quick-facts"
      />
    </div>

    <div class="input-wrap">
      <label for="hq-sku-desc" class="sr-only">标准卖点、陈列要求与话术规范</label>
      <textarea
        id="hq-sku-desc"
        v-model="form.desc"
        rows="3"
        class="textarea-field"
        :disabled="hasPendingRecovery"
        placeholder="输入本品标准卖点、陈列要求与话术规范..."
        data-testid="hq-quick-desc"
      />
    </div>

    <div class="field-label">2. 指定试点门店（当前示例员工/店长位于北京路旗舰店）</div>
    <div class="chip-group">
      <button
        v-for="store in MOCK_STORES"
        :key="store.id"
        type="button"
        class="chip-select-btn"
        :class="{ active: selectedStoreIds.includes(store.id) }"
        :disabled="hasPendingRecovery"
        :data-testid="`hq-quick-store-${store.id}`"
        @click="toggleStore(store.id)"
      >
        {{ store.name }}
      </button>
    </div>

    <div class="field-label">3. 规定通关截止时间</div>
    <div class="chip-group">
      <button
        v-for="hours in [24, 48, 72]"
        :key="hours"
        type="button"
        class="chip-select-btn"
        :class="{ active: deadlineHours === hours }"
        :disabled="hasPendingRecovery"
        :data-testid="`hq-quick-deadline-${hours}`"
        @click="deadlineHours = hours"
      >
        {{ hours }}小时内
      </button>
    </div>

    <label class="hq-check-row main-check">
      <input
        type="checkbox"
        :checked="allChecklistConfirmed"
        :disabled="hasPendingRecovery"
        data-testid="hq-quick-check-all"
        @change="toggleAllChecklist(($event.target as HTMLInputElement).checked)"
      />
      <span>人工审校确认：已核对零售价、规格购买规则与禁用红线</span>
    </label>

    <div class="sub-checklist-row">
      <label class="sub-check-pill">
        <input v-model="checklist.price_verified" type="checkbox" :disabled="hasPendingRecovery" />
        <span>零售价核对</span>
      </label>
      <label class="sub-check-pill">
        <input v-model="checklist.spec_verified" type="checkbox" :disabled="hasPendingRecovery" />
        <span>规格与规则核对</span>
      </label>
      <label class="sub-check-pill">
        <input v-model="checklist.redline_verified" type="checkbox" :disabled="hasPendingRecovery" />
        <span>禁用红线核对</span>
      </label>
    </div>

    <div class="btn-dual-row">
      <button
        v-if="!hasPendingRecovery"
        type="button"
        class="btn-secondary-soft draft-btn"
        :disabled="submitting"
        data-testid="hq-quick-save-draft-btn"
        @click="submitCourse(false)"
      >
        存为待审校草稿
      </button>
      <button
        type="button"
        class="btn-cta publish-btn"
        :disabled="submitting"
        data-testid="hq-quick-publish-btn"
        @click="submitCourse(true)"
      >
        {{
          submitting
            ? '提交中...'
            : hasPendingRecovery
              ? '重试恢复原发布批次'
              : '审校通过并发布'
        }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.hq-quick-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recovery-banner {
  background: var(--blue-soft);
  border: 1px solid #b3d8ff;
  color: var(--blue);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recovery-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-weight: 700;
}

.recovery-sub {
  color: var(--text-secondary);
  line-height: 1.45;
}

.recovery-reset-btn {
  border: 1px solid #91caff;
  background: #ffffff;
  color: var(--blue);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.field-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  margin-top: 4px;
}

.form-row-equal {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 8px;
}

.form-row-2 {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 8px;
}

.input-wrap {
  width: 100%;
}

.input-field,
.textarea-field {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 9px 11px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.input-field:focus,
.textarea-field:focus {
  background: #ffffff;
  border-color: var(--red);
  outline: none;
}

.input-field:disabled,
.textarea-field:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-select-btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chip-select-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.chip-select-btn.active {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
}

.hq-check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  background: var(--bg);
  border-radius: 10px;
  padding: 9px 11px;
  margin-top: 4px;
  cursor: pointer;
}

.hq-check-row input {
  width: 16px;
  height: 16px;
  accent-color: var(--red);
  flex-shrink: 0;
}

.sub-checklist-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.sub-check-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary);
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 9px;
  cursor: pointer;
}

.sub-check-pill input {
  accent-color: var(--red);
}

.btn-dual-row {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.draft-btn {
  flex: 1;
  height: 44px;
  background: var(--bg);
}

.publish-btn {
  flex: 1.4;
  height: 44px;
  font-size: 14px;
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
</style>
