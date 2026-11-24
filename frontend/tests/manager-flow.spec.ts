import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import * as managerApi from '@/api/manager'
import * as staffApi from '@/api/staff'
import { useSession } from '@/composables/useSession'
import { M1_SAMPLE_INPUTS } from '@/mock/seed'
import { mockDevLogin, resetMockState } from '@/mock/server'
import { createAppRouter } from '@/router'
import { createClientUuid } from '@/utils/assignment'

async function waitForSelector(wrapper: ReturnType<typeof mount>, selector: string): Promise<void> {
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

describe('店长 H5 端进度统计、补训指派与复查确认集成测试', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  it('店长查看 48h 统计与卡点 -> 给漏讲员工指派补训 -> 员工复练通关 -> 店长核验证据并确认复查通过', async () => {
    // 准备：林小美完成 3 节学习并提交漏讲「端盒 6 个不重复」的对练成绩（99 分一票否决）
    await mockDevLogin('usr_linxiaomei')
    await staffApi.completeStaffChapter('asg_m1_bj_linxiaomei', 'ch1')
    await staffApi.completeStaffChapter('asg_m1_bj_linxiaomei', 'ch2')
    await staffApi.completeStaffChapter('asg_m1_bj_linxiaomei', 'ch3')
    const created = await staffApi.createOrGetRoleplaySession('asg_m1_bj_linxiaomei')
    await staffApi.submitRoleplayRound(created.session.id, {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.missing,
      question_variant: 'default',
    })

    // 1. 店长李明登录进入 /manager
    useSession().resetLocalSessionState()
    await mockDevLogin('usr_liming')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/manager')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="mgr-home-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="release-stats-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stats-fraction-value"]').text()).toContain('0 / 3')

    // 2. 点击进入林小美详情页并针对「端盒 6 个不重复」指派补训
    await wrapper.find('[data-testid="mgr-assignee-asg_m1_bj_linxiaomei"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="mgr-focus-option-fact_box_rule"]')
    expect(router.currentRoute.value.name).toBe('manager-assignment-detail')

    await wrapper.find('[data-testid="mgr-retrain-note-input"]').setValue('漏讲端盒规则，请补练')
    await wrapper.find('[data-testid="mgr-issue-retrain-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="mgr-open-retrain-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mgr-assignment-status-badge"]').text()).toContain('待补练')

    // 3. 模拟林小美使用同义表达复练通关（91 分，进入 pending_review）
    await mockDevLogin('usr_linxiaomei')
    const retrainSubmit = await staffApi.submitRoleplayRound(created.session.id, {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.synonym,
      question_variant: 'default',
    })
    expect(retrainSubmit.assignment.status).toBe('pending_review')

    // 4. 切回店长李明刷新详情页，查看冻结复练证据并确认复查通过
    await mockDevLogin('usr_liming')
    await wrapper.find('[data-testid="mgr-detail-refresh-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="mgr-pending-review-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mgr-frozen-evidence"]').text()).toContain('端盒六个不重样')

    await wrapper.find('[data-testid="mgr-review-note-input"]').setValue('复练证据完整，确认通过')
    await wrapper.find('[data-testid="mgr-confirm-review-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="mgr-assignment-status-badge"]').text()).toContain('复查通过')
    expect(wrapper.find('[data-testid="mgr-audit-section"]').text()).toContain('确认复查通过')

    // 返回店长首页，验证 48h 统计已更新为 1 / 3
    await wrapper.find('[data-testid="mgr-back-home-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="stats-fraction-value"]')
    expect(wrapper.find('[data-testid="stats-fraction-value"]').text()).toContain('1 / 3')

    wrapper.unmount()
  })

  it('并发复查状态冲突（409 STATE_CONFLICT）与越权访问（404）展示清晰可恢复反馈', async () => {
    // 准备：陈阿杰复练通过进入 pending_review
    await mockDevLogin('usr_chenajie')
    const submitted = await staffApi.submitRoleplayRound('rps_m1_bj_chenajie', {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.synonym,
      question_variant: 'default',
    })

    // 店长李明打开陈阿杰详情页（持有 version=2）
    useSession().resetLocalSessionState()
    await mockDevLogin('usr_liming')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/manager/assignments/asg_m1_bj_chenajie')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.find('[data-testid="mgr-pending-review-card"]').exists()).toBe(true)

    // 另一店长张涛抢先驳回复查，服务端 version 推进为 3 且状态回到 pending
    await mockDevLogin('usr_zhangtao')
    await managerApi.reviewManagerRetrain(
      'rtn_m1_bj_chenajie_01',
      { decision: 'reject', expected_version: 2, note: '张涛要求再熟背一遍' },
      createClientUuid(),
    )

    // 切回李明点击页面上的「确认复查通过」，应展示 STATE_CONFLICT 与刷新按钮
    await mockDevLogin('usr_liming')
    await wrapper.find('[data-testid="mgr-confirm-review-btn"]').trigger('click')
    await flushPromises()

    const errBanner = wrapper.find('[data-testid="mgr-action-error"]')
    expect(errBanner.exists()).toBe(true)
    expect(errBanner.text()).toContain('状态冲突')
    expect(errBanner.text()).toContain('STATE_CONFLICT')

    // 点击「刷新最新状态」后看到已回退的进行中补训态
    await wrapper.find('[data-testid="mgr-error-refresh-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="mgr-open-retrain-card"]').exists()).toBe(true)

    // 越权/不存在任务 ID 展示 404 友好反馈
    await router.push('/manager/assignments/asg_other_store_forbidden')
    await flushPromises()
    expect(wrapper.find('[data-testid="mgr-detail-load-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="mgr-detail-load-error"]').text()).toContain('NOT_FOUND')

    // 避免未使用变量告警
    expect(submitted.attempt.attempt_id).toBeTruthy()
    wrapper.unmount()
  })
})
