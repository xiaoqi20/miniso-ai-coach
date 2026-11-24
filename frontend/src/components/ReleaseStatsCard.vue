<script setup lang="ts">
import { computed } from 'vue'
import type { ReleaseStatsResponse } from '@/types/api'
import { formatDateTimeLabel } from '@/utils/assignment'
import { formatPassRate } from '@/utils/errors'

/**
 * 48 小时通关统计展示卡（总部 PC 批次页与店长 H5 工作台复用）。
 * 严格遵循 M1 §7 统计口径：左闭右开 48 小时窗口、空名单展示「暂无应训人员」、
 * 区分窗口进行中/已定型，以及窗口后达标诊断数。
 */
const {
  stats,
  compact = false,
  fallbackSummary = null,
  unavailableHint = '',
} = defineProps<{
  stats: ReleaseStatsResponse | null
  compact?: boolean
  fallbackSummary?: {
    assigned_total: number
    qualified_in_window: number
    pending_review: number
    open_retrains: number
  } | null
  unavailableHint?: string
}>()

const rateDisplay = computed(() => {
  if (!stats) {
    if (!fallbackSummary) return '—'
    if (fallbackSummary.assigned_total === 0) return '暂无应训人员'
    return `${((fallbackSummary.qualified_in_window / fallbackSummary.assigned_total) * 100).toFixed(1)}%`
  }
  return formatPassRate(stats.rate, stats.empty_roster)
})

const windowBadge = computed(() => {
  if (!stats) return { text: '统计概要', cls: 'status-info' }
  return stats.window_open
    ? { text: '48h 窗口进行中（实时）', cls: 'status-info' }
    : { text: '48h 窗口已定型', cls: 'status-ok' }
})
</script>

<template>
  <section class="card stats-card" :class="{ compact }" data-testid="release-stats-card">
    <div class="card-head">
      <div>
        <div class="card-title">48 小时通关统计</div>
        <div v-if="stats" class="card-sub">
          窗口：[{{ formatDateTimeLabel(stats.window_start) }}, {{ formatDateTimeLabel(stats.window_end) }}) · 左闭右开
        </div>
        <div v-else class="card-sub">
          以服务端发布时间与应训名单快照计算
        </div>
      </div>
      <span class="status-badge" :class="windowBadge.cls" data-testid="stats-window-badge">
        {{ windowBadge.text }}
      </span>
    </div>

    <div v-if="unavailableHint" class="stats-hint-banner" data-testid="stats-fallback-hint">
      {{ unavailableHint }}
    </div>

    <div v-if="stats" class="stats-kpi-grid">
      <div class="stats-kpi-box highlight">
        <div class="stats-kpi-val" data-testid="stats-rate-value">{{ rateDisplay }}</div>
        <div class="stats-kpi-label">48h 通关率</div>
      </div>
      <div class="stats-kpi-box">
        <div class="stats-kpi-val" data-testid="stats-fraction-value">
          {{ stats.numerator }} / {{ stats.denominator }}
        </div>
        <div class="stats-kpi-label">窗口内达标 / 应训快照</div>
      </div>
      <div class="stats-kpi-box">
        <div class="stats-kpi-val" data-testid="stats-after-window-value">
          {{ stats.qualified_after_window }}
        </div>
        <div class="stats-kpi-label">窗口后达标（诊断）</div>
      </div>
    </div>

    <div v-else-if="fallbackSummary" class="stats-kpi-grid">
      <div class="stats-kpi-box highlight">
        <div class="stats-kpi-val" data-testid="stats-rate-value">{{ rateDisplay }}</div>
        <div class="stats-kpi-label">48h 估算通关率</div>
      </div>
      <div class="stats-kpi-box">
        <div class="stats-kpi-val">
          {{ fallbackSummary.qualified_in_window }} / {{ fallbackSummary.assigned_total }}
        </div>
        <div class="stats-kpi-label">窗口内达标 / 应训快照</div>
      </div>
      <div class="stats-kpi-box">
        <div class="stats-kpi-val">
          {{ fallbackSummary.pending_review }} / {{ fallbackSummary.open_retrains }}
        </div>
        <div class="stats-kpi-label">待复查 / 进行中补训</div>
      </div>
    </div>

    <div v-if="stats && !compact && stats.by_store.length > 0" class="store-stats-list">
      <div class="store-stats-head">分门店 48 小时明细</div>
      <div
        v-for="store in stats.by_store"
        :key="store.store_id"
        class="store-stat-row"
        :data-testid="`stats-store-${store.store_id}`"
      >
        <div class="store-stat-name">
          <strong>{{ store.store_name }}</strong>
          <span class="store-stat-id">{{ store.store_id }}</span>
        </div>
        <div class="store-stat-metrics">
          <span>达标 {{ store.numerator }}/{{ store.denominator }}</span>
          <span v-if="store.qualified_after_window > 0" class="after-tag">
            窗后 {{ store.qualified_after_window }}
          </span>
          <strong class="store-rate">{{ formatPassRate(store.rate, store.empty_roster) }}</strong>
        </div>
      </div>
    </div>

    <div v-if="stats" class="stats-footnote">
      口径说明：分母固定为发布时应训名单快照，分子按首次正式通关时间计入（复查确认时间及后续重复练习不改变分子）。
      统计计算于 {{ formatDateTimeLabel(stats.computed_at) }}。
    </div>
  </section>
</template>

<style scoped>
.stats-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stats-hint-banner {
  background: var(--blue-soft);
  color: var(--blue);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
}

.stats-kpi-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.stats-card.compact .stats-kpi-grid {
  gap: 8px;
}

.stats-kpi-box {
  background: var(--bg);
  border-radius: 12px;
  padding: 12px 10px;
  text-align: center;
}

.stats-kpi-box.highlight {
  background: var(--red-soft);
  border: 1px solid var(--red-border);
}

.stats-kpi-val {
  font-size: 20px;
  font-weight: 800;
  color: var(--text);
  line-height: 1.25;
  margin-bottom: 4px;
}

.stats-card.compact .stats-kpi-val {
  font-size: 16px;
}

.stats-kpi-box.highlight .stats-kpi-val {
  color: var(--red);
}

.stats-kpi-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.store-stats-list {
  border-top: 1px solid var(--border);
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.store-stats-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.store-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--bg);
  font-size: 13px;
}

.store-stat-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.store-stat-id {
  font-size: 11px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.store-stat-metrics {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
}

.after-tag {
  font-size: 11px;
  background: var(--amber-soft);
  color: var(--amber);
  padding: 1px 6px;
  border-radius: 999px;
  font-weight: 600;
}

.store-rate {
  color: var(--red);
  min-width: 72px;
  text-align: right;
}

.stats-footnote {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
</style>
