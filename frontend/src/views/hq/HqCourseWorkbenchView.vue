<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as hqApi from '@/api/hq'
import AppShellDesktop from '@/components/AppShellDesktop.vue'
import HqDraftEditor from '@/components/HqDraftEditor.vue'
import HqReviewPublishPanel from '@/components/HqReviewPublishPanel.vue'
import { useToast } from '@/composables/useToast'
import type {
  CourseContent,
  CourseVersionStatus,
  HqCourseDetailResponse,
  HqCourseVersionDetail,
  HqPublishReleasePayload,
  HqPublishRequest,
  HqReviewChecklist,
} from '@/types/api'
import { validateCourseVersionForReview } from '@/utils/courseRubric'
import { formatApiError, type FormattedApiError } from '@/utils/errors'
import { saveRecentReleaseRef } from '@/utils/hqReleases'

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

const courseId = computed(() => String(route.params.courseId ?? ''))
const detail = shallowRef<HqCourseDetailResponse | null>(null)
const selectedVersionId = shallowRef('')
const loading = shallowRef(true)
const loadError = shallowRef<FormattedApiError | null>(null)
const actionError = shallowRef<FormattedApiError | null>(null)

const saving = shallowRef(false)
const cloning = shallowRef(false)
const reviewing = shallowRef(false)
const publishing = shallowRef(false)
const hasUnsavedDraft = shallowRef(false)
const lastPublished = shallowRef<HqPublishReleasePayload | null>(null)
const lastPublishReplayed = shallowRef(false)

const activeVersion = computed<HqCourseVersionDetail | null>(() => {
  const list = detail.value?.versions ?? []
  if (list.length === 0) return null
  return list.find((v) => v.id === selectedVersionId.value) ?? list[list.length - 1]
})

const reviewBlockers = computed<readonly string[]>(() => {
  const ver = activeVersion.value
  if (!ver || ver.status !== 'draft') return []
  return validateCourseVersionForReview(ver)
})

function statusLabel(status: CourseVersionStatus): { text: string; cls: string } {
  if (status === 'draft') return { text: '草稿', cls: 'status-warn' }
  if (status === 'approved') return { text: '已审校', cls: 'status-info' }
  if (status === 'published') return { text: '已发布', cls: 'status-ok' }
  return { text: '已替代', cls: 'status-warn' }
}

let courseRequestSeq = 0

async function loadCourse(id: string, preferredVersionId?: string): Promise<void> {
  if (!id) return
  const reqSeq = ++courseRequestSeq
  if (!detail.value || detail.value.course.id !== id) {
    detail.value = null
    loading.value = true
  }
  loadError.value = null
  actionError.value = null
  try {
    const res = await hqApi.getHqCourseDetail(id)
    if (reqSeq !== courseRequestSeq || courseId.value !== id) return
    detail.value = res
    const versions = res.versions
    const keepId = preferredVersionId ?? selectedVersionId.value
    if (keepId && versions.some((v) => v.id === keepId)) {
      selectedVersionId.value = keepId
    } else if (versions.length > 0) {
      selectedVersionId.value = versions[versions.length - 1].id
    }
  } catch (err) {
    if (reqSeq !== courseRequestSeq || courseId.value !== id) return
    loadError.value = formatApiError(err, '加载课程详情失败')
  } finally {
    if (reqSeq === courseRequestSeq) {
      loading.value = false
    }
  }
}

async function handleSaveDraft(content: CourseContent): Promise<void> {
  const ver = activeVersion.value
  if (!ver || saving.value) return
  saving.value = true
  actionError.value = null
  try {
    const updated = await hqApi.updateHqCourseVersion(ver.id, {
      expected_revision: ver.revision,
      content,
    })
    showToast(`草稿已保存（修订 #${updated.revision}）`)
    await loadCourse(courseId.value, ver.id)
  } catch (err) {
    actionError.value = formatApiError(err, '保存草稿失败')
  } finally {
    saving.value = false
  }
}

