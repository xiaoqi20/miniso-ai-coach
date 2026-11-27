<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import type { CourseContent, HqCourseVersionDetail } from '@/types/api'

/**
 * 总部课程草稿编辑与评分规则核对组件。
 * draft 状态允许编辑并提交 expected_revision 乐观锁保存；非 draft 状态严格只读。
 */
const { version, saving = false } = defineProps<{
  version: HqCourseVersionDetail
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [content: CourseContent]
  dirtyChange: [dirty: boolean]
}>()

const editable = computed(() => version.status === 'draft')

const draft = reactive<CourseContent>({
  product: { name: '', summary: '', price: '', tag: '', icon: 'box' },
  chapters: [],
})

watch(
  () => version,
  (next) => {
    const cloned = structuredClone(next.content)
    draft.product = {
      name: cloned.product?.name ?? '',
      summary: cloned.product?.summary ?? '',
      price: cloned.product?.price ?? '',
      tag: cloned.product?.tag ?? '',
      icon: cloned.product?.icon ?? 'box',
    }
    draft.chapters = (cloned.chapters ?? []).map((ch) => ({
      ...ch,
      actions: [...(ch.actions ?? [])],
    }))
  },
  { immediate: true },
)

const isDirty = computed(
  () => JSON.stringify(draft) !== JSON.stringify(version.content),
)

watch(
  isDirty,
  (dirty) => {
    emit('dirtyChange', dirty)
  },
  { immediate: true },
)

function updateActionsText(index: number, raw: string): void {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  draft.chapters[index].actions = lines
}

function handleSubmit(): void {
  if (!editable.value || saving) return
  emit('save', structuredClone({ product: { ...draft.product }, chapters: draft.chapters.map((c) => ({ ...c, actions: [...c.actions] })) }))
}
</script>

