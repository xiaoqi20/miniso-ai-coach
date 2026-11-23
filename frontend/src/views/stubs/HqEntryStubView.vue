<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppShellDesktop from '@/components/AppShellDesktop.vue'
import { useSession } from '@/composables/useSession'

/**
 * 总部运营工作台占位页（预留给 T007 实现审校、定向发布与 48 小时统计）。
 */
const router = useRouter()
const { user, capabilities, logoutSession } = useSession()

async function handleSwitchAccount(): Promise<void> {
  await logoutSession()
  await router.push('/login')
}
</script>

<template>
  <AppShellDesktop>
    <div class="card stub-card" data-testid="hq-stub-card">
      <div class="stub-head">
        <span class="tag-pill">T007 预留入口 · hq_ops</span>
        <h2>总部课程审校与发布工作台</h2>
      </div>
      <p class="stub-desc">
        当前已通过服务端会话登录为「{{ user?.name }}」（{{ user?.id }}），具备总部角色权限。
        课程草稿编辑、审校清单、定向门店发布与批次统计视图将在 T007 任务中挂载到 <code>/hq</code> 路由模块。
      </p>
      <div class="caps-box">
        <div class="caps-label">当前会话能力标识：</div>
        <code>{{ capabilities.join(', ') }}</code>
      </div>
      <div>
        <button type="button" class="btn-pill-red" @click="handleSwitchAccount">
          切换其他测试账号
        </button>
      </div>
    </div>
  </AppShellDesktop>
</template>

<style scoped>
.stub-card {
  max-width: 680px;
  margin: 24px auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.stub-head {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.stub-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.caps-box {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
}

.caps-label {
  font-weight: 700;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
</style>
