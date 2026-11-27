<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import * as staffApi from '@/api/staff'
import AppShellMobile from '@/components/AppShellMobile.vue'
import ProductIcon from '@/components/ProductIcon.vue'
import { useToast } from '@/composables/useToast'
import type { StaffAssignmentDetailResponse } from '@/types/api'
import { formatDateTimeLabel } from '@/utils/assignment'

/**
 * 员工课程学习页（M1 §6.6.2 & §6.6.3）。
 * 支持渐进式披露章节学习、逐节幂等完成、最近正式成绩与补训焦点回看。
 * 遵循 M1 §6.6.3：全部章节完成后状态变为 ready_for_roleplay，不强行跳转对练，由员工确认进入。
 */
const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const assignmentId = computed(() => String(route.params.assignmentId ?? ''))

const detail = shallowRef<StaffAssignmentDetailResponse | null>(null)
const loading = shallowRef(true)
const errorCode = shallowRef('')
const errorMessage = shallowRef('')
const errorRequestId = shallowRef('')

/** 当前展开的章节 key；支持收起为 null */
const activeChapterKey = shallowRef<string | null>(null)
/** 当前展开逐字讲稿的章节 key */
const expandedSpeechKey = shallowRef<string | null>(null)
/** 正在提交完成的章节 key，防止连击并发 */
const completingChapterKey = shallowRef<string | null>(null)

const chapters = computed(() => detail.value?.course_version.content.chapters ?? [])
const completedSet = computed(
  () => new Set(detail.value?.progress.completed_chapters ?? []),
)
const completedCount = computed(() => completedSet.value.size)
const requiredCount = computed(() => detail.value?.assignment.required_chapters ?? 0)
const allChaptersDone = computed(
  () => requiredCount.value > 0 && completedCount.value >= requiredCount.value,
)

function pickInitialExpandedChapter(data: StaffAssignmentDetailResponse): string | null {
  const doneSet = new Set(data.progress.completed_chapters)
  const firstPending = data.course_version.content.chapters.find(
    (ch) => !doneSet.has(ch.key),
  )
  return firstPending?.key ?? data.course_version.content.chapters[0]?.key ?? null
}

