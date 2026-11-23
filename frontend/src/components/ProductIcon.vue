<script setup lang="ts">
/**
 * 商品分类图标组件（支持原型中定义的 box / aroma / pillow / cup）。
 */
const { icon = 'box' } = defineProps<{
  icon?: string | null
}>()
</script>

<template>
  <div class="sku-thumb" aria-hidden="true">
    <svg
      v-if="icon === 'aroma'"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M8 2h8" />
      <path d="M9 2v4l-3 4v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V10l-3-4V2" />
      <path d="M6 14h12" />
    </svg>
    <svg
      v-else
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
      />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  </div>
</template>

<style scoped>
.sku-thumb {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--red-soft);
  color: var(--red);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
</style>
