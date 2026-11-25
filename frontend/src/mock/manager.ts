import {
  canonicalFingerprint,
  computeReleaseStats,
  lookupIdempotencyReplay,
  requireIdempotencyKey,
  saveIdempotencyRecord,
} from '@/mock/helpers'
import { DEV_USERS } from '@/mock/seed'
import {
  MockHttpError,
  deriveStatus,
  findOpenRetrain,
  formatOpenRetrain,
  getStoreName,
  loadState,
  nextTimestamp,
  requireCurrentUser,
  resolveReleaseCourseVersion,
  saveState,
  type MockDatabaseState,
  type StoredAssignment,
  type StoredRelease,
  type StoredRetrain,
} from '@/mock/server'
import type {
  IdempotentResult,
  IssueRetrainRequest,
  IssueRetrainResponse,
  ManagerAssignmentDetailResponse,
  ManagerAttemptDetail,
  ManagerReleaseAssigneeItem,
  ManagerReleaseDetailResponse,
  ManagerReleaseListItem,
  PageResponse,
  ReleaseStatsResponse,
  ReviewRetrainRequest,
  ReviewRetrainResponse,
  UserRef,
} from '@/types/api'

function managerStoreIds(user: UserRef): Set<string> {
  return new Set(user.stores.filter((s) => s.role === 'store_manager').map((s) => s.id))
}

function getManagedRelease(
  state: MockDatabaseState,
  user: UserRef,
  releaseId: string,
): { release: StoredRelease; allowedStores: Set<string> } {
  const allowedStores = managerStoreIds(user)
  const release = state.releases.find(
    (item) =>
      item.id === releaseId && item.target_store_ids.some((storeId) => allowedStores.has(storeId)),
  )
  if (!release) {
    throw new MockHttpError(404, 'NOT_FOUND', '发布批次不存在或不在本店管辖范围')
  }
  return { release, allowedStores }
}

function getManagedAssignment(
  state: MockDatabaseState,
  user: UserRef,
  assignmentId: string,
): StoredAssignment {
  const allowedStores = managerStoreIds(user)
  const asg = state.assignments.find(
    (item) => item.assignment_id === assignmentId && allowedStores.has(item.store_id),
  )
  if (!asg) {
    throw new MockHttpError(404, 'NOT_FOUND', '学员任务不存在或不在本店管辖范围')
  }
  return asg
}

export async function mockListManagerReleases(): Promise<PageResponse<ManagerReleaseListItem>> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const allowedStores = managerStoreIds(user)

  const items: ManagerReleaseListItem[] = state.releases
    .filter((release) => release.target_store_ids.some((id) => allowedStores.has(id)))
    .map((release) => {
      const { course } = resolveReleaseCourseVersion(state, release.id)
      const scopedStores = release.target_store_ids.filter((id) => allowedStores.has(id))
      const scopedAsgs = state.assignments.filter(
        (a) => a.release_id === release.id && allowedStores.has(a.store_id),
      )
      const stats = computeReleaseStats(state, release, allowedStores)
      return {
        release_id: release.id,
        course: { id: course.id, name: course.name },
        published_at: release.published_at,
        deadline_at: release.deadline_at,
        stores: scopedStores,
        assigned: scopedAsgs.length,
        qualified_in_window: stats.numerator,
        pending_review: scopedAsgs.filter((a) => a.status === 'pending_review').length,
        open_retrains: scopedAsgs.filter((a) => Boolean(findOpenRetrain(a.retrains))).length,
      }
    })
    .sort((a, b) => b.published_at.localeCompare(a.published_at))

  return { items, next_cursor: null }
}

