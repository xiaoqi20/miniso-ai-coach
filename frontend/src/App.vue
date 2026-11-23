<script setup lang="ts">
import { useToast } from '@/composables/useToast'

/**
 * 根组件：承载路由视图和全局轻量 Toast 提示。
 * 各路由页面自主根据 meta.layout 选用移动端壳或 PC 壳。
 */
const { message, visible } = useToast()
</script>

<template>
  <RouterView />
  <div class="toast" :class="{ show: visible }" role="status" aria-live="polite">
    {{ message }}
  </div>
</template>
