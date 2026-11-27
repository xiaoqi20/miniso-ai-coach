<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import RadarChart from '@/components/RadarChart.vue'
import type { RoleplayFullAttempt, RoleplayPreviewResponse } from '@/types/api'

/**
 * AI 四维雷达评分卡（1:1 复刻 static/app.js .radar-card 样式与信息层级）。
 * 同时支持「正式成绩」与「演示试听（persisted: false）」两种语义展示。
 */
const {
  result,
  isPreview = false,
  replayed = false,
  roundNo = null,
} = defineProps<{
  result: RoleplayFullAttempt | RoleplayPreviewResponse
  isPreview?: boolean
  replayed?: boolean
  roundNo?: number | null
}>()

const emit = defineEmits<{
  switchVariant: []
  startNextRound: []
}>()

const showCoachDetail = shallowRef(true)

const hitSummary = computed(() => {
  const hitFacts = result.fact_checks
    .filter((f) => f.status === 'hit')
    .map((f) => f.label)
  return hitFacts.length > 0 ? hitFacts.join('、') : '暂未命中必考项'
})

const vetoReason = computed(() => {
  if (result.passed) return ''
  if (result.redline_hits.length > 0) {
    return '触发话术红线一票否决'
  }
  if (result.missed_required_facts.length > 0 && result.total >= result.threshold) {
    return `总分已达 ${result.threshold} 分，但漏讲必考事实被一票否决`
  }
  if (result.missed_required_facts.length > 0) {
    return '漏讲必考事实且未达通关标准'
  }
  return `未达到通关线 ${result.threshold} 分`
})
</script>

<template>
  <section class="radar-card" data-testid="score-result-card">
    <div v-if="isPreview" class="demo-banner" data-testid="preview-banner">
      演示试听模式 · 仅用于查看示例效果，不写入正式成绩、章节进度与统计
    </div>

    <div v-else-if="replayed" class="replay-banner" data-testid="replay-banner">
      已恢复第 {{ roundNo }} 轮原评分结果，未重复提交或重复计分
    </div>

    <div class="radar-head">
      <div>
        <div class="radar-title">
          {{ isPreview ? 'AI 四维雷达评分卡（试听）' : `第 ${roundNo ?? ''} 轮 AI 四维雷达评分卡` }}
        </div>
        <div class="radar-hits">命中必考：{{ hitSummary }}</div>
      </div>
      <div class="radar-total-wrap">
        <span class="radar-total-score" data-testid="score-total">{{ result.total }}</span>
        <span
          class="status-badge"
          :class="result.passed ? 'status-ok' : 'status-warn'"
          data-testid="score-passed-badge"
        >
          {{ result.passed ? '已通关' : '建议复练' }}
        </span>
      </div>
    </div>

    <div v-if="vetoReason" class="veto-alert" data-testid="veto-reason">
      {{ vetoReason }}
    </div>

    <RadarChart :dims="result.dims" />

    <!-- 必考事实逐项校验 + 原文证据 -->
    <div class="fact-check-wrap">
      <div class="fact-check-title">
        必考事实逐项校验与话术红线检查（漏任一必考项不可通关）
      </div>
      <div class="fact-pill-list">
        <span
          v-for="fact in result.fact_checks"
          :key="fact.key"
          class="fact-pill"
          :class="fact.status === 'hit' ? 'ok' : 'miss'"
          :data-testid="`fact-check-${fact.key}`"
        >
          {{ fact.required ? '必考 · ' : '' }}{{ fact.status === 'hit' ? '已核对' : '漏讲' }} ·
          {{ fact.label }}
          <template v-if="fact.evidence">（「{{ fact.evidence }}」）</template>
        </span>

        <template v-if="result.redline_hits.length > 0">
          <span
            v-for="hit in result.redline_hits"
            :key="hit.term"
            class="fact-pill redline"
            data-testid="redline-hit-pill"
          >
            触发红线 · {{ hit.term }}（{{ hit.reason }}）
          </span>
        </template>
        <span v-else class="fact-pill ok" data-testid="redline-ok-pill">
          红线检查 · 合规通过
        </span>
      </div>
    </div>

    <!-- 四维能力格 -->
    <div class="dim-grid">
      <div v-for="dim in result.dims" :key="dim.key" class="dim-cell">
        <span class="dim-name">{{ dim.name }}</span>
        <span class="dim-val" :class="dim.score >= 85 ? 'high' : 'low'">
          {{ dim.score }} 分
        </span>
      </div>
    </div>

    <!-- 折叠 AI 导师建议与金牌示范 -->
    <div class="speech-disclosure">
      <button
        type="button"
        class="speech-toggle-btn"
        :aria-expanded="showCoachDetail"
        @click="showCoachDetail = !showCoachDetail"
      >
        <span>
          {{
            showCoachDetail
              ? '收起提分建议与金牌示范'
              : result.passed
                ? '查看点评与金牌示范'
                : `薄弱项【${result.weakest.name}】· 查看示范`
          }}
        </span>
        <svg
          class="chapter-chevron"
          :class="{ open: showCoachDetail }"
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

      <div v-if="showCoachDetail" class="coach-feedback-box">
        <div><strong>AI 导师建议：</strong>{{ result.advice }}</div>
        <div><strong>金牌示范：</strong>{{ result.demo_pitch }}</div>
      </div>
    </div>

    <div class="radar-footer-actions">
      <button type="button" class="fc-btn-again" @click="emit('startNextRound')">
        清空继续练习
      </button>
      <button type="button" class="fc-btn-master" @click="emit('switchVariant')">
        换种问法复练
      </button>
    </div>
  </section>
