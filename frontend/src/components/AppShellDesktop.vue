<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { roleDisplayName } from '@/utils/assignment'

/**
 * 总部 PC 桌面端公共外壳（复刻 static/index.html 名创红渐变品牌头并适配 PC 宽屏）。
 */
const router = useRouter()
const { user, logoutSession } = useSession()

const userName = computed(() => user.value?.name ?? '未登录')
const userRoleText = computed(() =>
  user.value ? `总部运营中心 · ${roleDisplayName(user.value.role)}` : '未认证会话',
)

async function handleSwitchIdentity(): Promise<void> {
  await logoutSession()
  await router.push('/login')
}
</script>

<template>
  <div class="desktop-shell">
    <header class="desktop-topbar">
      <div class="desktop-topbar-inner">
        <div class="desktop-top-left">
          <button
            type="button"
            class="desktop-brand"
            aria-label="返回总部首页"
            @click="router.push('/hq')"
          >
            <span class="brand-pill">MINISO</span>
            <span class="brand-name">产品授课</span>
          </button>
          <span class="brand-divider" aria-hidden="true">|</span>
          <div class="profile-inline" data-testid="hq-profile-banner">
            <strong>{{ userName }}</strong>
            <span>{{ userRoleText }}</span>
          </div>
        </div>

        <div class="desktop-actions">
          <button
            type="button"
            class="switch-role-btn"
            data-testid="hq-switch-role-btn"
            @click="handleSwitchIdentity"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            <span>切换角色</span>
          </button>
        </div>
      </div>
    </header>
    <main class="desktop-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.desktop-topbar-inner {
  max-width: 1160px;
  margin: 0 auto;
  min-height: 62px;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.desktop-top-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex-wrap: wrap;
}

.desktop-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  padding: 0;
}

.brand-pill {
  background: #ffffff;
  color: var(--red);
  font-size: 12px;
  font-weight: 900;
  padding: 3px 8px;
  border-radius: 6px;
  letter-spacing: 0.3px;
}

.brand-name {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
}

.brand-divider {
  color: rgba(255, 255, 255, 0.35);
}

.profile-inline {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.92);
}

.profile-inline strong {
  font-size: 15px;
  font-weight: 800;
  color: #ffffff;
}

.desktop-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.switch-role-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 999px;
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.switch-role-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}
</style>