export async function mockGetManagerReleaseDetail(
  releaseId: string,
): Promise<ManagerReleaseDetailResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const { release, allowedStores } = getManagedRelease(state, user, releaseId)
  const { course } = resolveReleaseCourseVersion(state, release.id)
  const stats = computeReleaseStats(state, release, allowedStores)

  return {
    release: {
      id: release.id,
      course: { id: course.id, name: course.name },
      published_at: release.published_at,
      deadline_at: release.deadline_at,
      stores: release.target_store_ids
        .filter((id) => allowedStores.has(id))
        .map((storeId) => {
          const storeAsgs = state.assignments.filter(
            (a) => a.release_id === release.id && a.store_id === storeId,
          )
          const storeStat = stats.by_store.find((s) => s.store_id === storeId)
          return {
            id: storeId,
            name: getStoreName(storeId),
            assigned: storeAsgs.length,
            qualified_in_window: storeStat?.numerator ?? 0,
            pending_review: storeAsgs.filter((a) => a.status === 'pending_review').length,
            open_retrains: storeAsgs.filter((a) => Boolean(findOpenRetrain(a.retrains))).length,
          }
        }),
    },
  }
}

export async function mockListManagerReleaseAssignees(
  releaseId: string,
): Promise<PageResponse<ManagerReleaseAssigneeItem>> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const { release, allowedStores } = getManagedRelease(state, user, releaseId)
  const { version } = resolveReleaseCourseVersion(state, release.id)
  const inactiveSet = new Set(state.inactive_user_ids)

  const items: ManagerReleaseAssigneeItem[] = state.assignments
    .filter((a) => a.release_id === release.id && allowedStores.has(a.store_id))
    .map((asg) => ({
      assignment_id: asg.assignment_id,
      user: {
        id: asg.user_id,
        name: DEV_USERS.find((u) => u.id === asg.user_id)?.name ?? asg.user_id,
        active: !inactiveSet.has(asg.user_id),
      },
      store_id: asg.store_id,
      status: asg.status,
      completed_chapter_count: asg.chapter_progress.length,
      required_chapters: version.content.chapters.length,
      last_score: asg.last_score,
      best_score: asg.best_score,
      qualified_at: asg.qualified_at,
      open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
      state_version: asg.state_version,
    }))
    .sort((a, b) => a.user.name.localeCompare(b.user.name))

  return { items, next_cursor: null }
}

export async function mockGetManagerAssignmentDetail(
  assignmentId: string,
): Promise<ManagerAssignmentDetailResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const asg = getManagedAssignment(state, user, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)
  const inactiveSet = new Set(state.inactive_user_ids)

  const allAttemptsById = new Map<string, ManagerAttemptDetail>()
  const sortedAttempts: ManagerAttemptDetail[] = asg.rounds
    .filter((r) => Boolean(r.full_attempt))
    .sort((a, b) => b.round_no - a.round_no)
    .map((r) => {
      const full = r.full_attempt!
      const detail: ManagerAttemptDetail = {
        attempt_id: full.attempt_id,
        round_no: r.round_no,
        total: full.total,
        passed: full.passed,
        answer_text: full.answer_text,
        fact_checks: structuredClone(full.fact_checks),
        missed_required_facts: structuredClone(full.missed_required_facts),
        redline_hits: structuredClone(full.redline_hits),
        computed_at: full.computed_at,
      }
      allAttemptsById.set(detail.attempt_id, detail)
      return detail
    })
  const attempts = sortedAttempts.slice(0, 10)

  const retrainIds = new Set(asg.retrains.map((r) => r.id))
  const audit = state.audit_events
    .filter((ev) => ev.assignment_id === asg.assignment_id || retrainIds.has(ev.entity_id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((ev) => ({
      action: ev.action,
      actor: { ...ev.actor },
      at: ev.at,
      payload: structuredClone(ev.payload),
    }))

  return {
    assignment: {
      assignment_id: asg.assignment_id,
      release_id: asg.release_id,
      store_id: asg.store_id,
      user: {
        id: asg.user_id,
        name: DEV_USERS.find((u) => u.id === asg.user_id)?.name ?? asg.user_id,
        active: !inactiveSet.has(asg.user_id),
      },
      status: asg.status,
      completed_chapter_count: asg.chapter_progress.length,
      required_chapters: version.content.chapters.length,
      last_score: asg.last_score,
      best_score: asg.best_score,
      first_passed_at: asg.qualified_at,
      qualified_at: asg.qualified_at,
      state_version: asg.state_version,
    },
    attempts,
    retrains: [...asg.retrains].reverse().map((rt) => ({
      id: rt.id,
      status: rt.status,
      focus: { ...rt.focus },
      note: rt.note,
      baseline_round_no: rt.baseline_round_no,
      evidence_round_no: rt.evidence_round_no,
      evidence_attempt_id: rt.evidence_attempt_id,
      evidence_attempt: rt.evidence_attempt_id
        ? structuredClone(allAttemptsById.get(rt.evidence_attempt_id) ?? null)
        : null,
      issued_by: { ...rt.issued_by },
      issued_at: rt.issued_at,
      reviewed_by: rt.reviewed_by ? { ...rt.reviewed_by } : null,
      reviewed_at: rt.reviewed_at,
      review_note: rt.review_note,
      version: rt.version,
    })),
    audit,
  }
}

export async function mockGetManagerReleaseStats(releaseId: string): Promise<ReleaseStatsResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const { release, allowedStores } = getManagedRelease(state, user, releaseId)
  return computeReleaseStats(state, release, allowedStores)
}

