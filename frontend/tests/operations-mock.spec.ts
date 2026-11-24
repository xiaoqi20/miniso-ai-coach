import { beforeEach, describe, expect, it } from 'vitest'
import { ApiClientError } from '@/api/client'
import * as hqApi from '@/api/hq'
import * as managerApi from '@/api/manager'
import * as staffApi from '@/api/staff'
import { M1_SAMPLE_INPUTS } from '@/mock/seed'
import { mockDevLogin, resetMockState, setMockInactiveUsers } from '@/mock/server'
import { createClientUuid } from '@/utils/assignment'

async function expectApiError(fn: () => Promise<unknown>, status: number, code: string) {
  try {
    await fn()
    throw new Error(`期望抛出 ${status} ${code}，但实际成功`)
  } catch (err) {
    expect(err).toBeInstanceOf(ApiClientError)
    const apiErr = err as ApiClientError
    expect(apiErr.status).toBe(status)
    expect(apiErr.code).toBe(code)
    return apiErr
  }
}

describe('总部与店长契约 Mock 服务端校验（权限、幂等、乐观锁与 48h 统计）', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
  })

  it('总部审校清单校验、修订乐观锁、不可变版本与同键幂等重放', async () => {
    await mockDevLogin('usr_linmin')

    const detail = await hqApi.getHqCourseDetail('crs_thermos')
    const draft = detail.versions[0]
    expect(draft.status).toBe('draft')

    // 未审校直接发布返回 409 STATE_CONFLICT
    await expectApiError(
      () =>
        hqApi.publishHqCourseVersion(
          draft.id,
          { store_ids: ['store_bj'], deadline_hours: 48, expected_revision: draft.revision },
          createClientUuid(),
        ),
      409,
      'STATE_CONFLICT',
    )

    // 修订号不匹配返回 409 VERSION_CONFLICT
    await expectApiError(
      () =>
        hqApi.updateHqCourseVersion(draft.id, {
          expected_revision: 99,
          content: draft.content,
        }),
      409,
      'VERSION_CONFLICT',
    )

    // 审校清单不全返回 422 REVIEW_CHECKLIST_INCOMPLETE
    await expectApiError(
      () =>
        hqApi.reviewHqCourseVersion(draft.id, {
          checklist: { price_verified: true, spec_verified: false, redline_verified: true },
        }),
      422,
      'REVIEW_CHECKLIST_INCOMPLETE',
    )

    // 审校通过后内容不可修改
    const reviewed = await hqApi.reviewHqCourseVersion(draft.id, {
      checklist: { price_verified: true, spec_verified: true, redline_verified: true },
      note: '三项核对通过',
    })
    expect(reviewed.status).toBe('approved')

    await expectApiError(
      () =>
        hqApi.updateHqCourseVersion(draft.id, {
          expected_revision: reviewed.revision,
          content: draft.content,
        }),
      409,
      'VERSION_IMMUTABLE',
    )

    // 同一 Idempotency-Key 重复发布返回同一批次并标记 replayed=true
    const idemKey = createClientUuid()
    const pub1 = await hqApi.publishHqCourseVersion(
      draft.id,
      { store_ids: ['store_fs'], deadline_hours: 48, expected_revision: reviewed.revision },
      idemKey,
    )
    expect(pub1.replayed).toBe(false)
    expect(pub1.data.release.assigned_total).toBe(2)

    const pubReplay = await hqApi.publishHqCourseVersion(
      draft.id,
      { store_ids: ['store_fs'], deadline_hours: 48, expected_revision: reviewed.revision },
      idemKey,
    )
    expect(pubReplay.replayed).toBe(true)
    expect(pubReplay.data.release.id).toBe(pub1.data.release.id)

    // 相同键不同请求体返回 409 IDEMPOTENCY_KEY_REUSED
    await expectApiError(
      () =>
        hqApi.publishHqCourseVersion(
          draft.id,
          { store_ids: ['store_bj'], deadline_hours: 48, expected_revision: reviewed.revision },
          idemKey,
        ),
      409,
      'IDEMPOTENCY_KEY_REUSED',
    )

    // 克隆 v2 发布后，旧版 v1 变为 superseded 且禁止再次发布
    const cloned = await hqApi.cloneHqCourseVersion('crs_thermos', {
      source_version_id: draft.id,
    })
    await hqApi.reviewHqCourseVersion(cloned.version.id, {
      checklist: { price_verified: true, spec_verified: true, redline_verified: true },
    })
    await hqApi.publishHqCourseVersion(
      cloned.version.id,
      { store_ids: ['store_bj'], deadline_hours: 24, expected_revision: 1 },
      createClientUuid(),
    )
    await expectApiError(
      () =>
        hqApi.publishHqCourseVersion(
          draft.id,
          { store_ids: ['store_fs'], deadline_hours: 48, expected_revision: reviewed.revision },
          createClientUuid(),
        ),
      409,
      'STATE_CONFLICT',
    )
  })

  it('空名单发布 48 小时统计返回 rate=null 与 empty_roster=true，且跨店严格隔离 404', async () => {
    await mockDevLogin('usr_linmin')
    // 临时停用佛山店全部员工以测试空名单口径
    setMockInactiveUsers(['usr_zhoulin', 'usr_hejing'])
    const pub = await hqApi.publishHqCourseVersion(
      'crv_chiikawa_v1',
      { store_ids: ['store_fs'], deadline_hours: 48, expected_revision: 2 },
      createClientUuid(),
    )
    expect(pub.data.release.assigned_total).toBe(0)

    const stats = await hqApi.getHqReleaseStats(pub.data.release.id)
    expect(stats.denominator).toBe(0)
    expect(stats.numerator).toBe(0)
    expect(stats.rate).toBeNull()
    expect(stats.empty_roster).toBe(true)

    // 北京路店长越权访问佛山批次返回 404 NOT_FOUND
    await mockDevLogin('usr_liming')
    await expectApiError(
      () => managerApi.getManagerReleaseDetail(pub.data.release.id),
      404,
      'NOT_FOUND',
    )

    // 员工访问总部或店长接口返回 403 FORBIDDEN_ROLE
    await mockDevLogin('usr_linxiaomei')
    await expectApiError(() => hqApi.listHqCourses(), 403, 'FORBIDDEN_ROLE')
    await expectApiError(() => managerApi.listManagerReleases(), 403, 'FORBIDDEN_ROLE')
  })

  it('店长补训指派、复查乐观锁、证据核验与驳回基线重置', async () => {
    // 1. 王晓雪无正式成绩，不能指派补训 -> 409 NO_ATTEMPT
    await mockDevLogin('usr_liming')
    await expectApiError(
      () =>
        managerApi.issueManagerRetrain(
          'asg_m1_bj_wangxiaoxue',
          { focus_fact_key: 'fact_box_rule', note: '测试' },
          createClientUuid(),
        ),
      409,
      'NO_ATTEMPT',
    )

    // 2. 陈阿杰已有进行中补训 -> 409 RETRAIN_EXISTS，且未到待复查不能提前确认 -> 409 STATE_CONFLICT
    await expectApiError(
      () =>
        managerApi.issueManagerRetrain(
          'asg_m1_bj_chenajie',
          { focus_fact_key: 'fact_box_rule', note: '重复指派' },
          createClientUuid(),
        ),
      409,
      'RETRAIN_EXISTS',
    )
    await expectApiError(
      () =>
        managerApi.reviewManagerRetrain(
          'rtn_m1_bj_chenajie_01',
          {
            decision: 'confirm',
            expected_version: 1,
            evidence_attempt_id: 'att_m1_bj_chenajie_01',
            note: '提前确认',
          },
          createClientUuid(),
        ),
      409,
      'STATE_CONFLICT',
    )

    // 3. 陈阿杰完成整轮通关复练 -> 进入 pending_review
    await mockDevLogin('usr_chenajie')
    const submit = await staffApi.submitRoleplayRound('rps_m1_bj_chenajie', {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.synonym,
      question_variant: 'default',
    })
    expect(submit.assignment.status).toBe('pending_review')
    const qualifiedAt = submit.assignment.qualified_at
    expect(qualifiedAt).toBeTruthy()
    const frozenAttemptId = submit.attempt.attempt_id

    // 4. 店长用错误 expected_version 返回 409 STATE_CONFLICT，用错误证据 ID 返回 409 EVIDENCE_MISMATCH
    await mockDevLogin('usr_liming')
    await expectApiError(
      () =>
        managerApi.reviewManagerRetrain(
          'rtn_m1_bj_chenajie_01',
          {
            decision: 'confirm',
            expected_version: 99,
            evidence_attempt_id: frozenAttemptId,
            note: '过期版本',
          },
          createClientUuid(),
        ),
      409,
      'STATE_CONFLICT',
    )
    await expectApiError(
      () =>
        managerApi.reviewManagerRetrain(
          'rtn_m1_bj_chenajie_01',
          {
            decision: 'confirm',
            expected_version: 2,
            evidence_attempt_id: 'att_wrong',
            note: '错证据',
          },
          createClientUuid(),
        ),
      409,
      'EVIDENCE_MISMATCH',
    )

    // 5. 店长确认通过（含幂等重放），qualified_at 不变且写入审计
    const reviewKey = createClientUuid()
    const confirmed = await managerApi.reviewManagerRetrain(
      'rtn_m1_bj_chenajie_01',
      {
        decision: 'confirm',
        expected_version: 2,
        evidence_attempt_id: frozenAttemptId,
        note: '确认端盒规则已补齐',
      },
      reviewKey,
    )
    expect(confirmed.replayed).toBe(false)
    expect(confirmed.data.assignment.status).toBe('verified')
    expect(confirmed.data.assignment.qualified_at).toBe(qualifiedAt)

    const confirmedReplay = await managerApi.reviewManagerRetrain(
      'rtn_m1_bj_chenajie_01',
      {
        decision: 'confirm',
        expected_version: 2,
        evidence_attempt_id: frozenAttemptId,
        note: '确认端盒规则已补齐',
      },
      reviewKey,
    )
    expect(confirmedReplay.replayed).toBe(true)
    expect(confirmedReplay.data.retrain.version).toBe(confirmed.data.retrain.version)

    const detail = await managerApi.getManagerAssignmentDetail('asg_m1_bj_chenajie')
    expect(detail.audit.some((ev) => ev.action === 'retrain.confirmed')).toBe(true)
  })
})
