<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import * as hqApi from '@/api/hq'
import AppShellDesktop from '@/components/AppShellDesktop.vue'
import ReleaseStatsCard from '@/components/ReleaseStatsCard.vue'
import type {
  HqReleaseAssigneeItem,
  HqReleaseDetailResponse,
  ReleaseStatsResponse,
} from '@/types/api'
import {
  formatDateTimeLabel,
  formatDeadlineSummary,
  presentAssignmentStatus,
} from '@/utils/assignment'
import { formatApiError, type FormattedApiError } from '@/utils/errors'
import { saveRecentReleaseRef } from '@/utils/hqReleases'

const route = useRoute()
const router = useRouter()

const releaseId = computed(() => String(route.params.releaseId ?? ''))
const releaseDetail = shallowRef<HqReleaseDetailResponse['release'] | null>(null)
const assignees = shallowRef<readonly HqReleaseAssigneeItem[]>([])
const stats = shallowRef<ReleaseStatsResponse | null>(null)
const statsUnavailableHint = shallowRef('')
const loading = shallowRef(true)
const loadError = shallowRef<FormattedApiError | null>(null)

const storeNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const target of releaseDetail.value?.targets ?? []) {
    map.set(target.store_id, target.store_name)
  }
  return map
})

const assigneeRows = computed(() =>
  assignees.value.map((item) => ({
    item,
    storeName: storeNameMap.value.get(item.store_id) ?? item.store_id,
    view: presentAssignmentStatus({
      status: item.status,
      completedCount: item.completed_chapter_count,
      requiredCount: item.required_chapters,
      lastScore: item.last_score,
      bestScore: item.best_score,
      openRetrain: item.open_retrain,
    }),
  })),
)

const fallbackSummary = computed(() => {
  const rel = releaseDetail.value
  if (!rel) return null
  return {
    assigned_total: rel.assigned_total,
    qualified_in_window: rel.qualified_in_window,
    pending_review: rel.pending_review,
    open_retrains: rel.open_retrains,
  }
})

async function loadRelease(id: string): Promise<void> {
  if (!id) return
  loading.value = true
  loadError.value = null
  statsUnavailableHint.value = ''
  releaseDetail.value = null
  assignees.value = []
  stats.value = null

  try {
    const [detailRes, assigneesRes] = await Promise.all([
      hqApi.getHqReleaseDetail(id),
      hqApi.listHqReleaseAssignees(id),
    ])
    releaseDetail.value = detailRes.release
    assignees.value = assigneesRes.items

    saveRecentReleaseRef({
      release_id: detailRes.release.id,
      course_name: detailRes.release.course.name,
      published_at: detailRes.release.published_at,
      store_names: detailRes.release.targets.map((t) => t.store_name),
      assigned_total: detailRes.release.assigned_total,
    })

    // T005 统计接口在联调前可能尚未部署；404 时降级展示 release 概要不阻断页面
    try {
      stats.value = await hqApi.getHqReleaseStats(id)
    } catch (statsErr) {
      if (statsErr instanceof ApiClientError && statsErr.status === 404) {
        statsUnavailableHint.value =
          '当前后端尚未挂载 48 小时分店明细统计接口（T005），已先展示发布批次实时摘要。'
      } else {
        const formatted = formatApiError(statsErr, '加载 48 小时统计失败')
        statsUnavailableHint.value = `${formatted.title}：${formatted.detail}`
      }
    }
  } catch (err) {
    loadError.value = formatApiError(err, '加载发布批次详情失败')
  } finally {
    loading.value = false
  }
}

watch(
  releaseId,
  (id) => {
    void loadRelease(id)
  },
  { immediate: true },
)
</script>