export async function mockIssueManagerRetrain(
  assignmentId: string,
  body: IssueRetrainRequest,
  idempotencyKey?: string,
): Promise<IdempotentResult<IssueRetrainResponse>> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const key = requireIdempotencyKey(idempotencyKey)
  const route = `POST /api/v1/manager/assignments/${assignmentId}/retrains`
  const fingerprint = canonicalFingerprint(body)

  const replay = lookupIdempotencyReplay<IssueRetrainResponse>(
    state,
    user.id,
    route,
    key,
    fingerprint,
  )
  if (replay) return { data: replay, replayed: true }

  const asg = getManagedAssignment(state, user, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)

  const existingOpen = findOpenRetrain(asg.retrains)
  if (existingOpen) {
    throw new MockHttpError(409, 'RETRAIN_EXISTS', '该学员已存在进行中的补训工单', {
      retrain: formatOpenRetrain(existingOpen),
    })
  }

  const scoredRounds = asg.rounds
    .filter((r) => Boolean(r.full_attempt))
    .sort((a, b) => b.round_no - a.round_no)
  const latestAttempt = scoredRounds[0]?.full_attempt
  if (!latestAttempt) {
    throw new MockHttpError(409, 'NO_ATTEMPT', '学员尚无正式对练成绩，无法指派补训')
  }

  const focusKey = String(body.focus_fact_key ?? '').trim()
  const missedFact = latestAttempt.missed_required_facts.find((fact) => fact.key === focusKey)
  if (!missedFact) {
    throw new MockHttpError(
      422,
      'FOCUS_NOT_MISSED',
      '补训考点不在最近一次正式成绩的漏讲必考项中',
      { missed_required_facts: latestAttempt.missed_required_facts },
    )
  }

  const now = nextTimestamp(state)
  state.next_retrain_seq += 1
  const retrain: StoredRetrain = {
    id: `rtn_mock_${state.next_retrain_seq}`,
    status: 'pending',
    focus: { fact_key: missedFact.key, label: missedFact.label },
    note: String(body.note ?? '').trim(),
    baseline_round_no: asg.roleplay_session?.last_round_no ?? scoredRounds[0].round_no,
    evidence_round_no: null,
    evidence_attempt_id: null,
    issued_by: { id: user.id, name: user.name },
    issued_at: now,
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    version: 1,
  }

  asg.retrains.push(retrain)
  asg.status = deriveStatus(asg, version.content.chapters.length)
  asg.state_version += 1

  state.next_audit_seq += 1
  state.audit_events.push({
    id: `aud_mock_${state.next_audit_seq}`,
    action: 'retrain.issued',
    entity_type: 'retrain',
    entity_id: retrain.id,
    assignment_id: asg.assignment_id,
    store_id: asg.store_id,
    actor: { id: user.id, name: user.name },
    at: now,
    payload: {
      focus_fact_key: retrain.focus.fact_key,
      focus_fact_label: retrain.focus.label,
      note: retrain.note,
    },
  })

  const responseBody: IssueRetrainResponse = {
    retrain: {
      id: retrain.id,
      status: retrain.status,
      focus: { ...retrain.focus },
      baseline_round_no: retrain.baseline_round_no,
      version: retrain.version,
      issued_by: { ...retrain.issued_by },
      issued_at: retrain.issued_at,
    },
    assignment: {
      assignment_id: asg.assignment_id,
      status: asg.status,
      state_version: asg.state_version,
    },
  }
  saveIdempotencyRecord(state, user.id, route, key, fingerprint, 201, responseBody)
  saveState(state)

  return { data: responseBody, replayed: false }
}

