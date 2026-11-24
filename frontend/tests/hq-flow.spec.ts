import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import App from '@/App.vue'
import { ApiClientError } from '@/api/client'
import * as hqApi from '@/api/hq'
import * as staffApi from '@/api/staff'
import { useSession } from '@/composables/useSession'
import { mockPublishHqCourseVersion } from '@/mock/hq'
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
    window.sessionStorage.clear()
    resetMockState()
    useSession().resetLocalSessionState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    await wrapper.find('[data-testid="hq-quick-facts"]').setValue('零售价 69 元, 天然植物精油')
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

  it('P1 回归：缺少经审校内容时拒绝直发仅可存草稿；连续快捷发布两个不同事实商品互不串用话术、规则与问答', async () => {
    await mockDevLogin('usr_linmin')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    // 0. 仅填名称缺少价格/事实/卖点时，拒绝一键发布，允许存为待审校草稿
    await wrapper.find('[data-testid="hq-quick-name"]').setValue('待完善新品草稿')
    await wrapper.find('[data-testid="hq-quick-check-all"]').setValue(true)
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hq-quick-error"]').text()).toContain('缺少经审校的完整课程内容')

    await wrapper.find('[data-testid="hq-quick-save-draft-btn"]').trigger('click')
    await flushPromises()
    const draftCourses = await hqApi.listHqCourses()
    const savedDraft = draftCourses.items.find((c) => c.name === '待完善新品草稿')
    expect(savedDraft?.latest_version?.status).toBe('draft')
    expect(savedDraft?.published_release_count).toBe(0)

    // 1. 发布商品 A：39 元桌面三格收纳盒
    await wrapper.find('[data-testid="hq-quick-name"]').setValue('桌面三格收纳盒')
    await wrapper.find('[data-testid="hq-quick-sku"]').setValue('MINISO-STORAGE-39')
    await wrapper.find('[data-testid="hq-quick-price"]').setValue('¥39.00')
    await wrapper.find('[data-testid="hq-quick-cross"]').setValue('8元标签贴')
    await wrapper.find('[data-testid="hq-quick-facts"]').setValue('透明亚克力材质, 三格分区防尘')
    await wrapper
      .find('[data-testid="hq-quick-desc"]')
      .setValue('这款桌面三格收纳盒零售价 39 元，透明亚克力材质且支持三格分区防尘，桌面理物一步到位。')
    await wrapper.find('[data-testid="hq-quick-check-all"]').setValue(true)
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()

    // 2. 再发布商品 B：129 元便携挂烫机（与收纳盒、保温杯、Chiikawa 均不同）
    await wrapper.find('[data-testid="hq-quick-name"]').setValue('迷你折叠挂烫机')
    await wrapper.find('[data-testid="hq-quick-sku"]').setValue('MINISO-STEAMER-129')
    await wrapper.find('[data-testid="hq-quick-price"]').setValue('¥129.00')
    await wrapper.find('[data-testid="hq-quick-cross"]').setValue('防烫手套')
    await wrapper.find('[data-testid="hq-quick-facts"]').setValue('30秒快速出汽, 干湿双烫')
    await wrapper
      .find('[data-testid="hq-quick-desc"]')
      .setValue('这款迷你折叠挂烫机零售价 129 元，30秒快速出汽支持干湿双烫，出差旅行轻松除皱。')
    await wrapper.find('[data-testid="hq-quick-check-all"]').setValue(true)
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()

    // 核查两个商品的课件、评分规则、示范与顾客问答完全独立且互不串用
    const courses = await hqApi.listHqCourses()
    const storageCourse = courses.items.find((c) => c.sku_code === 'MINISO-STORAGE-39')!
    const steamerCourse = courses.items.find((c) => c.sku_code === 'MINISO-STEAMER-129')!
    const storageDetail = await hqApi.getHqCourseDetail(storageCourse.course_id)
    const steamerDetail = await hqApi.getHqCourseDetail(steamerCourse.course_id)

    const storageRubric = storageDetail.versions[0].rubric!
    const steamerRubric = steamerDetail.versions[0].rubric!

    const storageJson = JSON.stringify({ content: storageDetail.versions[0].content, rubric: storageRubric })
    for (const forbidden of ['79', '保温杯', '316', '6 小时', '杯套', 'Chiikawa', '59', '挂烫机', '129', '防烫手套']) {
      expect(storageJson).not.toContain(forbidden)
    }
    expect(storageRubric.demo_pitch).toContain('桌面三格收纳盒')
    expect(storageRubric.demo_pitch).toContain('39')
    expect(storageRubric.demo_pitch).toContain('8元标签贴')
    expect(storageRubric.scenario.happy_reply).toContain('桌面三格收纳盒')

    const steamerJson = JSON.stringify({ content: steamerDetail.versions[0].content, rubric: steamerRubric })
    for (const forbidden of ['79', '保温杯', '316', '杯套', 'Chiikawa', '59', '收纳盒', '39', '标签贴']) {
      expect(steamerJson).not.toContain(forbidden)
    }
    expect(steamerRubric.demo_pitch).toContain('迷你折叠挂烫机')
    expect(steamerRubric.demo_pitch).toContain('129')
    expect(steamerRubric.demo_pitch).toContain('防烫手套')

    // 切换员工林小美分别预览两门课，示范话术均为各自本品且各自直接通关
    await mockDevLogin('usr_linxiaomei')
    const staffList = await staffApi.listStaffAssignments()
    const storageAsg = staffList.items.find((a) => a.course.name === '桌面三格收纳盒')!
    const steamerAsg = staffList.items.find((a) => a.course.name === '迷你折叠挂烫机')!

    const storagePreview = await staffApi.previewRoleplay(storageAsg.assignment_id, {
      answer_text: storageRubric.demo_pitch,
      question_variant: 'default',
    })
    expect(storagePreview.demo_pitch).toBe(storageRubric.demo_pitch)
    expect(storagePreview.passed).toBe(true)
    expect(storagePreview.missed_required_facts).toHaveLength(0)

    const steamerPreview = await staffApi.previewRoleplay(steamerAsg.assignment_id, {
      answer_text: steamerRubric.demo_pitch,
      question_variant: 'default',
    })
    expect(steamerPreview.demo_pitch).toBe(steamerRubric.demo_pitch)
    expect(steamerPreview.passed).toBe(true)
    expect(steamerPreview.missed_required_facts).toHaveLength(0)

    wrapper.unmount()
  })

  it('P2 回归：覆盖发布前失败与写入后丢失响应，重试沿用原版本与同一幂等键恢复原批次且应训名单唯一', async () => {
    await mockDevLogin('usr_linmin')
    const router = createAppRouter(createMemoryHistory())
    await router.push('/hq')
    await router.isReady()

    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()

    const createSpy = vi.spyOn(hqApi, 'createHqCourse')
    const capturedKeys: string[] = []
    const capturedVersions: string[] = []
    let firstPublishReleaseId = ''
    let publishAttempt = 0

    const publishSpy = vi
      .spyOn(hqApi, 'publishHqCourseVersion')
      .mockImplementation(async (versionId, body, idempotencyKey) => {
        publishAttempt += 1
        capturedKeys.push(idempotencyKey)
        capturedVersions.push(versionId)
        if (publishAttempt === 1) {
          // 场景 1：发布写入前即失败（未落库）
          throw new ApiClientError(503, 'INTERNAL_ERROR', '模拟发布前网关短暂不可用')
        }
        const realResult = await mockPublishHqCourseVersion(versionId, body, idempotencyKey)
        if (publishAttempt === 2) {
          // 场景 2：服务端已写入发布批次与应训任务，但响应在传输中丢失
          firstPublishReleaseId = realResult.data.release.id
          throw new ApiClientError(0, 'NETWORK_ERROR', '模拟网络中断：发布响应丢失')
        }
        return realResult
      })

    await wrapper.find('[data-testid="hq-quick-name"]').setValue('便携折叠收纳箱')
    await wrapper.find('[data-testid="hq-quick-sku"]').setValue('MINISO-FOLD-39')
    await wrapper.find('[data-testid="hq-quick-price"]').setValue('¥39.00')
    await wrapper.find('[data-testid="hq-quick-facts"]').setValue('零售价 39 元, 折叠省空间')
    await wrapper.find('[data-testid="hq-quick-desc"]').setValue('39 元便携折叠收纳箱，可折叠收纳不占空间。')
    await wrapper.find('[data-testid="hq-quick-check-all"]').setValue(true)

    // 第 1 次点击：建课与审校成功，但发布前网关失败
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hq-quick-recovery-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-quick-error"]').exists()).toBe(true)

    // 第 2 次点击：不重复建课，沿用同一版本与幂等键写入成功但响应丢失
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()
    expect(firstPublishReleaseId).toBeTruthy()
    expect(wrapper.find('[data-testid="hq-quick-recovery-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="hq-quick-publish-btn"]').text()).toContain('重试恢复原发布批次')

    // 第 3 次点击：不重复建课、以同一幂等键命中幂等重放取回原批次
    await wrapper.find('[data-testid="hq-quick-publish-btn"]').trigger('click')
    await flushPromises()

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy).toHaveBeenCalledTimes(3)
    expect(new Set(capturedVersions).size).toBe(1)
    expect(new Set(capturedKeys).size).toBe(1)
    expect(wrapper.find('[data-testid="hq-quick-recovery-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="hq-quick-error"]').exists()).toBe(false)
    expect(wrapper.find(`[data-testid="hq-recent-release-${firstPublishReleaseId}"]`).exists()).toBe(
      true,
    )

    // 验证该课程只生成 1 个发布批次，员工林小美也仅收到 1 条应训任务
    const courses = await hqApi.listHqCourses()
    const createdCourse = courses.items.find((c) => c.sku_code === 'MINISO-FOLD-39')
    expect(createdCourse?.published_release_count).toBe(1)

    await mockDevLogin('usr_linxiaomei')
    const staffList = await staffApi.listStaffAssignments()
    const matched = staffList.items.filter((a) => a.course.name === '便携折叠收纳箱')
    expect(matched).toHaveLength(1)
    expect(matched[0].release_id).toBe(firstPublishReleaseId)

    wrapper.unmount()
  })
})
