<script setup lang="ts">
import { computed, onMounted, reactive, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import * as hqApi from '@/api/hq'
import AppShellDesktop from '@/components/AppShellDesktop.vue'
import { useToast } from '@/composables/useToast'
import { THERMOS_RUBRIC } from '@/mock/seed'
import type { CourseVersionStatus, HqCourseListItem } from '@/types/api'
import { formatDateTimeLabel } from '@/utils/assignment'
import { formatApiError, type FormattedApiError } from '@/utils/errors'
import { loadRecentReleaseRefs, type RecentReleaseRef } from '@/utils/hqReleases'

const router = useRouter()
const { showToast } = useToast()

const courses = shallowRef<readonly HqCourseListItem[]>([])
const recentReleases = shallowRef<readonly RecentReleaseRef[]>(loadRecentReleaseRefs())
const loading = shallowRef(true)
const loadError = shallowRef<FormattedApiError | null>(null)
const lookupReleaseId = shallowRef('')

const showCreateForm = shallowRef(false)
const creating = shallowRef(false)
const createError = shallowRef<FormattedApiError | null>(null)
const createForm = reactive({
  sku_code: '',
  name: '',
  price: '¥69.00',
  tag: '上新必考',
  summary: '',
  chapter1Title: '核心卖点与材质亮点',
  chapter1Speech: '',
  chapter1Mantra: '',
})

const summaryMetrics = computed(() => {
  const list = courses.value
  const draftCount = list.filter((c) => c.latest_version?.status === 'draft').length
  const approvedCount = list.filter((c) => c.latest_version?.status === 'approved').length
  const totalReleases = list.reduce((sum, c) => sum + c.published_release_count, 0)
  return { total: list.length, draftCount, approvedCount, totalReleases }
})

function versionStatusMeta(status: CourseVersionStatus | undefined) {
  switch (status) {
    case 'draft':
      return { text: '待审校草稿', cls: 'status-warn' }
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

async function loadCourses(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const res = await hqApi.listHqCourses()
    courses.value = res.items
    recentReleases.value = loadRecentReleaseRefs()
  } catch (err) {
    loadError.value = formatApiError(err, '加载总部课程列表失败')
  } finally {
    loading.value = false
  }
}

async function handleCreateCourse(): Promise<void> {
  createError.value = null
  const sku = createForm.sku_code.trim()
  const name = createForm.name.trim()
  const speech = createForm.chapter1Speech.trim()
  if (!sku || !name || !speech) {
    createError.value = {
      title: '请补全必填字段',
      detail: 'SKU 编码、商品名称及第 1 节口播讲解为必填项。',
      code: 'VALIDATION_ERROR',
      requestId: '',
      shouldRefresh: false,
    }
    return
  }

  creating.value = true
  try {
    const numericPrice = createForm.price.replace(/[^\d.]/g, '') || '69'
    const rubric = structuredClone(THERMOS_RUBRIC)
    rubric.required_facts[0] = {
      key: 'fact_price',
      label: `零售价 ${numericPrice} 元`,
      type: 'price',
      patterns: [numericPrice],
      negation_guard: true,
    }
    rubric.scenario = {
      ...rubric.scenario,
      question: `这款「${name}」售价 ${createForm.price}，核心卖点和亮点是什么？`,
      alt_question: `「${name}」适合什么场景使用？有没有搭配建议？`,
    }

    const res = await hqApi.createHqCourse({
      sku_code: sku,
      name,
      content: {
        product: {
          name,
          summary: createForm.summary.trim() || `${name} · 总部上新必考课程`,
          price: createForm.price.trim() || '¥69.00',
          tag: createForm.tag.trim() || '上新必考',
          icon: 'box',
        },
        chapters: [
          {
            key: 'ch1',
            short: '01 核心卖点',
            title: createForm.chapter1Title.trim() || '核心卖点讲解',
            preview: createForm.summary.trim() || name,
            speech,
            actions: [`准确介绍 ${name} 核心卖点与零售价 ${createForm.price}`],
            mantra: createForm.chapter1Mantra.trim() || `${name} 核心卖点牢记于心`,
          },
        ],
      },
      rubric,
    })
    showToast(`已创建新品草稿「${res.course.name}」`)
    showCreateForm.value = false
    await router.push(`/hq/courses/${encodeURIComponent(res.course.id)}`)
  } catch (err) {
    createError.value = formatApiError(err, '创建新品草稿失败')
  } finally {
    creating.value = false
  }
}

function handleLookupRelease(): void {
  const id = lookupReleaseId.value.trim()
  if (!id) {
    showToast('请输入发布批次 ID')
    return
  }
  void router.push(`/hq/releases/${encodeURIComponent(id)}`)
}

onMounted(() => {
  void loadCourses()
})
</script>

<template>
  <AppShellDesktop>
    <div class="hq-page" data-testid="hq-dashboard-page">
      <section class="hq-hero-bar">
        <div>
          <h1 class="hq-page-title">总部课程审校与定向发布</h1>
          <p class="hq-page-sub">
            草稿仅总部可见；人工完成三项审校清单后方可定向发布至目标门店，并按发布时应训名单快照追踪 48 小时通关率。
          </p>
        </div>
        <div class="hq-hero-actions">
          <button
            type="button"
            class="btn-secondary-soft"
            data-testid="hq-refresh-courses-btn"
            @click="loadCourses"
          >
            刷新列表
          </button>
          <button
            type="button"
            class="btn-pill-red hq-create-trigger"
            data-testid="hq-toggle-create-btn"
            @click="showCreateForm = !showCreateForm"
          >
            {{ showCreateForm ? '收起新建表单' : '+ 新建新品草稿' }}
          </button>
        </div>
      </section>

      <!-- KPI 概览 -->
      <section class="hq-kpi-row">
        <div class="card kpi-card">
          <div class="kpi-num">{{ summaryMetrics.total }}</div>
          <div class="kpi-label">新品课程总数</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-num warn">{{ summaryMetrics.draftCount }}</div>
          <div class="kpi-label">待审校草稿</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-num info">{{ summaryMetrics.approvedCount }}</div>
          <div class="kpi-label">已审校待发布</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-num ok">{{ summaryMetrics.totalReleases }}</div>
          <div class="kpi-label">累计发布批次</div>
        </div>
      </section>

      <!-- 新建新品草稿表单 -->
      <section v-if="showCreateForm" class="card create-panel" data-testid="hq-create-course-panel">
        <div class="card-head">
          <div>
            <div class="card-title">录入新品草稿（直接创建 v1 草稿与评分规则）</div>
            <div class="card-sub">创建后将进入审校工作台，可继续完善多节内容再提交人工审校。</div>
          </div>
        </div>
        <div v-if="createError" class="error-banner" role="alert">
          <div class="error-banner-head">
            <span>{{ createError.title }}</span>
            <span class="error-request-id">{{ createError.code }}</span>
          </div>
          <div>{{ createError.detail }}</div>
        </div>
        <div class="create-grid">
          <div class="field-group">
            <label for="new-sku-code" class="field-label">SKU 编码（唯一）*</label>
            <input
              id="new-sku-code"
              v-model="createForm.sku_code"
              type="text"
              class="text-input"
              placeholder="例如 MINISO-MUG-01"
            />
          </div>
          <div class="field-group">
            <label for="new-course-name" class="field-label">新品名称 *</label>
            <input
              id="new-course-name"
              v-model="createForm.name"
              type="text"
              class="text-input"
              placeholder="例如 三丽鸥联名陶瓷马克杯"
            />
          </div>
          <div class="field-group">
            <label for="new-course-price" class="field-label">零售价</label>
            <input id="new-course-price" v-model="createForm.price" type="text" class="text-input" />
          </div>
          <div class="field-group">
            <label for="new-course-tag" class="field-label">标签</label>
            <input id="new-course-tag" v-model="createForm.tag" type="text" class="text-input" />
          </div>
        </div>
        <div class="field-group">
          <label for="new-course-speech" class="field-label">第 1 节核心口播讲解 *</label>
          <textarea
            id="new-course-speech"
            v-model="createForm.chapter1Speech"
            rows="2"
            class="text-area"
            placeholder="输入导购标准口播卖点与价格说明..."
          />
        </div>
        <div class="create-actions">
          <button type="button" class="btn-secondary-soft" @click="showCreateForm = false">
            取消
          </button>
          <button
            type="button"
            class="btn-pill-red hq-create-trigger"
            :disabled="creating"
            data-testid="hq-submit-create-btn"
            @click="handleCreateCourse"
          >
            {{ creating ? '创建中...' : '创建并进入审校工作台' }}
          </button>
        </div>
      </section>

      <!-- 主体双栏：左课程列表 + 右最近发布批次查询 -->
      <div class="hq-grid-main">
        <section class="card">
          <div class="card-head">
            <div>
              <div class="card-title">新品课程与最新版本</div>
              <div class="card-sub">点击任一课程进入草稿编辑、三项审校清单与定向门店发布</div>
            </div>
          </div>

          <div v-if="loading" class="empty-box" data-testid="hq-courses-loading">
            正在加载总部课程目录...
          </div>

          <div v-else-if="loadError" class="error-banner" role="alert" data-testid="hq-courses-error">
            <div class="error-banner-head">
              <span>{{ loadError.title }}</span>
              <button type="button" class="btn-pill-soft" @click="loadCourses">重试</button>
            </div>
            <div>{{ loadError.detail }}</div>
            <div v-if="loadError.requestId" class="error-request-id">
              code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
            </div>
          </div>

          <div v-else-if="courses.length === 0" class="empty-box">
            暂无新品课程，请点击右上角「新建新品草稿」开始录入。
          </div>

          <div v-else class="course-table-list">
            <article
              v-for="item in courses"
              :key="item.course_id"
              class="course-row-card"
              :data-testid="`hq-course-row-${item.course_id}`"
            >
              <div class="course-row-main">
                <div class="course-row-top">
                  <span class="sku-badge">{{ item.sku_code }}</span>
                  <span
                    class="status-badge"
                    :class="versionStatusMeta(item.latest_version?.status).cls"
                  >
                    {{ versionStatusMeta(item.latest_version?.status).text }}
                  </span>
                </div>
                <h2 class="course-row-name">{{ item.name }}</h2>
                <div class="course-row-meta">
                  <span v-if="item.latest_version">
                    最新 v{{ item.latest_version.version_no }} · 修订 #{{ item.latest_version.revision }}
                  </span>
                  <span>已发布 {{ item.published_release_count }} 批次</span>
                  <span v-if="item.latest_version">
                    更新于 {{ formatDateTimeLabel(item.latest_version.updated_at) }}
                  </span>
                </div>
              </div>
              <button
                type="button"
                class="btn-pill-red"
                :data-testid="`hq-open-course-${item.course_id}`"
                @click="router.push(`/hq/courses/${encodeURIComponent(item.course_id)}`)"
              >
                {{ item.latest_version?.status === 'draft' ? '审校草稿' : '版本与发布' }}
              </button>
            </article>
          </div>
        </section>

        <aside class="hq-side-stack">
          <section class="card">
            <div class="card-head">
              <div>
                <div class="card-title">按批次 ID 查看发布结果</div>
                <div class="card-sub">查看应训名单快照与 48 小时通关统计</div>
              </div>
            </div>
            <form class="lookup-form" @submit.prevent="handleLookupRelease">
              <label for="hq-release-lookup" class="sr-only">输入发布批次 ID</label>
              <input
                id="hq-release-lookup"
                v-model="lookupReleaseId"
                type="text"
                class="text-input"
                placeholder="输入 release_id（如 rls_m1_bj）"
                data-testid="hq-release-lookup-input"
              />
              <button type="submit" class="btn-secondary-soft" data-testid="hq-release-lookup-btn">
                查询
              </button>
            </form>
          </section>

          <section class="card">
            <div class="card-head">
              <div>
                <div class="card-title">最近发布批次</div>
                <div class="card-sub">快捷进入批次详情与 48 小时统计</div>
              </div>
            </div>
            <div v-if="recentReleases.length === 0" class="empty-box small">
              尚未记录发布批次，发布课程后会自动出现在此处。
            </div>
            <div v-else class="recent-list">
              <button
                v-for="rel in recentReleases"
                :key="rel.release_id"
                type="button"
                class="recent-item"
                :data-testid="`hq-recent-release-${rel.release_id}`"
                @click="router.push(`/hq/releases/${encodeURIComponent(rel.release_id)}`)"
              >
                <div class="recent-top">
                  <strong>{{ rel.course_name }}</strong>
                  <span class="sku-badge">{{ rel.release_id }}</span>
                </div>
                <div class="recent-meta">
                  <span>门店：{{ rel.store_names.join('、') || '—' }}</span>
                  <span>应训 {{ rel.assigned_total }} 人</span>
                  <span>{{ formatDateTimeLabel(rel.published_at) }}</span>
                </div>
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </AppShellDesktop>
</template>

<style scoped>
.hq-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.hq-hero-bar {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.hq-page-title {
  font-size: 22px;
  font-weight: 800;
  color: var(--text);
  margin-bottom: 4px;
}

.hq-page-sub {
  font-size: 13px;
  color: var(--text-secondary);
}

.hq-hero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hq-create-trigger {
  height: 40px;
  padding: 0 16px;
  font-size: 13px;
}

.hq-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.kpi-card {
  padding: 16px;
}

.kpi-num {
  font-size: 26px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.2;
}

.kpi-num.warn {
  color: var(--amber);
}

.kpi-num.info {
  color: var(--blue);
}

.kpi-num.ok {
  color: var(--green);
}

.kpi-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.hq-grid-main {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 0.9fr);
  gap: 16px;
  align-items: start;
}

.hq-side-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.course-table-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.course-row-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #ffffff;
}

.course-row-main {
  flex: 1;
  min-width: 0;
}

.course-row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.sku-badge {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.course-row-name {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  margin-bottom: 4px;
}

.course-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--muted);
}

.lookup-form {
  display: flex;
  gap: 8px;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-item {
  width: 100%;
  text-align: left;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recent-item:hover {
  border-color: var(--red-border);
  background: var(--red-soft);
}

.recent-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.recent-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.create-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.create-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.create-actions {
  display: flex;
  justify-content: flex-end;
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
  background: #ffffff;
}

.empty-box {
  text-align: center;
  padding: 28px 16px;
  color: var(--muted);
  font-size: 13px;
}

.empty-box.small {
  padding: 16px 8px;
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

@media (max-width: 900px) {
  .hq-kpi-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hq-grid-main {
    grid-template-columns: 1fr;
  }
}
</style>
