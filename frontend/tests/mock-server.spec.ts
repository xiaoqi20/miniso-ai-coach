import { beforeEach, describe, expect, it } from 'vitest'
import {
  MockHttpError,
  mockCompleteChapter,
  mockCreateOrGetRoleplaySession,
  mockDevLogin,
  mockFetchMe,
  mockGetRoleplaySession,
  mockGetStaffAssignment,
  mockListStaffAssignments,
  mockLogout,
  mockPreviewRoleplay,
  mockSubmitRoleplayRound,
  resetMockState,
  setMockNextRoundFault,
} from '@/mock/server'
import { M1_SAMPLE_INPUTS } from '@/mock/seed'
import { createClientUuid } from '@/utils/assignment'

describe('M1 Mock 服务端契约与状态流转测试', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetMockState()
  })

  it('未登录返回 401 AUTH_REQUIRED，非员工角色访问员工接口返回 403 FORBIDDEN_ROLE', async () => {
    await expect(mockFetchMe()).rejects.toMatchObject({
      status: 401,
      payload: { error: { code: 'AUTH_REQUIRED' } },
    })

    await mockDevLogin('usr_linmin')
    await expect(mockListStaffAssignments()).rejects.toMatchObject({
      status: 403,
      payload: { error: { code: 'FORBIDDEN_ROLE' } },
    })

    await mockLogout()
    await expect(mockFetchMe()).rejects.toBeInstanceOf(MockHttpError)
  })

  it('跨门店与非本人任务隔离：佛山门店员工看不到北京发布批次且直访返回 404', async () => {
    await mockDevLogin('usr_zhoulin')
    const list = await mockListStaffAssignments()
    expect(list.items).toEqual([])

    await expect(mockGetStaffAssignment('asg_m1_bj_linxiaomei')).rejects.toMatchObject({
      status: 404,
      payload: { error: { code: 'NOT_FOUND' } },
    })
  })

  it('未学完章节拦截 409 CHAPTERS_INCOMPLETE，演示预览不落库，章节完成幂等', async () => {
    await mockDevLogin('usr_linxiaomei')

    await expect(mockCreateOrGetRoleplaySession('asg_m1_bj_linxiaomei')).rejects.toMatchObject({
      status: 409,
      payload: {
        error: {
          code: 'CHAPTERS_INCOMPLETE',
          details: { missing_chapters: ['ch1', 'ch2', 'ch3'] },
        },
      },
    })

    // 未学完章节允许预览评分，且不改变任务分数和 state_version
    const preview = await mockPreviewRoleplay('asg_m1_bj_linxiaomei', {
      answer_text: M1_SAMPLE_INPUTS.correct,
      question_variant: 'default',
    })
    expect(preview.persisted).toBe(false)
    expect(preview.total).toBe(99)

    const beforeDetail = await mockGetStaffAssignment('asg_m1_bj_linxiaomei')
    expect(beforeDetail.assignment.last_score).toBeNull()
    expect(beforeDetail.assignment.state_version).toBe(1)

    // 完成 ch1 及重复上报验证幂等
    const firstComplete = await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch1')
    expect(firstComplete.already_completed).toBe(false)
    expect(firstComplete.assignment_status).toBe('learning')

    const replayComplete = await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch1')
    expect(replayComplete.already_completed).toBe(true)
    expect(replayComplete.completed_at).toBe(firstComplete.completed_at)
    expect(replayComplete.state_version).toBe(firstComplete.state_version)
  })

  it('正式轮次幂等重放与 503 失败保留轮次后同 client_round_id 重试恢复', async () => {
    await mockDevLogin('usr_linxiaomei')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch1')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch2')
    await mockCompleteChapter('asg_m1_bj_linxiaomei', 'ch3')

    const created = await mockCreateOrGetRoleplaySession('asg_m1_bj_linxiaomei')
    const roundId1 = createClientUuid()

    // 注入一次 503 故障
    setMockNextRoundFault('SCORING_UNAVAILABLE')
    await expect(
      mockSubmitRoleplayRound(created.session.id, {
        client_round_id: roundId1,
        answer_text: M1_SAMPLE_INPUTS.synonym,
        question_variant: 'default',
      }),
    ).rejects.toMatchObject({
      status: 503,
      payload: { error: { code: 'SCORING_UNAVAILABLE' } },
    })

    // 会话恢复应包含状态为 failed 的第 1 轮，且不写入成绩
    const afterFail = await mockGetRoleplaySession(created.session.id)
    expect(afterFail.rounds).toHaveLength(1)
    expect(afterFail.rounds[0].round_no).toBe(1)
    expect(afterFail.rounds[0].status).toBe('failed')
    expect(afterFail.rounds[0].failure_code).toBe('SCORING_UNAVAILABLE')

    // 用同一 client_round_id 重试成功，仍保持 round_no = 1
    const retried = await mockSubmitRoleplayRound(created.session.id, {
      client_round_id: roundId1,
      answer_text: M1_SAMPLE_INPUTS.synonym,
      question_variant: 'default',
    })
    expect(retried.round.round_no).toBe(1)
    expect(retried.replayed).toBe(false)
    expect(retried.attempt.total).toBe(91)
    expect(retried.assignment.status).toBe('passed')

    // 再次重复提交同一 client_round_id 返回 replayed=true
    const replayed = await mockSubmitRoleplayRound(created.session.id, {
      client_round_id: roundId1,
      answer_text: M1_SAMPLE_INPUTS.synonym,
      question_variant: 'default',
    })
    expect(replayed.replayed).toBe(true)
    expect(replayed.attempt.attempt_id).toBe(retried.attempt.attempt_id)
  })

  it('补训复练状态推进：pending -> retrain_unfixed -> pending_review 并冻结证据', async () => {
    await mockDevLogin('usr_chenajie')
    const created = await mockCreateOrGetRoleplaySession('asg_m1_bj_chenajie')

    // 第 2 轮仍漏讲端盒规则，状态推进为 retrain_unfixed
    const unfixed = await mockSubmitRoleplayRound(created.session.id, {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.missing,
      question_variant: 'alt',
    })
    expect(unfixed.assignment.status).toBe('retrain_unfixed')
    expect(unfixed.open_retrain?.status).toBe('submitted_unfixed')

    // 第 3 轮讲全端盒规则并整体通关，推进为 pending_review
    const fixed = await mockSubmitRoleplayRound(created.session.id, {
      client_round_id: createClientUuid(),
      answer_text: M1_SAMPLE_INPUTS.correct,
      question_variant: 'alt',
    })
    expect(fixed.assignment.status).toBe('pending_review')
    expect(fixed.open_retrain?.status).toBe('fixed_pending_review')
  })
})
