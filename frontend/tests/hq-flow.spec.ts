import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import * as hqApi from '@/api/hq'
import { useSession } from '@/composables/useSession'
import { mockDevLogin, resetMockState } from '@/mock/server'
import { createAppRouter } from '@/router'

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

describe('总部 PC 端审校、定向发布与批次统计集成测试', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  it('总部查看草稿 -> 保存修改 -> 审校未全勾反馈 -> 三项确认审校 -> 选门店与截止发布 -> 幂等重放 -> 查看批次结果与48h统计', async () => {
    await mockDevLogin('usr_linmin')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="hq-dashboard-page"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-course-row-crs_thermos"]').exists()).toBe(true)

    // 1. 进入待审校新品草稿工作台
    await wrapper.find('[data-testid="hq-open-course-crs_thermos"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="hq-draft-editor"]')
    expect(router.currentRoute.value.name).toBe('hq-course-workbench')

    // 2. 编辑草稿摘要并保存
    const summaryInput = wrapper.find('[data-testid="hq-input-product-summary"]')
    await summaryInput.setValue('316 不锈钢内胆 · 6小时保温保冷 · 总部审校版')
    await wrapper.find('[data-testid="hq-save-draft-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('修订 #2')

    // 3. 未勾选三项直接提交审校，应给出清晰错误提示
    await wrapper.find('[data-testid="hq-submit-review-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hq-action-error"]').text()).toContain('审校清单尚未全部确认')

    // 4. 勾选全部三项并提交审校通过
    await wrapper.find('[data-testid="hq-check-price"]').setValue(true)
    await wrapper.find('[data-testid="hq-check-spec"]').setValue(true)
    await wrapper.find('[data-testid="hq-check-redline"]').setValue(true)
    await wrapper.find('[data-testid="hq-review-note"]').setValue('三项核对无误')
    await wrapper.find('[data-testid="hq-submit-review-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="hq-reviewed-summary"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-reviewed-summary"]').text()).toContain('林敏')

    // 5. 核对目标门店（加选佛山店）与截止时间（72 小时）并提交发布
    await wrapper.find('[data-testid="hq-store-store_fs"]').setValue(true)
    await wrapper.find('[data-testid="hq-deadline-72"]').trigger('click')
    await wrapper.find('[data-testid="hq-submit-publish-btn"]').trigger('click')
    await flushPromises()

    const resultCard = wrapper.find('[data-testid="hq-publish-result-card"]')
    expect(resultCard.exists()).toBe(true)
    expect(resultCard.text()).toContain('5') // 北京3人 + 佛山2人

    // 6. 同配置再次点击发布触发幂等保护，不重复建批并提示重放
    await wrapper.find('[data-testid="hq-submit-publish-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hq-publish-result-card"]').text()).toContain('重复提交已命中幂等保护')

    // 7. 跳转发布批次详情页，校验应训名单快照与 48h 统计卡片
    await wrapper.find('[data-testid="hq-view-release-btn"]').trigger('click')
    await waitForSelector(wrapper, '[data-testid="release-stats-card"]')
    expect(router.currentRoute.value.name).toBe('hq-release-detail')
    expect(wrapper.find('[data-testid="release-stats-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="stats-fraction-value"]').text()).toContain('0 / 5')
    expect(wrapper.find('[data-testid="hq-assignee-usr_linxiaomei"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-assignee-usr_zhoulin"]').exists()).toBe(true)

    wrapper.unmount()
  })

  it('草稿并发编辑触发 409 VERSION_CONFLICT 时展示冲突提示并支持一键刷新最新状态', async () => {
    await mockDevLogin('usr_linmin')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq/courses/crs_thermos')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    // 模拟另一位总部运营提前保存，使服务端 revision 递增至 2
    const current = await hqApi.getHqCourseDetail('crs_thermos')
    const v1 = current.versions[0]
    await hqApi.updateHqCourseVersion(v1.id, {
      expected_revision: v1.revision,
      content: {
        ...v1.content,
        product: { ...v1.content.product, summary: '周毅抢先更新的摘要' },
      },
    })

    // 当前页面仍持旧 revision #1 提交保存，应触发 409 VERSION_CONFLICT
    await wrapper.find('[data-testid="hq-input-product-summary"]').setValue('林敏本地旧草稿')
    await wrapper.find('[data-testid="hq-save-draft-btn"]').trigger('click')
    await flushPromises()

    const errBanner = wrapper.find('[data-testid="hq-action-error"]')
    expect(errBanner.exists()).toBe(true)
    expect(errBanner.text()).toContain('草稿已被其他人更新')
    expect(errBanner.text()).toContain('VERSION_CONFLICT')

    // 点击「刷新最新状态」同步最新修订 #2
    await wrapper.find('[data-testid="hq-error-refresh-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('修订 #2')

    wrapper.unmount()
  })

  it('总部首页原型表单可直接录入新品并一键审校发布至指定门店', async () => {
    await mockDevLogin('usr_linmin')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    expect(wrapper.find('[data-testid="hq-quick-publish-card"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-pilot-overview-card"]').exists()).toBe(true)

    await wrapper.find('[data-testid="hq-quick-name"]').setValue('三丽鸥联名香薰礼盒')
    await wrapper.find('[data-testid="hq-quick-price"]').setValue('¥69.00')
    await wrapper.find('[data-testid="hq-quick-desc"]').setValue('正版联名香薰 69 元，摆放在主推中岛。')
    await wrapper.find('[data-testid="hq-quick-store-store_fs"]').trigger('click')
    await wrapper.find('[data-testid="hq-quick-deadline-72"]').trigger('click')

    // 未勾选审校确认点击发布，提示清单未确认
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hq-quick-error"]').text()).toContain('审校清单尚未全部确认')

    // 勾选人工审校确认并一键发布
    await wrapper.find('[data-testid="hq-quick-check-all"]').setValue(true)
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('三丽鸥联名香薰礼盒')
    expect(wrapper.text()).toContain('应训 5 人')

    wrapper.unmount()
  })
})