<template>
  <AppShellDesktop>
    <div class="release-page" data-testid="hq-release-detail-page">
      <div class="breadcrumb-bar">
        <button type="button" class="btn-secondary-soft" @click="router.push('/hq')">
          ← 返回总部工作台
        </button>
        <div class="breadcrumb-actions">
          <button
            v-if="releaseDetail"
            type="button"
            class="btn-secondary-soft"
            @click="router.push(`/hq/courses/${encodeURIComponent(releaseDetail.course.id)}`)"
          >
            查看所属课程
          </button>
          <button
            type="button"
            class="btn-secondary-soft"
            data-testid="hq-release-refresh-btn"
            @click="loadRelease(releaseId)"
          >
            刷新进度
          </button>
        </div>
      </div>

      <div v-if="loading" class="card empty-box" data-testid="hq-release-loading">
        正在加载发布批次「{{ releaseId }}」详情...
      </div>

      <div
        v-else-if="loadError"
        class="error-banner"
        role="alert"
        data-testid="hq-release-error"
      >
        <div class="error-banner-head">
          <span>{{ loadError.title }}</span>
          <button type="button" class="btn-pill-soft" @click="loadRelease(releaseId)">重试</button>
        </div>
        <div>{{ loadError.detail }}</div>
        <div v-if="loadError.requestId" class="error-request-id">
          code: {{ loadError.code }} · request_id: {{ loadError.requestId }}
        </div>
      </div>

      <template v-else-if="releaseDetail">
        <!-- 批次概要卡 -->
        <section class="card release-summary-card">
          <div class="card-head">
            <div>
              <div class="release-badges">
                <span class="sku-badge">{{ releaseDetail.id }}</span>
                <span class="status-badge status-ok">
                  {{ releaseDetail.status === 'published' ? '已发布生效中' : '已关闭' }}
                </span>
              </div>
              <h1 class="release-title">{{ releaseDetail.course.name }}</h1>
            </div>
            <div class="release-meta-right">
              <div>发布人：{{ releaseDetail.published_by.name }}</div>
              <div>发布时间：{{ formatDateTimeLabel(releaseDetail.published_at) }}</div>
              <div>截止时间：{{ formatDeadlineSummary(releaseDetail.deadline_at) }}</div>
            </div>
          </div>

          <div class="targets-strip">
            <span class="strip-label">定向门店快照：</span>
            <span
              v-for="target in releaseDetail.targets"
              :key="target.store_id"
              class="target-chip"
            >
              {{ target.store_name }}（{{ target.assigned_count }} 人）
            </span>
            <span class="version-ref">
              绑定版本 {{ releaseDetail.course_version_id }} / 规则 {{ releaseDetail.rubric_version_id }}
            </span>
          </div>
        </section>

        <!-- 48 小时统计卡 -->
        <ReleaseStatsCard
          :stats="stats"
          :fallback-summary="fallbackSummary"
          :unavailable-hint="statsUnavailableHint"
        />

        <!-- 应训名单快照表 -->
        <section class="card">
          <div class="card-head">
            <div>
              <div class="card-title">应训名单快照与学练进度（共 {{ assigneeRows.length }} 人）</div>
              <div class="card-sub">
                名单在发布事务内冻结；后续新增、离职或调店均不改变本批次应训分母。
              </div>
            </div>
          </div>

          <div v-if="assigneeRows.length === 0" class="empty-box" data-testid="hq-empty-assignees">
            本批次目标门店发布时暂无在职员工（空名单批次），48 小时通关率按契约显示为「暂无应训人员」。
          </div>

          <div v-else class="table-wrap">
            <table class="assignee-table">
              <thead>
                <tr>
                  <th>员工</th>
                  <th>所属门店</th>
                  <th>当前状态</th>
                  <th>章节进度</th>
                  <th>最近 / 最高分</th>
                  <th>首次通关时间</th>
                  <th>进行中补训</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in assigneeRows"
                  :key="row.item.assignment_id"
                  :data-testid="`hq-assignee-${row.item.user.id}`"
                >
                  <td>
                    <strong>{{ row.item.user.name }}</strong>
                    <span v-if="!row.item.user.active" class="inactive-tag">已离职</span>
                  </td>
                  <td>{{ row.storeName }}</td>
                  <td>
                    <span class="status-badge" :class="`status-${row.view.badgeTone}`">
                      {{ row.view.badgeText }}
                    </span>
                  </td>
                  <td>{{ row.item.completed_chapter_count }} / {{ row.item.required_chapters }} 节</td>
                  <td>
                    {{ row.item.last_score ?? '—' }} / {{ row.item.best_score ?? '—' }}
                  </td>
                  <td>{{ formatDateTimeLabel(row.item.qualified_at) }}</td>
                  <td>
                    <span v-if="row.item.open_retrain" class="retrain-focus">
                      {{ row.item.open_retrain.focus.label }}
                    </span>
                    <span v-else class="muted-text">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </AppShellDesktop>
</template>

<style scoped>
.release-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.breadcrumb-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.breadcrumb-actions {
  display: flex;
  gap: 8px;
}

.release-summary-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.release-badges {
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

.release-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
}

.release-meta-right {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.targets-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.strip-label {
  color: var(--text-secondary);
  font-weight: 600;
}

.target-chip {
  background: var(--red-soft);
  color: var(--red-dark);
  border: 1px solid var(--red-border);
  padding: 3px 9px;
  border-radius: 999px;
  font-weight: 600;
}

.version-ref {
  margin-left: auto;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.table-wrap {
  overflow-x: auto;
}

.assignee-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.assignee-table th,
.assignee-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.assignee-table th {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  background: var(--bg);
}

.inactive-tag {
  margin-left: 6px;
  font-size: 11px;
  background: var(--bg);
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 1px 6px;
  border-radius: 999px;
}

.retrain-focus {
  font-size: 12px;
  color: var(--amber);
  font-weight: 600;
}

.muted-text {
  color: var(--muted);
}

.empty-box {
  text-align: center;
  padding: 26px 16px;
  color: var(--muted);
  font-size: 13px;
}
</style>