async function loadDetail(): Promise<void> {
  if (!assignmentId.value) return
  loading.value = true
  errorCode.value = ''
  errorMessage.value = ''
  errorRequestId.value = ''
  try {
    const res = await staffApi.getStaffAssignment(assignmentId.value)
    detail.value = res
    if (!activeChapterKey.value) {
      activeChapterKey.value = pickInitialExpandedChapter(res)
    }
  } catch (err) {
    detail.value = null
    if (err instanceof ApiClientError) {
      errorCode.value = err.code
      errorMessage.value =
        err.status === 404
          ? '未找到该学习任务或无权访问（仅可查看已向本人发布的课程）'
          : `${err.message}（${err.code}）`
      errorRequestId.value = err.requestId
    } else {
      errorMessage.value = '加载课程详情失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function toggleChapter(key: string): void {
  activeChapterKey.value = activeChapterKey.value === key ? null : key
  expandedSpeechKey.value = null
}

function toggleSpeech(key: string): void {
  expandedSpeechKey.value = expandedSpeechKey.value === key ? null : key
}

async function handleCompleteChapter(chapterKey: string, idx: number): Promise<void> {
  if (!detail.value || completingChapterKey.value) return
  completingChapterKey.value = chapterKey
  try {
    const res = await staffApi.completeStaffChapter(
      detail.value.assignment.assignment_id,
      chapterKey,
    )
    // 通过重新加载详情与局部补齐确保 state_version、completed_at 与后端保持一致
    const currentDetail = detail.value
    const nextCompleted = res.already_completed
      ? currentDetail.progress.completed_chapters
      : Array.from(new Set([...currentDetail.progress.completed_chapters, chapterKey]))

    detail.value = {
      ...currentDetail,
      assignment: {
        ...currentDetail.assignment,
        status: res.assignment_status,
        completed_chapters: nextCompleted,
        state_version: res.state_version,
      },
      progress: {
        completed_chapters: nextCompleted,
        chapter_completed_at: {
          ...currentDetail.progress.chapter_completed_at,
          [chapterKey]: res.completed_at,
        },
      },
    }

    if (res.already_completed) {
      showToast('本节此前已确认学完，进度保持不变')
    } else if (res.completed_chapter_count >= res.required_chapters) {
      showToast('全部章节已学完！可点击「进入文字对练」开始通关挑战')
    } else {
      showToast(`已完成第 0${idx + 1} 节学习`)
      const nextChapter = chapters.value.find(
        (ch, chIdx) => chIdx > idx && !nextCompleted.includes(ch.key),
      ) ?? chapters.value.find((ch) => !nextCompleted.includes(ch.key))
      if (nextChapter) {
        activeChapterKey.value = nextChapter.key
      }
    }
  } catch (err) {
    if (err instanceof ApiClientError) {
      showToast(`${err.message}（${err.code}）`)
    } else {
      showToast('上报章节进度失败，请稍后重试')
    }
  } finally {
    completingChapterKey.value = null
  }
}

function goHome(): void {
  void router.push('/staff')
}

function goRoleplay(): void {
  void router.push(`/staff/assignments/${encodeURIComponent(assignmentId.value)}/roleplay`)
}

watch(assignmentId, () => {
  activeChapterKey.value = null
  expandedSpeechKey.value = null
  void loadDetail()
})

onMounted(() => {
  void loadDetail()
})
</script>

<template>
  <AppShellMobile
    status-theme="light"
    :show-bottom-nav="true"
    :roleplay-assignment-id="assignmentId"
  >
    <!-- 顶部返回导航 -->
    <header class="tutor-nav">
      <button type="button" class="icon-btn" aria-label="返回首页" @click="goHome">
        <svg
          width="20"
          height="20"
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
      <h1 class="tutor-nav-title">产品细节讲解</h1>
      <span v-if="detail" class="tag-pill">
        {{ detail.course_version.content.product.tag }}
      </span>
    </header>

    <div class="detail-scroll">
      <!-- 加载中 -->
      <div v-if="loading" class="card state-card" data-testid="course-loading">
        正在加载课程版本快照...
      </div>

      <!-- 404 / 越权 / 加载异常 -->
      <div v-else-if="errorMessage" class="card error-state-card" data-testid="course-error">
        <div class="error-banner" role="alert">
          <div class="error-banner-head">
            <span>{{ errorMessage }}</span>
          </div>
          <div v-if="errorRequestId" class="error-request-id">
            request_id: {{ errorRequestId }}
          </div>
        </div>
        <div class="error-actions">
          <button type="button" class="btn-secondary-soft" @click="goHome">返回员工首页</button>
          <button
            v-if="errorCode !== 'NOT_FOUND'"
            type="button"
            class="btn-pill-red"
            @click="loadDetail"
          >
            重试加载
          </button>
        </div>
      </div>

      <!-- 课程主体内容 -->
      <template v-else-if="detail">
        <!-- 补训提示条 -->
        <div
          v-if="detail.open_retrain"
          class="retrain-banner"
          data-testid="course-retrain-banner"
        >
          <div>
            <strong>补训要求：</strong>请重点巩固考点「{{ detail.open_retrain.focus.label }}」
          </div>
          <button type="button" class="btn-pill-red" @click="goRoleplay">去补练</button>
        </div>

        <!-- 商品摘要与分段学习进度 -->
        <section class="product-hero-card">
          <div class="hero-top-row">
            <ProductIcon :icon="detail.course_version.content.product.icon" />
            <div class="hero-info">
              <h2 class="hero-title">{{ detail.course_version.content.product.name }}</h2>
              <p class="hero-sub">{{ detail.course_version.content.product.summary }}</p>
            </div>
            <div class="hero-price-col">
              <div class="hero-price">{{ detail.course_version.content.product.price }}</div>
              <div
                class="hero-progress-label"
                :class="{ done: allChaptersDone }"
                data-testid="chapter-progress-text"
              >
                {{ completedCount }}/{{ requiredCount }} 节
              </div>
            </div>
          </div>

          <div class="step-segments" aria-label="章节学习进度条">
            <button
              v-for="ch in chapters"
              :key="ch.key"
              type="button"
              class="step-seg"
              :class="{
                active: activeChapterKey === ch.key,
                done: completedSet.has(ch.key),
              }"
              :aria-label="ch.short"
              @click="toggleChapter(ch.key)"
            />
          </div>
        </section>

        <!-- 渐进式披露章节手风琴列表 -->
        <section class="disclosure-stack">
          <article
            v-for="(ch, idx) in chapters"
            :key="ch.key"
            class="chapter-card"
            :class="{
              expanded: activeChapterKey === ch.key,
              done: completedSet.has(ch.key),
            }"
            :data-testid="`chapter-card-${ch.key}`"
          >
            <button type="button" class="chapter-head" @click="toggleChapter(ch.key)">
              <div class="step-num">
                <svg
                  v-if="completedSet.has(ch.key)"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span v-else>0{{ idx + 1 }}</span>
              </div>
              <div class="chapter-head-info">
                <div class="chapter-title">{{ ch.title }}</div>
                <div v-if="activeChapterKey !== ch.key" class="chapter-preview">
                  {{ ch.preview }}
                </div>
              </div>
              <svg
                class="chapter-chevron"
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
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <div v-if="activeChapterKey === ch.key" class="chapter-body">
              <div class="chapter-mantra-bar">{{ ch.mantra }}</div>

              <ul class="chapter-points">
                <li v-for="(action, aIdx) in ch.actions" :key="aIdx" class="chapter-point">
                  {{ action }}
                </li>
              </ul>

              <div class="speech-disclosure">
                <button
                  type="button"
                  class="speech-toggle-btn"
                  :aria-expanded="expandedSpeechKey === ch.key"
                  @click="toggleSpeech(ch.key)"
                >
                  <span>
                    {{
                      expandedSpeechKey === ch.key ? '收起讲师逐字稿' : '展开讲师讲解原话'
                    }}
                  </span>
                  <svg
                    class="chapter-chevron"
                    :class="{ open: expandedSpeechKey === ch.key }"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div v-if="expandedSpeechKey === ch.key" class="chapter-speech">
                  {{ ch.speech }}
                </div>
              </div>

              <div class="chapter-footer">
                <span
                  v-if="detail.progress.chapter_completed_at[ch.key]"
                  class="completed-time-label"
                >
                  已于 {{ formatDateTimeLabel(detail.progress.chapter_completed_at[ch.key]) }} 完成
                </span>
                <button
                  type="button"
                  class="chapter-next-btn"
                  :disabled="completingChapterKey === ch.key"
                  :data-testid="`complete-chapter-${ch.key}`"
                  @click="handleCompleteChapter(ch.key, idx)"
                >
                  <template v-if="completingChapterKey === ch.key">
                    <span>正在保存进度...</span>
                  </template>
                  <template v-else-if="completedSet.has(ch.key)">
                    <span>已学完 · 再次确认（幂等）</span>
                  </template>
                  <template v-else>
                    <span>
                      {{
                        idx + 1 < chapters.length
                          ? `已了解，进入下一节（0${idx + 2}）`
                          : '标记全部细节已学完'
                      }}
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </template>
                </button>
              </div>
            </div>
          </article>
        </section>

        <!-- 进入文字对练动作卡片 -->
        <section class="card roleplay-entry-card">
          <div class="entry-status-text">
            <template v-if="allChaptersDone">
              全部 {{ requiredCount }} 个章节已学完，可开始正式文字对练通关！
            </template>
            <template v-else>
              还差 {{ requiredCount - completedCount }} 个章节即可解锁正式对练（进入对练页仍可先行体验「演示试听」）。
            </template>
          </div>
          <button
            type="button"
            class="btn-cta"
            data-testid="enter-roleplay-btn"
            @click="goRoleplay"
          >
            {{ allChaptersDone ? '进入文字对练' : '前往对练页（可体验演示试听）' }}
          </button>
        </section>

        <!-- 最近正式对练成绩 -->
        <section v-if="detail.attempts.length > 0" class="card">
          <div class="card-head">
            <h3 class="card-title">最近正式成绩（最多 10 条）</h3>
            <span class="card-sub">v{{ detail.course_version.version_no }}</span>
          </div>
          <div class="attempt-list">
            <div
              v-for="att in detail.attempts"
              :key="att.attempt_id"
              class="attempt-row"
              :data-testid="`course-attempt-round-${att.round_no}`"
            >
              <div>
                <div class="attempt-main">
                  第 {{ att.round_no }} 轮 · {{ att.total }} 分
                  <span
                    class="status-badge"
                    :class="att.passed ? 'status-ok' : 'status-warn'"
                  >
                    {{ att.passed ? '已通关' : '未通关' }}
                  </span>
                </div>
                <div class="attempt-sub">
                  {{ formatDateTimeLabel(att.computed_at) }}
                  <template v-if="att.missed_required_facts.length > 0">
                    · 漏讲：{{ att.missed_required_facts.map((f) => f.label).join('、') }}
                  </template>
                  <template v-if="att.redline_hits.length > 0">
                    · 红线：{{ att.redline_hits.map((r) => r.term).join('、') }}
                  </template>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.tutor-nav {
  background: var(--card);
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.tutor-nav-title {
  flex: 1;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

.error-state-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.error-actions {
  display: flex;
  gap: 8px;
}

.retrain-banner {
  background: var(--red-soft);
  border: 1px solid var(--red-border);
  color: var(--red-dark);
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.product-hero-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hero-top-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hero-info {
  flex: 1;
  min-width: 0;
}

.hero-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--text);
}

.hero-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.hero-price-col {
  text-align: right;
  flex-shrink: 0;
}

.hero-price {
  font-size: 17px;
  font-weight: 900;
  color: var(--red);
}

.hero-progress-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.hero-progress-label.done {
  color: var(--green);
}

.step-segments {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.step-seg {
  height: 6px;
  border: none;
  border-radius: 999px;
  background: #eceef2;
  cursor: pointer;
}

.step-seg.active {
  background: var(--red);
}

.step-seg.done {
  background: var(--green);
}

.disclosure-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chapter-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.chapter-card.expanded {
  border-color: var(--red-border);
  box-shadow: var(--shadow-md);
}

.chapter-head {
  width: 100%;
  border: none;
  background: transparent;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  text-align: left;
}

.step-num {
  width: 28px;
  height: 28px;
  border-radius: 9px;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.chapter-card.expanded .step-num {
  background: var(--red);
  color: #ffffff;
}

.chapter-card.done .step-num {
  background: var(--green-soft);
  color: var(--green);
}

.chapter-head-info {
  flex: 1;
  min-width: 0;
}

.chapter-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.chapter-preview {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}

.chapter-chevron {
  color: var(--muted);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.chapter-card.expanded > .chapter-head .chapter-chevron,
.chapter-chevron.open {
  transform: rotate(180deg);
  color: var(--red);
}

.chapter-body {
  padding: 2px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.chapter-mantra-bar {
  background: var(--red-soft);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 13px;
  font-weight: 700;
  color: var(--red-dark);
}

.chapter-points {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 2px 4px;
}

.chapter-point {
  position: relative;
  padding-left: 14px;
  font-size: 13px;
  color: var(--text);
}

.chapter-point::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--red);
}

.speech-disclosure {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.speech-toggle-btn {
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 2px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
}

.chapter-speech {
  margin-top: 8px;
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.chapter-footer {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.completed-time-label {
  font-size: 11px;
  color: var(--green);
  font-weight: 600;
}

.chapter-next-btn {
  width: 100%;
  height: 44px;
  border-radius: 999px;
  border: none;
  background: var(--red);
  color: #ffffff;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: 0 6px 14px rgba(237, 28, 36, 0.22);
}

.chapter-next-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.roleplay-entry-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.entry-status-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.attempt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.attempt-row {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}

.attempt-row:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

.attempt-main {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
}

.attempt-sub {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}
</style>
