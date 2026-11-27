import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import * as authApi from '@/api/auth'
import * as staffApi from '@/api/staff'
import { ApiClientError } from '@/api/client'
import { useSession } from '@/composables/useSession'
import { mockCompleteChapter, mockDevLogin, resetMockState, setMockNextRoundFault } from '@/mock/server'
import { createAppRouter } from '@/router'

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

describe('T006 返工回归：多商品话术隔离与 503 刷新后双恢复动作', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('不同商品与同商品多版本不串用话术、问法、输入提示与示范，且具备可访问标签', async () => {
    vi.spyOn(authApi, 'fetchMe').mockResolvedValue({
      user: {
        id: 'usr_linxiaomei',
        name: '林小美',
        role: 'staff',
        stores: [{ id: 'store_bj', name: '北京路旗舰店', role: 'staff' }],
      },
      capabilities: ['staff.assignment.read', 'staff.progress.write', 'staff.roleplay.submit'],
      server_time: '2026-11-24T10:00:00.000Z',
    })

    // 商品 A（v1）：售价 79 元保温杯，未学完章节
    vi.spyOn(staffApi, 'getStaffAssignment').mockImplementation(async (assignmentId) => {
      if (assignmentId === 'asg_thermos_v1') {
        return {
          assignment: {
            assignment_id: 'asg_thermos_v1',
            release_id: 'rls_thermos_v1',
            status: 'learning',
            completed_chapters: [],
            required_chapters: 1,
            last_score: null,
            best_score: null,
            qualified_at: null,
            state_version: 1,
            deadline_at: '2026-11-26T09:00:00.000Z',
          },
          course_version: {
            id: 'crv_thermos_v1',
            version_no: 1,
            content: {
              product: {
                name: '名创便携保温杯',
                summary: '316 不锈钢内胆 · 长效保温 12 小时',
                price: '¥79.00',
                tag: '秋冬必推',
                icon: 'cup',
              },
              chapters: [
                {
                  key: 'ch1',
                  short: '01 材质保温',
                  title: '316 内胆与长效保温',
                  preview: '¥79.00 · 316 医用级不锈钢',
                  speech: '这款名创便携保温杯售价 79 元，采用 316 不锈钢内胆，保温 12 小时不漏水。',
                  actions: ['引导开盖检查硅胶密封圈'],
                  mantra: '316 内胆 + 79 元高性价比',
                },
              ],
            },
          },
          progress: { completed_chapters: [], chapter_completed_at: {} },
          attempts: [],
          open_retrain: null,
          roleplay_session_id: null,
        }
      }

      // 同一商品的升级版本（v2）：改价 89 元、独立章节话术与已解锁会话
      return {
        assignment: {
          assignment_id: 'asg_thermos_v2',
          release_id: 'rls_thermos_v2',
          status: 'ready_for_roleplay',
          completed_chapters: ['ch1'],
          required_chapters: 1,
          last_score: null,
          best_score: null,
          qualified_at: null,
          state_version: 2,
          deadline_at: '2026-11-27T09:00:00.000Z',
        },
        course_version: {
          id: 'crv_thermos_v2',
          version_no: 2,
          content: {
            product: {
              name: '名创便携保温杯（升级版）',
              summary: '316L 内胆 + 硅胶提手 · 24 小时保冷',
              price: '¥89.00',
              tag: 'v2 升级款',
              icon: 'cup',
            },
            chapters: [
              {
                key: 'ch1',
                short: '01 升级卖点',
                title: '316L 升级内胆与保冷性能',
                preview: '¥89.00 · 24 小时保冷',
                speech: '升级款保温杯 89 元，内胆升级为 316L，冬天保温夏天保冷 24 小时。',
                actions: ['展示便携提手设计'],
                mantra: '89 元 316L 全季适用',
              },
            ],
          },
        },
        progress: {
          completed_chapters: ['ch1'],
          chapter_completed_at: { ch1: '2026-11-24T09:30:00.000Z' },
        },
        attempts: [],
        open_retrain: null,
        roleplay_session_id: 'rps_thermos_v2',
      }
    })

    vi.spyOn(staffApi, 'createOrGetRoleplaySession').mockImplementation(async (assignmentId) => {
      if (assignmentId === 'asg_thermos_v1') {
        throw new ApiClientError(409, 'CHAPTERS_INCOMPLETE', '请先完成全部课程章节', '', {
          missing_chapters: ['ch1'],
        })
      }
      return {
        session: {
          id: 'rps_thermos_v2',
          assignment_id: 'asg_thermos_v2',
          last_round_no: 0,
          created_at: '2026-11-24T09:35:00.000Z',
          updated_at: '2026-11-24T09:35:00.000Z',
        },
        persona: {
          name: '通勤白领 · 阿晨',
          style: 'office',
          question: '这个升级版保温杯卖 89 块，比普通水杯贵在哪？',
          alt_question: '我每天装咖啡用，89 元这款内胆好清洗吗？',
        },
      }
    })

    vi.spyOn(staffApi, 'getRoleplaySession').mockResolvedValue({
      session: {
        id: 'rps_thermos_v2',
        assignment_id: 'asg_thermos_v2',
        last_round_no: 0,
        created_at: '2026-11-24T09:35:00.000Z',
        updated_at: '2026-11-24T09:35:00.000Z',
      },
      rounds: [],
    })

    const previewSpy = vi.spyOn(staffApi, 'previewRoleplay').mockImplementation(async (asgId) => ({
      preview: true,
      persisted: false,
      total: 92,
      passed: true,
      threshold: 85,
      dims: [
        { key: 'selling', name: '卖点准确', score: 92 },
        { key: 'objection', name: '异议化解', score: 90 },
        { key: 'cross_sell', name: '连带引导', score: 93 },
        { key: 'affinity', name: '服务亲和', score: 94 },
      ],
      fact_checks: [
        {
          key: 'fact_thermos_price',
          label: asgId === 'asg_thermos_v1' ? '零售价 79 元' : '零售价 89 元',
          required: true,
          status: 'hit',
          evidence: asgId === 'asg_thermos_v1' ? '79 元' : '89 元',
        },
      ],
      missed_required_facts: [],
      redline_hits: [],
      weakest: { key: 'objection', name: '异议化解', score: 90 },
      advice: '卖点阐述清晰，达到保温杯推荐标准。',
      demo_pitch:
        asgId === 'asg_thermos_v1'
          ? '这款保温杯 79 元采用 316 不锈钢内胆，您可以试试手感。'
          : '这款升级版保温杯 89 元采用 316L 内胆，装咖啡易清洗。',
    }))

    const router = createAppRouter(createMemoryHistory())
    await router.push('/staff/assignments/asg_thermos_v1/roleplay')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await waitForSelector(wrapper, '[data-testid="chapters-incomplete-card"]')

    // 1. 验证未学完 79 元保温杯时不出现任何 Chiikawa / 59 元 / 盲盒字样
    expect(wrapper.get('[data-testid="roleplay-nav-price"]').text()).toBe('¥79.00')
    expect(wrapper.get('[data-testid="customer-persona-name"]').text()).toBe('门店虚拟顾客')
    const q1 = wrapper.get('[data-testid="customer-question-text"]').text()
    expect(q1).toContain('名创便携保温杯')
    expect(q1).not.toMatch(/59|盲盒|乌萨奇|Chiikawa|小雨/)

    // 2. 验证存在正式可访问标签 <label for="roleplay-answer-input"> 与绑定商品的 placeholder
    const labelEl = wrapper.get('label[for="roleplay-answer-input"]')
    expect(labelEl.text()).toContain('名创便携保温杯')
    expect(labelEl.text()).toContain('¥79.00')
    const textareaEl = wrapper.get('[data-testid="roleplay-answer-input"]').element as HTMLTextAreaElement
    expect(textareaEl.placeholder).toContain('名创便携保温杯')
    expect(textareaEl.placeholder).toContain('¥79.00')
    expect(textareaEl.placeholder).not.toMatch(/59|端盒/)

    // 3. 空白点击「演示试听」不得填入 Chiikawa 文本或调用预览接口
    await wrapper.get('[data-testid="preview-submit-btn"]').trigger('click')
    await flushPromises()
    expect(textareaEl.value).toBe('')
    expect(previewSpy).not.toHaveBeenCalled()

    // 4. 在 v1 不存在 Chiikawa 测试样例按钮组，只能填入当前课程课件话术
    expect(wrapper.find('[data-testid="toggle-samples-btn"]').exists()).toBe(false)
    await wrapper.get('[data-testid="fill-course-speech-btn"]').trigger('click')
    expect(textareaEl.value).toContain('79 元')
    expect(textareaEl.value).not.toContain('Chiikawa')

    await wrapper.get('[data-testid="preview-submit-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="compact-customer-reply"]')
    expect(wrapper.get('[data-testid="compact-customer-reply"]').text()).not.toMatch(
      /软糯|防尘挂袋/,
    )
    expect(wrapper.get('[data-testid="score-result-card"]').text()).toContain('316 不锈钢内胆')

    // 5. 切换到同一商品升级版 v2（¥89.00），验证所有文案切换到 v2 绑定版本
    await router.push('/staff/assignments/asg_thermos_v2/roleplay')
    await waitForSelector(wrapper, '[data-testid="customer-question-text"]')
    await vi.waitFor(() => {
      expect(wrapper.get('[data-testid="roleplay-nav-price"]').text()).toBe('¥89.00')
    })

    expect(wrapper.get('[data-testid="customer-persona-name"]').text()).toBe('通勤白领 · 阿晨')
    expect(wrapper.get('[data-testid="customer-question-text"]').text()).toContain('89 块')
    const textareaElV2 = wrapper.get('[data-testid="roleplay-answer-input"]')
      .element as HTMLTextAreaElement
    expect(textareaElV2.value).toBe('')
    expect(wrapper.find('[data-testid="score-result-card"]').exists()).toBe(false)

    await wrapper.get('[data-testid="toggle-variant-btn"]').trigger('click')
    expect(wrapper.get('[data-testid="customer-question-text"]').text()).toContain('装咖啡用')

    await wrapper.get('[data-testid="fill-course-speech-btn"]').trigger('click')
    expect(textareaElV2.value).toContain('316L')
    wrapper.unmount()
  })

  it('Mock 触发 503 并刷新页面后，仍保留失败原因、原轮重试与「改写为新一轮」两个入口', async () => {
    await mockDevLogin('usr_linxiaomei')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch1')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch2')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch3')

    const router1 = createAppRouter(createMemoryHistory())
    await router1.push('/staff/assignments/asg_m1_bj_linxiaomei/roleplay')
    await router1.isReady()

    const wrapper1 = mount(App, { global: { plugins: [router1] } })
    await waitForSelector(wrapper1, '[data-testid="roleplay-answer-input"]')

    // 首次填入同义表达并触发 503
    await wrapper1.get('[data-testid="toggle-samples-btn"]').trigger('click')
    await wrapper1.findAll('.sample-chip')[1].trigger('click')
    setMockNextRoundFault('SCORING_UNAVAILABLE')

    await wrapper1.get('[data-testid="formal-submit-btn"]').trigger('click')
    await waitForSelector(wrapper1, '[data-testid="roleplay-submit-error"]')
    const errTextBeforeReload = wrapper1.get('[data-testid="roleplay-submit-error"]').text()
    expect(errTextBeforeReload).toContain('SCORING_UNAVAILABLE')
    wrapper1.unmount()

    // 模拟浏览器整页刷新（重置内存会话、重建路由重新进入）
    useSession().resetLocalSessionState()
    const router2 = createAppRouter(createMemoryHistory())
    await router2.push('/staff/assignments/asg_m1_bj_linxiaomei/roleplay')
    await router2.isReady()

    const wrapper2 = mount(App, { global: { plugins: [router2] } })
    await waitForSelector(wrapper2, '[data-testid="roleplay-submit-error"]')

    const errBanner = wrapper2.get('[data-testid="roleplay-submit-error"]')
    expect(errBanner.text()).toContain('SCORING_UNAVAILABLE')
    expect(errBanner.text()).toContain('client_round_id:')

    // 刷新后必须同时保留原轮重试和改写新一轮两个动作按钮
    const retryBtn = wrapper2.get('[data-testid="retry-same-round-btn"]')
    const rewriteBtn = wrapper2.get('[data-testid="rewrite-new-round-btn"]')
    expect(retryBtn.exists()).toBe(true)
    expect(rewriteBtn.exists()).toBe(true)

    const textarea = wrapper2.get('[data-testid="roleplay-answer-input"]')
      .element as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)

    // 点击「改写为新一轮」应解锁输入框、保留原文供修改，并提交产生第 2 轮（第 1 轮保留失败态）
    await rewriteBtn.trigger('click')
    await flushPromises()
    expect(textarea.disabled).toBe(false)
    expect(wrapper2.find('[data-testid="roleplay-submit-error"]').exists()).toBe(false)

    await wrapper2.get('[data-testid="roleplay-answer-input"]').setValue(
      '您摸摸样品，59 元日本正版联名授权，端盒 6 个不重复，加 9.9 元配防尘挂袋哦。',
    )
    await wrapper2.get('[data-testid="formal-submit-btn"]').trigger('click')
    await waitForSelector(wrapper2, '[data-testid="saved-round-2"]')

    expect(wrapper2.get('[data-testid="saved-round-1"]').text()).toContain('评分失败')
    expect(wrapper2.get('[data-testid="saved-round-2"]').text()).toContain('已通关')
    wrapper2.unmount()
  })
})
