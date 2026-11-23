import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import { useSession } from '@/composables/useSession'
import { resetMockState, setMockNextRoundFault } from '@/mock/server'
import { createAppRouter } from '@/router'

/** 等待路由懒加载和异步视图更新完成 */
async function waitForSelector(
  wrapper: ReturnType<typeof mount>,
  selector: string,
): Promise<void> {
  await vi.waitFor(
    async () => {
      await flushPromises()
      if (!wrapper.find(selector).exists()) {
        throw new Error(`Waiting for selector: ${selector}`)
      }
    },
    { timeout: 3000, interval: 15 },
  )
}

describe('员工端完整路径组件集成测试', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  it('员工登录 -> 首页任务渲染 -> 逐节学习 -> 演示试听 -> 503失败重试 -> 刷新恢复轮次', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(App, {
      global: { plugins: [router] },
    })
    await waitForSelector(wrapper, '[data-testid="user-option-usr_linxiaomei"]')

    // 1. 选择林小美并登录
    await wrapper.get('[data-testid="user-option-usr_linxiaomei"]').trigger('click')
    await wrapper.get('[data-testid="login-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="primary-mission-cta"]')

    expect(router.currentRoute.value.name).toBe('staff-home')
    expect(wrapper.get('[data-testid="primary-mission-badge"]').text()).toContain('待学习 0/3')

    // 2. 点击「开始学习」进入课程学习页并逐节完成
    await wrapper.get('[data-testid="primary-mission-cta"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="complete-chapter-ch1"]')
    expect(router.currentRoute.value.name).toBe('staff-course')

    await wrapper.get('[data-testid="complete-chapter-ch1"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="complete-chapter-ch2"]')
    await wrapper.get('[data-testid="complete-chapter-ch2"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="complete-chapter-ch3"]')
    await wrapper.get('[data-testid="complete-chapter-ch3"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="chapter-progress-text"]').text()).toContain('3/3 节')

    // 3. 进入文字对练页
    await wrapper.get('[data-testid="enter-roleplay-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="preview-submit-btn"]')
    expect(router.currentRoute.value.name).toBe('staff-roleplay')

    // 4. 测试演示试听（persisted: false）不写入已保存轮次
    await wrapper.get('[data-testid="preview-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="preview-banner"]')
    expect(wrapper.get('[data-testid="preview-banner"]').text()).toContain('演示试听')
    expect(wrapper.find('[data-testid="saved-round-1"]').exists()).toBe(false)

    // 5. 注入一次 503 故障并提交正式评分，验证轮次保留且可用同键重试恢复
    await wrapper.get('[data-testid="toggle-samples-btn"]').trigger('click')
    await wrapper.findAll('.sample-chip')[1].trigger('click') // 同义表达 91 分
    setMockNextRoundFault('SCORING_UNAVAILABLE')

    await wrapper.get('[data-testid="formal-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="roleplay-submit-error"]')

    expect(wrapper.get('[data-testid="roleplay-submit-error"]').text()).toContain(
      'SCORING_UNAVAILABLE',
    )
    expect(wrapper.get('[data-testid="saved-round-1"]').text()).toContain('评分失败')

    // 点击「用同一轮次重试评分」成功完成第 1 轮，不产生第 2 轮
    await wrapper.get('[data-testid="retry-same-round-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="score-total"]')

    expect(wrapper.get('[data-testid="score-total"]').text()).toBe('91')
    expect(wrapper.get('[data-testid="score-passed-badge"]').text()).toBe('已通关')
    expect(wrapper.find('[data-testid="saved-round-2"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="saved-round-1"]').text()).toContain('91 分')

    wrapper.unmount()

    // 6. 模拟页面刷新（重置前端内存会话、新建路由实例并直达对练页），验证从服务端恢复已保存轮次
    useSession().resetLocalSessionState()
    const freshRouter = createAppRouter(createMemoryHistory())
    await freshRouter.push('/staff/assignments/asg_m1_bj_linxiaomei/roleplay')
    await freshRouter.isReady()

    const reloadedWrapper = mount(App, {
      global: { plugins: [freshRouter] },
    })
    await waitForSelector(reloadedWrapper, '[data-testid="saved-round-1"]')

    expect(reloadedWrapper.get('[data-testid="saved-round-1"]').text()).toContain('91 分')
    reloadedWrapper.unmount()
  })

  it('轮播切换非目标门店（佛山周琳）显示空任务隔离态，切换陈阿杰展示待补练', async () => {
    const router = createAppRouter(createMemoryHistory())
    await router.push('/login')
    await router.isReady()

    const wrapper = mount(App, {
      global: { plugins: [router] },
    })
    await waitForSelector(wrapper, '[data-testid="role-card-staff_foshan"]')

    // 点击轮播卡片切换为「门店员工 · 佛山祖庙」，选择周琳登录
    await wrapper.get('[data-testid="role-card-staff_foshan"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="user-option-usr_zhoulin"]')
    await wrapper.get('[data-testid="user-option-usr_zhoulin"]').trigger('click')
    await wrapper.get('[data-testid="login-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="staff-home-empty"]')

    expect(wrapper.get('[data-testid="staff-home-empty"]').text()).toContain('暂无待学上新任务')

    // 切回北京路门店选择陈阿杰，验证首页展示「待补练」
    await wrapper.get('[data-testid="switch-account-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="role-card-staff_beijing"]')
    await wrapper.get('[data-testid="role-card-staff_beijing"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="user-option-usr_chenajie"]')
    await wrapper.get('[data-testid="user-option-usr_chenajie"]').trigger('click')
    await wrapper.get('[data-testid="login-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="primary-mission-badge"]')

    expect(wrapper.get('[data-testid="primary-mission-badge"]').text()).toBe('待补练')
    expect(wrapper.get('[data-testid="primary-mission-cta"]').text()).toBe('去补练')
    wrapper.unmount()
  })
})
