<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSession } from '@/composables/useSession'
import { roleDisplayName } from '@/utils/assignment'

/**
 * 总部 PC 桌面端公共外壳。
 * 为 T007 总部审校、发布与统计视图预留公共顶栏、当前身份展示和登出入口。
 */
const router = useRouter()
const { user, logoutSession } = useSession()

const userLabel = computed(() => {
  if (!user.value) return '未登录'
  return `${user.value.name} · ${roleDisplayName(user.value.role)}`
})

async function handleSwitchIdentity(): Promise<void> {
  await logoutSession()
  await router.push('/login')
}
</script>

<template>
  <div class="desktop-shell">
    <header class="desktop-topbar">
      <div class="desktop-brand">
        <span class="brand-pill">MINISO</span>
        <span class="brand-name">门店培训 · 总部运营后台</span>
      </div>
      <div class="desktop-actions">
        <span class="user-chip">{{ userLabel }}</span>
        <button type="button" class="btn-secondary-soft" @click="handleSwitchIdentity">
          切换身份 / 登出
        </button>
      </div>
    </header>
    <main class="desktop-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.desktop-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-pill {
  background: var(--red);
  color: #ffffff;
  font-size: 12px;
  font-weight: 900;
  padding: 3px 8px;
  border-radius: 6px;
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.desktop-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-chip {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
</style>
