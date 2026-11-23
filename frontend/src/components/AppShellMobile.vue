<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { useToast } from '@/composables/useToast'

/**
 * H5 移动端公共布局壳。
 * 供员工（T006）与店长（T007）移动端页面复用，提供品牌状态栏与悬浮双 Tab 底部导航。
 */
const props = withDefaults(
  defineProps<{
    /** 顶部状态栏主题：员工首页头部用红色 dark，内页用浅色 light */
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
  <div class="app-viewport-center">
    <div class="phone-frame">
      <!-- 顶部企微学堂模拟状态栏 -->
      <header class="status-bar" :class="props.statusTheme">
        <span>09:41</span>
        <div class="status-signal">
          <span>MINISO 企微学堂</span>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
            <rect x="0" y="7" width="3" height="5" rx="1" fill="currentColor" opacity="0.5" />
            <rect x="4.5" y="5" width="3" height="7" rx="1" fill="currentColor" opacity="0.7" />
            <rect x="9" y="2.5" width="3" height="9.5" rx="1" fill="currentColor" opacity="0.9" />
            <rect x="13.5" y="0" width="2.5" height="12" rx="1" fill="currentColor" />
          </svg>
        </div>
      </header>

      <!-- 页面内容滚动区域 -->
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
.status-bar {
  height: 36px;
  padding: 0 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.status-bar.dark {
  background: var(--red);
  color: #ffffff;
}

.status-bar.light {
  background: var(--card);
  color: var(--text);
  border-bottom: 1px solid var(--border);
}

.status-signal {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bottom-nav {
  position: absolute;
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