<template>
  <section class="card editor-card" data-testid="hq-draft-editor">
    <div class="card-head">
      <div>
        <div class="card-title">
          课程内容与审校核对（v{{ version.version_no }} · 修订 #{{ version.revision }}）
        </div>
        <div class="card-sub">
          {{
            editable
              ? '草稿态支持编辑并保存；提交审校通过后内容与评分规则将冻结不可修改。'
              : '该版本已冻结只读；如需修改请点击上方「复制为新草稿版本」。'
          }}
        </div>
      </div>
      <button
        v-if="editable"
        type="button"
        class="btn-pill-red"
        :disabled="saving || !isDirty"
        data-testid="hq-save-draft-btn"
        @click="handleSubmit"
      >
        {{ saving ? '保存中...' : isDirty ? '保存草稿变更' : '已与服务端同步' }}
      </button>
    </div>

    <!-- 1. 商品基础信息 -->
    <div class="editor-section">
      <div class="section-heading">1. 商品基础资料</div>
      <div class="form-grid-2">
        <div class="field-group">
          <label for="hq-product-name" class="field-label">商品名称</label>
          <input
            id="hq-product-name"
            v-model="draft.product.name"
            type="text"
            class="text-input"
            :disabled="!editable"
            data-testid="hq-input-product-name"
          />
        </div>
        <div class="field-group">
          <label for="hq-product-price" class="field-label">零售价展示</label>
          <input
            id="hq-product-price"
            v-model="draft.product.price"
            type="text"
            class="text-input"
            :disabled="!editable"
            data-testid="hq-input-product-price"
          />
        </div>
      </div>
      <div class="form-grid-2">
        <div class="field-group">
          <label for="hq-product-tag" class="field-label">课程标签</label>
          <input
            id="hq-product-tag"
            v-model="draft.product.tag"
            type="text"
            class="text-input"
            :disabled="!editable"
          />
        </div>
        <div class="field-group">
          <label for="hq-product-summary" class="field-label">一句话卖点摘要</label>
          <input
            id="hq-product-summary"
            v-model="draft.product.summary"
            type="text"
            class="text-input"
            :disabled="!editable"
            data-testid="hq-input-product-summary"
          />
        </div>
      </div>
    </div>

    <!-- 2. 渐进式章节讲解 -->
    <div class="editor-section">
      <div class="section-heading">2. 授课章节内容（共 {{ draft.chapters.length }} 节）</div>
      <div class="chapter-stack">
        <div
          v-for="(chapter, idx) in draft.chapters"
          :key="chapter.key"
          class="chapter-box"
          :data-testid="`hq-chapter-${chapter.key}`"
        >
          <div class="chapter-box-head">
            <span class="tag-pill">{{ chapter.key }}</span>
            <span class="chapter-short">{{ chapter.short || `第 ${idx + 1} 节` }}</span>
          </div>
          <div class="form-grid-2">
            <div class="field-group">
              <label :for="`hq-ch-title-${chapter.key}`" class="field-label">章节标题</label>
              <input
                :id="`hq-ch-title-${chapter.key}`"
                v-model="chapter.title"
                type="text"
                class="text-input"
                :disabled="!editable"
              />
            </div>
            <div class="field-group">
              <label :for="`hq-ch-mantra-${chapter.key}`" class="field-label">记忆口诀</label>
              <input
                :id="`hq-ch-mantra-${chapter.key}`"
                v-model="chapter.mantra"
                type="text"
                class="text-input"
                :disabled="!editable"
              />
            </div>
          </div>
          <div class="field-group">
            <label :for="`hq-ch-speech-${chapter.key}`" class="field-label">核心讲解口播</label>
            <textarea
              :id="`hq-ch-speech-${chapter.key}`"
              v-model="chapter.speech"
              rows="2"
              class="text-area"
              :disabled="!editable"
              :data-testid="`hq-input-speech-${chapter.key}`"
            />
          </div>
          <div class="field-group">
            <label :for="`hq-ch-actions-${chapter.key}`" class="field-label">
              执行要点（每行一条）
            </label>
            <textarea
              :id="`hq-ch-actions-${chapter.key}`"
              :value="chapter.actions.join('\n')"
              rows="2"
              class="text-area"
              :disabled="!editable"
              @input="updateActionsText(idx, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 3. 绑定评分规则与必考事实核对（只读预览） -->
    <div v-if="version.rubric" class="editor-section rubric-preview">
      <div class="section-heading">
        3. 绑定评分规则核对（及格线 {{ version.rubric.pass_threshold }} 分 · 不可单独修改）
      </div>
      <div class="rubric-facts-grid">
        <div
          v-for="fact in version.rubric.required_facts"
          :key="fact.key"
          class="rubric-fact-item"
        >
          <div class="rubric-fact-top">
            <strong>{{ fact.label }}</strong>
            <span class="fact-key">{{ fact.key }}</span>
          </div>
          <div class="rubric-fact-rule">
            <template v-if="fact.type === 'price'">
              价格匹配词：{{ fact.patterns.join(' / ') }}（含否定语境防护）
            </template>
            <template v-else>
              分组命中：{{ fact.groups.map((g) => `[${g.join('/')}]`).join(' + ') }}
            </template>
          </div>
        </div>
      </div>
      <div class="redline-row">
        <span class="field-label">禁用红线词库（命中即一票否决）：</span>
        <span
          v-for="redline in version.rubric.redlines"
          :key="redline.term"
          class="redline-chip"
          :title="redline.reason"
        >
          {{ redline.term }}
        </span>
      </div>
      <div class="scenario-box">
        <div><strong>对练顾客画像：</strong>{{ version.rubric.scenario.persona_name }}</div>
        <div><strong>原问法：</strong>{{ version.rubric.scenario.question }}</div>
        <div><strong>换问法：</strong>{{ version.rubric.scenario.alt_question }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.editor-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.section-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.form-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.text-input,
.text-area {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
  background: #ffffff;
}

.text-input:disabled,
.text-area:disabled {
  background: var(--bg);
  color: var(--text-secondary);
  cursor: not-allowed;
}

.chapter-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chapter-box {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chapter-box-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chapter-short {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

.rubric-facts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 8px;
}

.rubric-fact-item {
  background: var(--bg);
  border-radius: 10px;
  padding: 10px;
  border: 1px solid var(--border);
}

.rubric-fact-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 4px;
}

.fact-key {
  font-size: 11px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.rubric-fact-rule {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.redline-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.redline-chip {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--red-soft);
  color: var(--red-dark);
  border: 1px solid var(--red-border);
}

.scenario-box {
  background: var(--bg);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