async function handleCloneVersion(): Promise<void> {
  const ver = activeVersion.value
  if (!ver || ver.status === 'draft' || cloning.value) return
  cloning.value = true
  actionError.value = null
  try {
    const res = await hqApi.cloneHqCourseVersion(courseId.value, {
      source_version_id: ver.id,
    })
    lastPublished.value = null
    showToast(`已从 v${ver.version_no} 复制新草稿 v${res.version.version_no}`)
    await loadCourse(courseId.value, res.version.id)
  } catch (err) {
    actionError.value = formatApiError(err, '复制新草稿版本失败')
  } finally {
    cloning.value = false
  }
}

async function handleReview(payload: {
  checklist: HqReviewChecklist
  note: string
}): Promise<void> {
  const ver = activeVersion.value
  if (!ver || reviewing.value) return
  if (hasUnsavedDraft.value) {
    actionError.value = {
      title: '请先保存草稿变更再提交审校',
      detail: '检测到当前草稿存在未保存的修改，请先点击「保存草稿变更」后再执行人工审校。',
      code: 'UNSAVED_DRAFT',
      requestId: '',
      shouldRefresh: false,
    }
    return
  }
  const blockers = validateCourseVersionForReview(ver)
  if (blockers.length > 0) {
    actionError.value = {
      title: '草稿内容或评分规则尚未满足审校门槛',
      detail: `${blockers.join('；')}。请补齐并确认课件与评分规则一致后再审校发布。`,
      code: 'CONTENT_INCOMPLETE',
      requestId: '',
      shouldRefresh: false,
    }
    return
  }
  reviewing.value = true
  actionError.value = null
  try {
    const res = await hqApi.reviewHqCourseVersion(ver.id, {
      checklist: payload.checklist,
      note: payload.note || undefined,
    })
    showToast(`v${ver.version_no} 审校通过（${res.reviewed_by.name}）`)
    await loadCourse(courseId.value, ver.id)
  } catch (err) {
    actionError.value = formatApiError(err, '提交人工审校失败')
  } finally {
    reviewing.value = false
  }
}

async function handlePublish(payload: {
  body: HqPublishRequest
  idempotencyKey: string
}): Promise<void> {
  const ver = activeVersion.value
  if (!ver || publishing.value) return
  publishing.value = true
  actionError.value = null
  try {
    const res = await hqApi.publishHqCourseVersion(ver.id, payload.body, payload.idempotencyKey)
    lastPublished.value = res.data.release
    lastPublishReplayed.value = res.replayed
    saveRecentReleaseRef({
      release_id: res.data.release.id,
      course_name: detail.value?.course.name ?? ver.content.product.name,
      published_at: res.data.release.published_at,
      store_names: res.data.release.targets.map((t) => t.store_name),
      assigned_total: res.data.release.assigned_total,
    })
    showToast(
      res.replayed
        ? `重复提交已幂等返回原批次 ${res.data.release.id}`
        : `定向发布成功：${res.data.release.id}（应训 ${res.data.release.assigned_total} 人）`,
    )
    await loadCourse(courseId.value, ver.id)
  } catch (err) {
    actionError.value = formatApiError(err, '定向发布失败')
  } finally {
    publishing.value = false
  }
}

watch(
  courseId,
  (id) => {
    lastPublished.value = null
    lastPublishReplayed.value = false
    selectedVersionId.value = ''
    void loadCourse(id)
  },
  { immediate: true },
)
</script>

