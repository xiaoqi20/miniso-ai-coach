<script setup lang="ts">
import { computed } from 'vue'
import type { DimensionScore } from '@/types/api'

/**
 * 四维能力 SVG 雷达图（卖点准确、异议化解、连带引导、服务亲和）。
 */
const { dims } = defineProps<{
  dims: DimensionScore[]
}>()

const cx = 140
const cy = 110
const maxR = 64

function ringPoints(ratio: number): string {
  const r = maxR * ratio
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

const orderedDims = computed(() => {
  const map = new Map(dims.map((item) => [item.key, item]))
  return [
    map.get('selling') ?? { key: 'selling', name: '卖点准确', score: 0 },
    map.get('objection') ?? { key: 'objection', name: '异议化解', score: 0 },
    map.get('cross_sell') ?? { key: 'cross_sell', name: '连带引导', score: 0 },
    map.get('affinity') ?? { key: 'affinity', name: '服务亲和', score: 0 },
  ]
})

const vertices = computed(() => {
  const [top, right, bottom, left] = orderedDims.value.map(
    (item) => Math.max(0, Math.min(100, item.score)) / 100,
  )
  return [
    { x: cx, y: cy - maxR * top },
    { x: cx + maxR * right, y: cy },
    { x: cx, y: cy + maxR * bottom },
    { x: cx - maxR * left, y: cy },
  ]
})

const polygonPoints = computed(() =>
  vertices.value.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' '),
)
</script>

<template>
  <div class="radar-svg-wrap">
    <svg viewBox="0 0 280 220" width="276" height="216" aria-label="四维能力雷达图">
      <polygon
        :points="ringPoints(1)"
        fill="#FFFFFF"
        stroke="#DCE0E6"
        stroke-width="1.2"
      />
      <polygon
        :points="ringPoints(0.66)"
        fill="none"
        stroke="#E5E7EB"
        stroke-width="1"
        stroke-dasharray="3 3"
      />
      <polygon
        :points="ringPoints(0.33)"
        fill="none"
        stroke="#E5E7EB"
        stroke-width="1"
        stroke-dasharray="3 3"
      />
      <line :x1="cx" :y1="cy - maxR" :x2="cx" :y2="cy + maxR" stroke="#E5E7EB" stroke-width="1" />
      <line :x1="cx - maxR" :y1="cy" :x2="cx + maxR" :y2="cy" stroke="#E5E7EB" stroke-width="1" />
      <polygon
        :points="polygonPoints"
        fill="rgba(237, 28, 36, 0.20)"
        stroke="#ED1C24"
        stroke-width="2.4"
        stroke-linejoin="round"
      />
      <circle
        v-for="(pt, idx) in vertices"
        :key="idx"
        :cx="pt.x.toFixed(1)"
        :cy="pt.y.toFixed(1)"
        r="4.2"
        fill="#FFFFFF"
        stroke="#ED1C24"
        stroke-width="2.4"
      />
      <text :x="cx" y="20" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">
        {{ orderedDims[0].name }} {{ orderedDims[0].score }}
      </text>
      <text x="242" :y="cy + 4" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">
        {{ orderedDims[1].name }}
      </text>
      <text x="242" :y="cy + 20" text-anchor="middle" fill="#ED1C24" font-size="12" font-weight="800">
        {{ orderedDims[1].score }} 分
      </text>
      <text :x="cx" y="202" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">
        {{ orderedDims[2].name }} {{ orderedDims[2].score }}
      </text>
      <text x="38" :y="cy + 4" text-anchor="middle" fill="#1A1A1A" font-size="12" font-weight="700">
        {{ orderedDims[3].name }}
      </text>
      <text x="38" :y="cy + 20" text-anchor="middle" fill="#ED1C24" font-size="12" font-weight="800">
        {{ orderedDims[3].score }} 分
      </text>
    </svg>
  </div>
</template>

<style scoped>
.radar-svg-wrap {
  display: flex;
  justify-content: center;
  background: var(--bg);
  border-radius: 14px;
  padding: 4px;
}

.radar-svg-wrap svg {
  max-width: 100%;
  max-height: 176px;
  width: auto;
  height: auto;
}
</style>
