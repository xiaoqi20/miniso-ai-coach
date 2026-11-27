<script setup lang="ts">
import { computed } from 'vue'

/**
 * 虚拟顾客头像组件：按顾客风格（student/mom/office）与情绪（concern/listening/happy）渲染表情。
 */
const {
  personaStyle = 'student',
  mood = 'concern',
  size = 86,
} = defineProps<{
  personaStyle?: string
  mood?: 'concern' | 'listening' | 'happy'
  size?: number
}>()

const palette = computed(() => {
  if (personaStyle === 'mom') {
    return { bg: '#FFF5EC', hair: '#4A342E', outfit: '#E87A5D' }
  }
  if (personaStyle === 'office') {
    return { bg: '#F2F5FA', hair: '#1F2937', outfit: '#3B5998' }
  }
  return { bg: '#FFF1F2', hair: '#2B2D42', outfit: '#ED1C24' }
})
</script>

<template>
  <svg
    viewBox="0 0 100 100"
    :width="size"
    :height="size"
    fill="none"
    aria-label="虚拟顾客形象"
  >
    <rect width="100" height="100" :fill="palette.bg" />
    <circle cx="50" cy="44" r="31" :fill="palette.hair" />
    <path
      d="M16 100 C18 79 31 74 50 74 C69 74 82 79 84 100 Z"
      :fill="palette.outfit"
    />
    <path d="M41 74 L50 84 L59 74" fill="#FFFFFF" />
    <rect x="44" y="66" width="12" height="11" rx="5" fill="#FCD9C2" />
    <circle cx="50" cy="50" r="24" fill="#FFE4D1" />
    <path
      d="M26 45 C28 27 42 22 50 22 C60 22 72 28 74 45 C68 35 60 32 50 34 C40 32 32 36 26 45 Z"
      :fill="palette.hair"
    />
    <ellipse cx="34" cy="57" rx="4.5" ry="2.6" fill="#FF9AA2" opacity="0.55" />
    <ellipse cx="66" cy="57" rx="4.5" ry="2.6" fill="#FF9AA2" opacity="0.55" />

    <!-- 眉毛根据情绪微调 -->
    <template v-if="mood === 'concern'">
      <path
        d="M34 41 Q40 39 45 42"
        :stroke="palette.hair"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
      <path
        d="M55 42 Q60 39 66 41"
        :stroke="palette.hair"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
    </template>
    <template v-else>
      <path
        d="M34 40 Q40 37 45 40"
        :stroke="palette.hair"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
      <path
        d="M55 40 Q60 37 66 40"
        :stroke="palette.hair"
        stroke-width="2.2"
        fill="none"
        stroke-linecap="round"
      />
    </template>

    <!-- 眼睛 -->
    <template v-if="mood === 'happy'">
      <path
        d="M35 49 Q40 43 45 49"
        stroke="#1A1A1A"
        stroke-width="2.8"
        fill="none"
        stroke-linecap="round"
      />
      <path
        d="M55 49 Q60 43 65 49"
        stroke="#1A1A1A"
        stroke-width="2.8"
        fill="none"
        stroke-linecap="round"
      />
    </template>
    <template v-else>
      <circle cx="40" cy="48" r="3.4" fill="#1A1A1A" />
      <circle cx="60" cy="48" r="3.4" fill="#1A1A1A" />
      <circle cx="41.2" cy="46.8" r="1.1" fill="#FFFFFF" />
      <circle cx="61.2" cy="46.8" r="1.1" fill="#FFFFFF" />
    </template>

    <!-- 眼镜（office 风格） -->
    <template v-if="personaStyle === 'office'">
      <rect
        x="32"
        y="42"
        width="16"
        height="12"
        rx="4"
        stroke="#1A1A1A"
        stroke-width="1.8"
        fill="none"
      />
      <rect
        x="52"
        y="42"
        width="16"
        height="12"
        rx="4"
        stroke="#1A1A1A"
        stroke-width="1.8"
        fill="none"
      />
      <line x1="48" y1="48" x2="52" y2="48" stroke="#1A1A1A" stroke-width="1.8" />
    </template>

    <!-- 嘴巴 -->
    <path
      v-if="mood === 'happy'"
      d="M42 63 Q50 72 58 63"
      stroke="#D93843"
      stroke-width="3"
      fill="#FF9AA2"
      stroke-linecap="round"
    />
    <ellipse v-else cx="50" cy="66" rx="5.5" ry="3.2" fill="#D93843" />
  </svg>
</template>