<template>
  <AppShellDesktop>
    <div class="workbench-page" data-testid="hq-course-workbench-page">
      <div class="top-bar">
        <button type="button" class="btn-secondary-soft" @click="router.push('/hq')">
          ← 返回课程工作台
        </button>
        <div class="top-bar-actions">
          <button
            v-if="activeVersion && activeVersion.status !== 'draft'"
            type="button"
            class="btn-secondary-soft"
            :disabled="cloning"
            data-testid="hq-clone-version-btn"
            @click="handleCloneVersion"
          >
            {{ cloning ? '复制中...' : `基于 v${activeVersion.version_no} 复制新草稿` }}
          </button>
          <button
            type="button"
            class="btn-secondary-soft"
            data-testid="hq-workbench-refresh-btn"
            @click="loadCourse(courseId, activeVersion?.id)"
          >
            刷新最新状态
          </button>
        </div>
      </div>

      <div v-if="loading" class="card empty-box" data-testid="hq-workbench-loading">
        正在加载新品课程与版本数据...
      </div>

      <div
        v-else-if="loadError"
        class="error-banner"
        role="alert"
        data-testid="hq-workbench-error"
      >
        <div class="error-banner-head">
          <span>{{ loadError.title }}</span>
          <button type="button" class="btn-pill-soft" @click="loadCourse(courseId)">重试</button>
        </div>
        <div>{{ loadError.detail }}</div>
        <div v-if="loadError.requestId" class="error-request-id">
          code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
        </div>
      </div>

      <template v-else-if="detail && activeVersion">
        <!-- 课程标题与版本切换条 -->
        <section class="card course-header-card">
          <div class="course-title-row">
            <div>
              <span class="sku-badge">{{ detail.course.sku_code }}</span>
              <h1 class="course-title">{{ detail.course.name }}</h1>
            </div>
            <span class="status-badge" :class="statusLabel(activeVersion.status).cls">
              当前 v{{ activeVersion.version_no }} · {{ statusLabel(activeVersion.status).text }}
            </span>
          </div>
          <div class="version-tabs" role="tablist" aria-label="课程版本切换">
            <button
              v-for="ver in detail.versions"
              :key="ver.id"
              type="button"
              role="tab"
              :aria-selected="ver.id === activeVersion.id"
              class="version-tab"
              :class="{ active: ver.id === activeVersion.id }"
              :data-testid="`hq-version-tab-${ver.id}`"
              @click="
                selectedVersionId = ver.id;
                actionError = null;
              "
            >
              <span>v{{ ver.version_no }}</span>
              <span class="tab-status">{{ statusLabel(ver.status).text }}</span>
            </button>
          </div>
        </section>

        <!-- 双栏主体：左侧草稿与规则，右侧审校与定向发布 -->
        <div class="workbench-grid">
          <HqDraftEditor
            :version="activeVersion"
            :saving="saving"
            @save="handleSaveDraft"
            @dirty-change="(dirty) => (hasUnsavedDraft = dirty)"
          />
          <HqReviewPublishPanel
            :version="activeVersion"
            :reviewing="reviewing"
            :publishing="publishing"
            :last-published="lastPublished"
            :last-publish-replayed="lastPublishReplayed"
            :action-error="actionError"
            :review-blockers="reviewBlockers"
            :has-unsaved-draft="hasUnsavedDraft"
            @review="handleReview"
            @publish="handlePublish"
            @open-release="(rid) => router.push(`/hq/releases/${encodeURIComponent(rid)}`)"
            @refresh="loadCourse(courseId, activeVersion.id)"
          />
        </div>
      </template>
    </div>
  </AppShellDesktop>
</template>

<style scoped>
.workbench-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.top-bar-actions {
  display: flex;
  gap: 8px;
}

.course-header-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.course-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.sku-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 2px 7px;
  border-radius: 6px;
  margin-bottom: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.course-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
}

.version-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.version-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
}

.version-tab.active {
  background: var(--red-soft);
  border-color: var(--red);
  color: var(--red);
}

.tab-status {
  font-weight: 600;
  opacity: 0.9;
}

.workbench-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(330px, 0.95fr);
  gap: 16px;
  align-items: start;
}

.empty-box {
  text-align: center;
  padding: 28px 16px;
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 960px) {
  .workbench-grid {
    grid-template-columns: 1fr;
  }
}
</style>
