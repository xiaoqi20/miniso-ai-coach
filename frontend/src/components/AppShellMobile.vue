<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'
import { detectClientRuntime } from '@/utils/runtime'

/**
 * 标准 H5 移动端公共布局壳（已移除模拟手机黑框与虚拟 09:41 状态栏，预留企业微信 WebView 适配）。
 * 供登录引导、员工（T006）与店长（T007）移动端页面复用，提供顶部安全区与悬浮底部导航。
 */
const props = withDefaults(
  defineProps<{
    /** 顶部安全区底色主题：首页/引导页为名创红 dark，内页为浅色 light */
    statusTheme?: 'dark' | 'light'
    /** 是否显示底部悬浮导航栏 */
    showBottomNav?: boolean
    /** 点击底部「AI 对练」Tab 时的默认任务 ID；为空时提示暂无任务 */
    roleplayAssignmentId?: string | null
  }>(),
  {
    statusTheme: 'light',
    showBottomNav: false,
    roleplayAssignmentId: null,
  },
)

const route = useRoute()
const router = useRouter()
const { user } = useSession()
const { showToast } = useToast()

const runtime = detectClientRuntime()
const activeTab = computed(() => route.meta.navTab ?? 'home')
const roleHomePath = computed(() => (user.value?.role === 'store_manager' ? '/manager' : '/staff'))

function handleGoHome(): void {
  void router.push(roleHomePath.value)
}

function handleGoRoleplay(): void {
  if (!props.roleplayAssignmentId) {
    showToast('当前门店暂无可进入的已发布对练任务')
    return
  }
  void router.push(`/staff/assignments/${encodeURIComponent(props.roleplayAssignmentId)}/roleplay`)
}
</script>

<template>
  <div class="app-viewport-center" :data-runtime="runtime">
    <div class="h5-shell phone-frame" :class="`theme-${props.statusTheme}`">
      <!-- 系统/企业微信安全区占位（无模拟状态栏，由宿主系统或企微客户端原生渲染） -->
      <div class="safe-top-inset" :class="props.statusTheme" aria-hidden="true" />

      <!-- 页面内容流式滚动区域 -->
      <main class="mobile-screen-scroll">
        <slot />
      </main>

      <!-- 悬浮双 Tab 底部导航（仅在配置 showBottomNav 时展示，支持安全区避让） -->
      <nav v-if="props.showBottomNav" class="bottom-nav" aria-label="员工主导航">
        <button
          type="button"
          class="nav-tab"
          :class="{ active: activeTab === 'home' }"
          data-testid="nav-home"
          @click="handleGoHome"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>首页</span>
        </button>
        <button
          type="button"
          class="nav-tab"
          :class="{ active: activeTab === 'roleplay' }"
          data-testid="nav-roleplay"
          @click="handleGoRoleplay"
        >
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          <span>AI 对练</span>
        </button>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.safe-top-inset {
  height: env(safe-area-inset-top, 0px);
  flex-shrink: 0;
}

.safe-top-inset.dark {
  background: var(--red);
}

.safe-top-inset.light {
  background: var(--card);
}

.bottom-nav {
  position: fixed;
  left: 50%;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  width: calc(100% - 64px);
  max-width: 248px;
  height: 54px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(26, 26, 26, 0.06);
  border-radius: 999px;
  box-shadow: 0 10px 26px rgba(26, 26, 26, 0.14), 0 2px 6px rgba(237, 28, 36, 0.06);
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  z-index: 40;
}

.nav-tab {
  border: none;
  background: transparent;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.12s ease;
}

.nav-tab:active {
  transform: scale(0.96);
}

.nav-tab.active {
  background: var(--red-soft);
  color: var(--red);
  font-weight: 700;
}
</style>