export async function mockReviewManagerRetrain(
  retrainId: string,
  body: ReviewRetrainRequest,
  idempotencyKey?: string,
): Promise<IdempotentResult<ReviewRetrainResponse>> {
  const state = loadState()
  const user = requireCurrentUser(state, 'store_manager')
  const key = requireIdempotencyKey(idempotencyKey)
  const route = `POST /api/v1/manager/retrains/${retrainId}/review`
  const fingerprint = canonicalFingerprint(body)

  const replay = lookupIdempotencyReplay<ReviewRetrainResponse>(
    state,
    user.id,
    route,
    key,
    fingerprint,
  )
  if (replay) return { data: replay, replayed: true }

  const allowedStores = managerStoreIds(user)
  let targetAsg: StoredAssignment | null = null
  let targetRetrain: StoredRetrain | null = null
  for (const asg of state.assignments) {
    if (!allowedStores.has(asg.store_id)) continue
    const found = asg.retrains.find((item) => item.id === retrainId)
    if (found) {
      targetAsg = asg
      targetRetrain = found
      break
    }
  }
  if (!targetAsg || !targetRetrain) {
    throw new MockHttpError(404, 'NOT_FOUND', '补训记录不存在或不在本店管辖范围')
  }

  if (targetRetrain.status !== 'fixed_pending_review') {
    throw new MockHttpError(409, 'STATE_CONFLICT', '当前补训状态不是待复查，无法提交复查决定', {
      current_status: targetRetrain.status,
      current_version: targetRetrain.version,
      evidence_attempt_id: targetRetrain.evidence_attempt_id,
    })
  }
  if (targetRetrain.version !== body.expected_version) {
    throw new MockHttpError(409, 'STATE_CONFLICT', '复查状态已被其他操作更新，请刷新后重试', {
      current_status: targetRetrain.status,
      current_version: targetRetrain.version,
      evidence_attempt_id: targetRetrain.evidence_attempt_id,
    })
  }

  const { version } = resolveReleaseCourseVersion(state, targetAsg.release_id)
  const now = nextTimestamp(state)
  const note = String(body.note ?? '').trim()

  if (body.decision === 'confirm') {
    if (!body.evidence_attempt_id || body.evidence_attempt_id !== targetRetrain.evidence_attempt_id) {
      throw new MockHttpError(409, 'EVIDENCE_MISMATCH', '复查证据与当前待复查冻结证据不一致', {
        current_evidence_attempt_id: targetRetrain.evidence_attempt_id,
      })
    }
    const frozenAttempt = targetAsg.rounds
      .map((r) => r.full_attempt)
      .find((att) => att?.attempt_id === targetRetrain.evidence_attempt_id)
    if (!frozenAttempt || !frozenAttempt.passed) {
      throw new MockHttpError(422, 'ATTEMPT_NOT_PASSED', '复查证据未达到整轮通关标准', {
        missed_required_facts: frozenAttempt?.missed_required_facts ?? [],
      })
    }
    const focusCheck = frozenAttempt.fact_checks.find(
      (fc) => fc.key === targetRetrain.focus.fact_key,
    )
    if (!focusCheck || focusCheck.status !== 'hit') {
      throw new MockHttpError(422, 'FOCUS_NOT_FIXED', '复查证据未证明目标补训考点已改正')
    }

    targetRetrain.status = 'verified'
    targetRetrain.reviewed_by = { id: user.id, name: user.name }
    targetRetrain.reviewed_at = now
    targetRetrain.review_note = note
    targetRetrain.version += 1

    targetAsg.status = deriveStatus(targetAsg, version.content.chapters.length)
    targetAsg.state_version += 1

    state.next_audit_seq += 1
    state.audit_events.push({
      id: `aud_mock_${state.next_audit_seq}`,
      action: 'retrain.confirmed',
      entity_type: 'retrain',
      entity_id: targetRetrain.id,
      assignment_id: targetAsg.assignment_id,
      store_id: targetAsg.store_id,
      actor: { id: user.id, name: user.name },
      at: now,
      payload: {
        focus_fact_key: targetRetrain.focus.fact_key,
        evidence_attempt_id: targetRetrain.evidence_attempt_id,
        score: frozenAttempt.total,
        note,
      },
    })

    const responseBody: ReviewRetrainResponse = {
      retrain: {
        id: targetRetrain.id,
        status: targetRetrain.status,
        evidence_attempt_id: targetRetrain.evidence_attempt_id,
        reviewed_by: { id: user.id, name: user.name },
        reviewed_at: now,
        version: targetRetrain.version,
      },
      assignment: {
        assignment_id: targetAsg.assignment_id,
        status: targetAsg.status,
        qualified_at: targetAsg.qualified_at,
        state_version: targetAsg.state_version,
      },
    }
    saveIdempotencyRecord(state, user.id, route, key, fingerprint, 200, responseBody)
    saveState(state)
    return { data: responseBody, replayed: false }
  }

  // 驳回复查：状态回退为 pending，基线更新为当前 last_round_no，清空冻结证据
  const prevEvidenceId = targetRetrain.evidence_attempt_id
  targetRetrain.status = 'pending'
  targetRetrain.baseline_round_no =
    targetAsg.roleplay_session?.last_round_no ?? targetRetrain.evidence_round_no ?? 0
  targetRetrain.evidence_round_no = null
  targetRetrain.evidence_attempt_id = null
  targetRetrain.reviewed_by = { id: user.id, name: user.name }
  targetRetrain.reviewed_at = now
  targetRetrain.review_note = note
  targetRetrain.version += 1

  targetAsg.status = deriveStatus(targetAsg, version.content.chapters.length)
  targetAsg.state_version += 1

  state.next_audit_seq += 1
  state.audit_events.push({
    id: `aud_mock_${state.next_audit_seq}`,
    action: 'retrain.rejected',
    entity_type: 'retrain',
    entity_id: targetRetrain.id,
    assignment_id: targetAsg.assignment_id,
    store_id: targetAsg.store_id,
    actor: { id: user.id, name: user.name },
    at: now,
    payload: {
      focus_fact_key: targetRetrain.focus.fact_key,
      rejected_evidence_attempt_id: prevEvidenceId,
      new_baseline_round_no: targetRetrain.baseline_round_no,
      note,
    },
  })

  const responseBody: ReviewRetrainResponse = {
    retrain: {
      id: targetRetrain.id,
      status: targetRetrain.status,
      evidence_attempt_id: null,
      baseline_round_no: targetRetrain.baseline_round_no,
      reviewed_by: { id: user.id, name: user.name },
      reviewed_at: now,
      version: targetRetrain.version,
    },
    assignment: {
      assignment_id: targetAsg.assignment_id,
      status: targetAsg.status,
      state_version: targetAsg.state_version,
    },
  }
  saveIdempotencyRecord(state, user.id, route, key, fingerprint, 200, responseBody)
  saveState(state)
  return { data: responseBody, replayed: false }
}