</template>

<style scoped>
.radar-card {
  background: var(--card);
  border: 1.5px solid var(--red-border);
  border-radius: 18px;
  padding: 14px;
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.demo-banner {
  background: #fff7e6;
  color: #d46b08;
  border: 1px solid #ffd591;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.replay-banner {
  background: var(--blue-soft);
  color: var(--blue);
  border: 1px solid #bfd7ff;
  border-radius: 12px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
}

.radar-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.radar-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text);
}

.radar-hits {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
}

.radar-total-wrap {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-shrink: 0;
}

.radar-total-score {
  font-size: 24px;
  font-weight: 900;
  color: var(--red);
  line-height: 1;
}

.veto-alert {
  background: var(--red-soft);
  color: var(--red-dark);
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 700;
}

.fact-check-wrap {
  background: var(--bg);
  border-radius: 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fact-check-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}

.fact-pill-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fact-pill {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 999px;
}

.fact-pill.ok {
  background: #e8f8f0;
  color: #00a854;
}

.fact-pill.miss {
  background: #fff7e6;
  color: #d46b08;
}

.fact-pill.redline {
  background: #fff1f2;
  color: #ed1c24;
  border: 1px solid var(--red-border);
}

.dim-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dim-cell {
  background: var(--bg);
  border-radius: 10px;
  padding: 9px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dim-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.dim-val {
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.dim-val.high {
  color: var(--green);
}

.dim-val.low {
  color: var(--amber);
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

.chapter-chevron {
  color: var(--muted);
  transition: transform 0.2s ease;
}

.chapter-chevron.open {
  transform: rotate(180deg);
  color: var(--red);
}

.coach-feedback-box {
  margin-top: 8px;
  background: var(--green-soft);
  border: 1px solid #b7eb8f;
  border-radius: 12px;
  padding: 11px 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #135200;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.radar-footer-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.fc-btn-again {
  height: 40px;
  border-radius: 999px;
  border: 1.5px solid var(--border);
  background: var(--card);
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.fc-btn-master {
  height: 40px;
  border-radius: 999px;
  border: none;
  background: var(--red);
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 5px 12px rgba(237, 28, 36, 0.22);
}
</style>
