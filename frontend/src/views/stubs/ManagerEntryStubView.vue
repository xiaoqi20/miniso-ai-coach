<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppShellMobile from '@/components/AppShellMobile.vue'
import { useSession } from '@/composables/useSession'

/**
 * 门店店长工作台占位页（预留给 T007 实现门店进度、补训指派与复查确认）。
 */
const router = useRouter()
const { user, capabilities, logoutSession } = useSession()

async function handleSwitchAccount(): Promise<void> {
  await logoutSession()
  await router.push('/login')
}
</script>

<template>
  <AppShellMobile status-theme="dark">
    <header class="mgr-header">
      <div class="mgr-top-row">
        <span class="brand-pill">MINISO · 店长工作台</span>
        <button type="button" class="switch-btn" @click="handleSwitchAccount">切换身份</button>
      </div>
      <div class="mgr-profile">
        <strong>{{ user?.name }}</strong>
        <span>{{ user?.stores.map((s) => s.name).join(' / ') }}</span>
      </div>
    </header>

    <div class="mgr-body">
      <section class="card stub-card" data-testid="manager-stub-card">
        <span class="tag-pill">T007 预留入口 · store_manager</span>
        <h2 class="stub-title">门店督学、补训指派与复查页</h2>
        <p class="stub-desc">
          已通过服务端会话校验店长权限。管辖门店应训名单、48 小时达标率、漏讲补训指派及复查确认界面将在 T007 挂载至
          <code>src/router/managerRoutes.ts</code>。
        </p>
        <div class="caps-box">能力：{{ capabilities.join(', ') }}</div>
      </section>
    </div>
  </AppShellMobile>
</template>

<style scoped>
.mgr-header {
  background: linear-gradient(135deg, #ed1c24 0%, #cc121a 100%);
  color: #ffffff;
  padding: 10px 16px 14px;
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
}

.mgr-top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.brand-pill {
  font-size: 13px;
  font-weight: 800;
}

.switch-btn {
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.16);
  color: #ffffff;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.mgr-profile {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 13px;
}

.mgr-body {
  padding: 14px;
}

.stub-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stub-title {
  font-size: 16px;
  font-weight: 800;
}

.stub-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.55;
}

.caps-box {
  background: var(--bg);
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--muted);
}
</style>
