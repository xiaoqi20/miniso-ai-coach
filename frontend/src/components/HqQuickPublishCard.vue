<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import * as hqApi from '@/api/hq'
import { useToast } from '@/composables/useToast'
import { MOCK_STORES, THERMOS_RUBRIC } from '@/mock/seed'
import type { HqPublishReleasePayload, HqReviewChecklist, RubricFactRule } from '@/types/api'
import { createClientUuid } from '@/utils/assignment'
import { formatApiError, type FormattedApiError } from '@/utils/errors'

/**
 * 原型 1:1 复刻卡片：总部简版「新品录入与审校发布」。
 * 支持一键「存为待审校草稿」（POST /hq/courses）或「审校通过并发布」
 * （POST /hq/courses -> POST /review -> POST /publish）。
 */
const emit = defineEmits<{
  created: [payload: { courseId: string; courseName: string; publishedRelease?: HqPublishReleasePayload }]
}>()

const { showToast } = useToast()

const form = reactive({
  sku_code: '',
  name: '',
  price: '¥59.00',
  cross: '9.9元防尘挂袋',
  facts: '零售价 59 元, 正版联名授权, 端盒 6 个不重复',
  desc: '',
})

const selectedStoreIds = shallowRef<string[]>(['store_bj'])
const deadlineHours = shallowRef(48)
const checklist = reactive<HqReviewChecklist>({
  price_verified: false,
  spec_verified: false,
  redline_verified: false,
})

const submitting = shallowRef(false)
const submitError = shallowRef<FormattedApiError | null>(null)

const allChecklistConfirmed = computed(
  () => checklist.price_verified && checklist.spec_verified && checklist.redline_verified,
)

function toggleAllChecklist(checked: boolean): void {
  checklist.price_verified = checked
  checklist.spec_verified = checked
  checklist.redline_verified = checked
}

function toggleStore(storeId: string): void {
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

function buildRequiredFacts(rawFacts: string, priceStr: string): RubricFactRule[] {
  const numericPrice = priceStr.replace(/[^\d.]/g, '') || '59'
  const rules: RubricFactRule[] = [
    {
      key: 'fact_price',
      label: `零售价 ${numericPrice} 元`,
      type: 'price',
      patterns: [numericPrice],
      negation_guard: true,
    },
  ]
  const extras = rawFacts
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes(numericPrice))
    .slice(0, 4)

  extras.forEach((label, idx) => {
    rules.push({
      key: `fact_custom_${idx + 1}`,
      label,
      type: 'groups',
      groups: [[label.slice(0, Math.min(4, label.length))]],
    })
  })
  return rules
}

async function submitCourse(publishNow: boolean): Promise<void> {
  submitError.value = null
  const name = form.name.trim()
  const desc = form.desc.trim()
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
  if (publishNow && !allChecklistConfirmed.value) {
    submitError.value = {
      title: '审校清单尚未全部确认',
      detail: '请先勾选人工审校确认（零售价、规格购买规则、禁用红线）后再提交发布。',
      code: 'REVIEW_CHECKLIST_INCOMPLETE',
      requestId: '',
      shouldRefresh: false,
    }
    return
  }

  submitting.value = true
  try {
    const skuCode =
      form.sku_code.trim() || `MINISO-SKU-${Date.now().toString(36).toUpperCase().slice(-6)}`
    const price = form.price.trim() || '¥59.00'
    const cross = form.cross.trim() || '热门连带配件'
    const speech =
      desc ||
      `这款「${name}」零售价 ${price}，为核心上新主推款。接待顾客时请先讲清核心卖点与规格规则，并顺手推荐搭配 ${cross} 提升连带。`

    const rubric = structuredClone(THERMOS_RUBRIC)
    rubric.required_facts = buildRequiredFacts(form.facts, price)
    rubric.scenario = {
      ...rubric.scenario,
      question: `这款「${name}」要 ${price}，核心亮点是什么？有什么注意事项吗？`,
      alt_question: `买「${name}」的话，搭配 ${cross} 怎么推荐更划算？`,
    }

    const created = await hqApi.createHqCourse({
      sku_code: skuCode,
      name,
      content: {
        product: {
          name,
          summary: `${name} · 总部上新必考 · 连带推荐 ${cross}`,
          price,
          tag: '上新必考',
          icon: 'box',
        },
        chapters: [
          {
            key: 'ch1',
            short: '01 核心卖点',
            title: '核心卖点与必考核对事实',
            preview: form.facts.trim() || `${price} · 核心卖点`,
            speech,
            actions: [
              `价格与事实：清晰传达 ${form.facts.trim() || price}。`,
              `收银连带：主动推荐搭配「${cross}」提升客单。`,
            ],
            mantra: `记忆口诀：${name} + ${price} + 连带 ${cross}`,
          },
        ],
      },
      rubric,
    })

    let publishedRelease: HqPublishReleasePayload | undefined
    if (publishNow) {
      await hqApi.reviewHqCourseVersion(created.version.id, {
        checklist: { ...checklist },
        note: '总部简版录入并完成三项人工审校确认',
      })
      const published = await hqApi.publishHqCourseVersion(
        created.version.id,
        {
          store_ids: [...selectedStoreIds.value],
          deadline_hours: deadlineHours.value,
          expected_revision: created.version.revision,
        },
        createClientUuid(),
      )
      publishedRelease = published.data.release
      showToast(
        `已审校并发布「${name}」至 ${selectedStoreIds.value.length} 家门店（应训 ${publishedRelease.assigned_total} 人）`,
      )
    } else {
      showToast(`已将「${name}」存为待审校草稿`)
    }

    // 重置录入表单
    form.sku_code = ''
    form.name = ''
    form.desc = ''
    toggleAllChecklist(false)

    emit('created', {
      courseId: created.course.id,
      courseName: created.course.name,
      publishedRelease,
    })
  } catch (err) {
    submitError.value = formatApiError(err, publishNow ? '审校并发布失败' : '保存待审校草稿失败')
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
          placeholder="新品名称（必填，如 三丽鸥联名香薰）"
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
          placeholder="零售价"
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
          placeholder="连带商品"
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
        placeholder="必考核对事实点（逗号分隔）"
      />
    </div>

    <div class="input-wrap">
      <label for="hq-sku-desc" class="sr-only">标准卖点、陈列要求与话术规范</label>
      <textarea
        id="hq-sku-desc"
        v-model="form.desc"
        rows="3"
        class="textarea-field"
        placeholder="输入标准卖点、陈列要求与话术规范..."
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
        data-testid="hq-quick-check-all"
        @change="toggleAllChecklist(($event.target as HTMLInputElement).checked)"
      />
      <span>人工审校确认：已核对零售价、规格购买规则与禁用红线</span>
    </label>

    <div class="sub-checklist-row">
      <label class="sub-check-pill">
        <input v-model="checklist.price_verified" type="checkbox" />
        <span>零售价核对</span>
      </label>
      <label class="sub-check-pill">
        <input v-model="checklist.spec_verified" type="checkbox" />
        <span>规格与规则核对</span>
      </label>
      <label class="sub-check-pill">
        <input v-model="checklist.redline_verified" type="checkbox" />
        <span>禁用红线核对</span>
      </label>
    </div>

    <div class="btn-dual-row">
      <button
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
        {{ submitting ? '提交中...' : '审校通过并发布' }}
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
  grid-template-columns: 120px 1fr;
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
