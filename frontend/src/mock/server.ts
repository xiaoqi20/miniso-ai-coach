import { scoreMockAnswer } from '@/mock/scoring'
import {
  CHIIKAWA_COURSE_CONTENT,
  CHIIKAWA_RUBRIC,
  DEV_USERS,
  M1_SAMPLE_INPUTS,
  MOCK_ANCHOR_T0,
  MOCK_DEADLINE_T0,
  MOCK_STORES,
  THERMOS_COURSE_CONTENT,
  THERMOS_RUBRIC,
} from '@/mock/seed'
import type {
  ApiErrorEnvelope,
  AssignmentStatus,
  AuditEventItem,
  ChapterCompleteResponse,
  CourseContent,
  CourseVersionStatus,
  CreateRoleplaySessionResponse,
  DevLoginResponse,
  MeResponse,
  OpenRetrain,
  PageResponse,
  QuestionVariant,
  ReleaseStatus,
  RetrainStatus,
  RoleplayFullAttempt,
  RoleplayPreviewRequest,
  RoleplayPreviewResponse,
  RoleplayRoundItem,
  RoleplayRoundRequest,
  RoleplayRoundSubmitResponse,
  RoleplaySessionDetailResponse,
  RoleplaySessionRef,
  RubricRules,
  StaffAssignmentDetailResponse,
  StaffAssignmentSummary,
  StaffAttemptSummary,
  UserBrief,
  UserRef,
  UserRole,
} from '@/types/api'

const MOCK_STORAGE_KEY = 'shouke_m1_mock_state_v2'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type MockFaultMode =
  | null
  | 'SCORING_UNAVAILABLE'
  | 'SCORING_INVALID_OUTPUT'
  | 'SCORING_IN_PROGRESS'

/**
 * Mock 服务端错误类：与真实 API 的 HTTP 状态码及 ApiErrorEnvelope 完全一致。
 */
export class MockHttpError extends Error {
  readonly status: number
  readonly payload: ApiErrorEnvelope

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'MockHttpError'
    this.status = status
    this.payload = {
      error: {
        code,
        message,
        request_id: `req_mock_${Date.now().toString(36)}`,
        ...(details ? { details } : {}),
      },
    }
  }
}

export interface StoredChapterProgress {
  chapter_key: string
  completed_at: string
}

export interface StoredAttempt extends RoleplayFullAttempt {
  round_no: number
  answer_text: string
}

export interface StoredRetrain {
  id: string
  status: RetrainStatus
  focus: {
    fact_key: string
    label: string
  }
  note: string
  baseline_round_no: number
  evidence_round_no: number | null
  evidence_attempt_id: string | null
  issued_by: UserBrief
  issued_at: string
  reviewed_by: UserBrief | null
  reviewed_at: string | null
  review_note: string | null
  version: number
}

export interface StoredCourseVersion {
  id: string
  course_id: string
  version_no: number
  status: CourseVersionStatus
  revision: number
  content: CourseContent
  rubric_version_id: string
  rubric: RubricRules
  created_by: string
  created_at: string
  updated_at: string
  reviewed_by: UserBrief | null
  reviewed_at: string | null
}

export interface StoredCourse {
  id: string
  sku_code: string
  name: string
  created_by: string
  created_at: string
  versions: StoredCourseVersion[]
}

export interface StoredRelease {
  id: string
  course_id: string
  course_version_id: string
  rubric_version_id: string
  status: ReleaseStatus
  deadline_hours: number
  deadline_at: string
  published_by: UserBrief
  published_at: string
  target_store_ids: string[]
}

export interface StoredAuditEvent extends AuditEventItem {
  id: string
  entity_type: 'course_version' | 'release' | 'retrain'
  entity_id: string
  assignment_id?: string
  store_id: string | null
}

export interface StoredIdempotencyRecord {
  user_id: string
  route: string
  key: string
  request_fingerprint: string
  status_code: number
  response_body: unknown
}

export interface StoredAssignment {
  assignment_id: string
  release_id: string
  store_id: string
  user_id: string
  published_at: string
  deadline_at: string
  status: AssignmentStatus
  chapter_progress: StoredChapterProgress[]
  last_score: number | null
  best_score: number | null
  qualified_at: string | null
  state_version: number
  roleplay_session: RoleplaySessionRef | null
  rounds: Array<RoleplayRoundItem & { full_attempt?: StoredAttempt }>
  retrains: StoredRetrain[]
}

export interface MockDatabaseState {
  current_user_id: string | null
  session_expires_at: string | null
  next_round_seq: number
  next_attempt_seq: number
  next_session_seq: number
  next_course_seq: number
  next_release_seq: number
  next_retrain_seq: number
  next_audit_seq: number
  time_tick: number
  /** 仅用于测试停用/空名单场景的门店成员覆盖，默认空 */
  inactive_user_ids: string[]
  courses: StoredCourse[]
  releases: StoredRelease[]
  assignments: StoredAssignment[]
  audit_events: StoredAuditEvent[]
  idempotency_records: StoredIdempotencyRecord[]
}

/** 仅用于开发调试与自动化测试的下一次故障注入开关 */
let pendingRoundFault: MockFaultMode = null

/** 设置下一次正式轮次提交的模拟故障（消费一次后自动清除） */
export function setMockNextRoundFault(fault: MockFaultMode): void {
  pendingRoundFault = fault
}

/** 读取当前待触发的模拟故障类型 */
export function getMockNextRoundFault(): MockFaultMode {
  return pendingRoundFault
}

function getSafeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage
      : null
  } catch {
    return null
  }
}

function buildInitialMockState(): MockDatabaseState {
  // 陈阿杰预设第 1 轮未过成绩（漏讲「端盒 6 个不重复」）与待补训工单，用于开箱体验补训态
  const chenFirstEval = scoreMockAnswer(CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS.missing)
  const chenAttempt: StoredAttempt = {
    attempt_id: 'att_m1_bj_chenajie_01',
    round_no: 1,
    answer_text: M1_SAMPLE_INPUTS.missing,
    total: chenFirstEval.total,
    passed: chenFirstEval.passed,
    threshold: chenFirstEval.threshold,
    dims: chenFirstEval.dims,
    fact_checks: chenFirstEval.fact_checks,
    missed_required_facts: chenFirstEval.missed_required_facts,
    missed_facts: chenFirstEval.missed_facts,
    redline_hits: chenFirstEval.redline_hits,
    weakest: chenFirstEval.weakest,
    advice: chenFirstEval.advice,
    demo_pitch: chenFirstEval.demo_pitch,
    computed_at: '2026-11-24T10:15:02.000Z',
  }

  return {
    current_user_id: null,
    session_expires_at: null,
    next_round_seq: 10,
    next_attempt_seq: 10,
    next_session_seq: 10,
    next_course_seq: 10,
    next_release_seq: 10,
    next_retrain_seq: 10,
    next_audit_seq: 10,
    time_tick: 1,
    inactive_user_ids: [],
    courses: [
      {
        id: 'crs_thermos',
        sku_code: 'MINISO-THERMOS-01',
        name: THERMOS_COURSE_CONTENT.product.name,
        created_by: 'usr_linmin',
        created_at: '2026-11-24T08:40:00.000Z',
        versions: [
          {
            id: 'crv_thermos_v1',
            course_id: 'crs_thermos',
            version_no: 1,
            status: 'draft',
            revision: 1,
            content: structuredClone(THERMOS_COURSE_CONTENT),
            rubric_version_id: 'rbn_thermos_v1',
            rubric: structuredClone(THERMOS_RUBRIC),
            created_by: 'usr_linmin',
            created_at: '2026-11-24T08:40:00.000Z',
            updated_at: '2026-11-24T08:45:00.000Z',
            reviewed_by: null,
            reviewed_at: null,
          },
        ],
      },
      {
        id: 'crs_chiikawa',
        sku_code: 'MINISO-CHIIKAWA-BOX-01',
        name: CHIIKAWA_COURSE_CONTENT.product.name,
        created_by: 'usr_linmin',
        created_at: '2026-11-23T09:00:00.000Z',
        versions: [
          {
            id: 'crv_chiikawa_v1',
            course_id: 'crs_chiikawa',
            version_no: 1,
            status: 'published',
            revision: 2,
            content: structuredClone(CHIIKAWA_COURSE_CONTENT),
            rubric_version_id: 'rbn_chiikawa_v1',
            rubric: structuredClone(CHIIKAWA_RUBRIC),
            created_by: 'usr_linmin',
            created_at: '2026-11-23T09:00:00.000Z',
            updated_at: MOCK_ANCHOR_T0,
            reviewed_by: { id: 'usr_linmin', name: '林敏' },
            reviewed_at: '2026-11-24T08:30:00.000Z',
          },
        ],
      },
    ],
    releases: [
      {
        id: 'rls_m1_bj',
        course_id: 'crs_chiikawa',
        course_version_id: 'crv_chiikawa_v1',
        rubric_version_id: 'rbn_chiikawa_v1',
        status: 'published',
        deadline_hours: 48,
        deadline_at: MOCK_DEADLINE_T0,
        published_by: { id: 'usr_linmin', name: '林敏' },
        published_at: MOCK_ANCHOR_T0,
        target_store_ids: ['store_bj'],
      },
    ],
    audit_events: [
      {
        id: 'aud_m1_01',
        action: 'course.reviewed',
        entity_type: 'course_version',
        entity_id: 'crv_chiikawa_v1',
        store_id: null,
        actor: { id: 'usr_linmin', name: '林敏' },
        at: '2026-11-24T08:30:00.000Z',
        payload: {
          checklist: {
            price_verified: true,
            spec_verified: true,
            redline_verified: true,
          },
          note: '已核对 59 元零售价、端盒 6 个不重复规则与红线词库',
        },
      },
      {
        id: 'aud_m1_02',
        action: 'release.published',
        entity_type: 'release',
        entity_id: 'rls_m1_bj',
        store_id: 'store_bj',
        actor: { id: 'usr_linmin', name: '林敏' },
        at: MOCK_ANCHOR_T0,
        payload: {
          course_id: 'crs_chiikawa',
          course_version_id: 'crv_chiikawa_v1',
          store_ids: ['store_bj'],
          assigned_total: 3,
          deadline_hours: 48,
        },
      },
      {
        id: 'aud_m1_03',
        action: 'retrain.issued',
        entity_type: 'retrain',
        entity_id: 'rtn_m1_bj_chenajie_01',
        assignment_id: 'asg_m1_bj_chenajie',
        store_id: 'store_bj',
        actor: { id: 'usr_liming', name: '李明' },
        at: '2026-11-24T10:30:00.000Z',
        payload: {
          focus_fact_key: 'fact_box_rule',
          note: '首轮对练漏讲端盒 6 个不重复规则，请重点补练',
        },
      },
    ],
    idempotency_records: [],
    assignments: [
      {
        assignment_id: 'asg_m1_bj_linxiaomei',
        release_id: 'rls_m1_bj',
        store_id: 'store_bj',
        user_id: 'usr_linxiaomei',
        published_at: MOCK_ANCHOR_T0,
        deadline_at: MOCK_DEADLINE_T0,
        status: 'not_started',
        chapter_progress: [],
        last_score: null,
        best_score: null,
        qualified_at: null,
        state_version: 1,
        roleplay_session: null,
        rounds: [],
        retrains: [],
      },
      {
        assignment_id: 'asg_m1_bj_chenajie',
        release_id: 'rls_m1_bj',
        store_id: 'store_bj',
        user_id: 'usr_chenajie',
        published_at: MOCK_ANCHOR_T0,
        deadline_at: MOCK_DEADLINE_T0,
        status: 'retrain_pending',
        chapter_progress: [
          { chapter_key: 'ch1', completed_at: '2026-11-24T09:20:00.000Z' },
          { chapter_key: 'ch2', completed_at: '2026-11-24T09:30:00.000Z' },
          { chapter_key: 'ch3', completed_at: '2026-11-24T09:40:00.000Z' },
        ],
        last_score: chenAttempt.total,
        best_score: chenAttempt.total,
        qualified_at: null,
        state_version: 5,
        roleplay_session: {
          id: 'rps_m1_bj_chenajie',
          assignment_id: 'asg_m1_bj_chenajie',
          last_round_no: 1,
          created_at: '2026-11-24T10:00:00.000Z',
          updated_at: '2026-11-24T10:15:02.000Z',
        },
        rounds: [
          {
            round_no: 1,
            client_round_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
            question_variant: 'default',
            question_text: CHIIKAWA_RUBRIC.scenario.question,
            answer_text: M1_SAMPLE_INPUTS.missing,
            status: 'scored',
            submitted_at: '2026-11-24T10:15:00.000Z',
            scored_at: '2026-11-24T10:15:02.000Z',
            attempt: {
              attempt_id: chenAttempt.attempt_id,
              total: chenAttempt.total,
              passed: chenAttempt.passed,
              missed_required_facts: chenAttempt.missed_required_facts,
              computed_at: chenAttempt.computed_at,
            },
            full_attempt: chenAttempt,
          },
        ],
        retrains: [
          {
            id: 'rtn_m1_bj_chenajie_01',
            status: 'pending',
            focus: {
              fact_key: 'fact_box_rule',
              label: '端盒 6 个不重复',
            },
            note: '首轮对练漏讲端盒 6 个不重复规则，请重点补练',
            baseline_round_no: 1,
            evidence_round_no: null,
            evidence_attempt_id: null,
            issued_by: { id: 'usr_liming', name: '李明' },
            issued_at: '2026-11-24T10:30:00.000Z',
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            version: 1,
          },
        ],
      },
      {
        assignment_id: 'asg_m1_bj_wangxiaoxue',
        release_id: 'rls_m1_bj',
        store_id: 'store_bj',
        user_id: 'usr_wangxiaoxue',
        published_at: MOCK_ANCHOR_T0,
        deadline_at: MOCK_DEADLINE_T0,
        status: 'learning',
        chapter_progress: [
          { chapter_key: 'ch1', completed_at: '2026-11-24T09:25:00.000Z' },
        ],
        last_score: null,
        best_score: null,
        qualified_at: null,
        state_version: 2,
        roleplay_session: null,
        rounds: [],
        retrains: [],
      },
    ],
  }
}

let memoryState: MockDatabaseState | null = null

export function loadState(): MockDatabaseState {
  if (memoryState) return memoryState
  const storage = getSafeStorage()
  if (storage) {
    const raw = storage.getItem(MOCK_STORAGE_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<MockDatabaseState>
        if (
          Array.isArray(parsed.courses) &&
          Array.isArray(parsed.releases) &&
          Array.isArray(parsed.assignments)
        ) {
          memoryState = parsed as MockDatabaseState
          return memoryState
        }
      } catch {
        // 存储损坏时回退为初始基线数据
      }
    }
  }
  memoryState = buildInitialMockState()
  saveState(memoryState)
  return memoryState
}

export function saveState(state: MockDatabaseState): void {
  memoryState = state
  const storage = getSafeStorage()
  if (storage) {
    try {
      storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // 忽略存储配额限制，保留内存状态
    }
  }
}

/** 重置 Mock 数据与故障开关到初始种子基线 */
export function resetMockState(): void {
  pendingRoundFault = null
  const fresh = buildInitialMockState()
  saveState(fresh)
}

/** 仅用于测试：临时设置停用用户列表（如测试空名单发布或离职标注） */
export function setMockInactiveUsers(userIds: string[]): void {
  const state = loadState()
  state.inactive_user_ids = [...userIds]
  saveState(state)
}

export function nextTimestamp(state: MockDatabaseState): string {
  // 在锚点时间之后单调推进毫秒级时间，确保排序和复现稳定
  const baseMs = Date.parse('2026-11-24T11:00:00.000Z')
  const iso = new Date(baseMs + state.time_tick * 1000).toISOString()
  state.time_tick += 1
  return iso
}

function toUserRef(userId: string): UserRef {
  const seed = DEV_USERS.find((item) => item.id === userId)
  if (!seed) {
    throw new MockHttpError(404, 'NOT_FOUND', '用户不存在')
  }
  return {
    id: seed.id,
    name: seed.name,
    role: seed.role,
    stores: seed.stores.map((store) => ({ ...store })),
  }
}

function capabilitiesForRole(role: UserRole): string[] {
  if (role === 'staff') {
    return ['staff.assignment.read', 'staff.progress.write', 'staff.roleplay.submit']
  }
  if (role === 'store_manager') {
    return [
      'manager.release.read',
      'manager.retrain.issue',
      'manager.retrain.review',
      'manager.stats.read',
    ]
  }
  return [
    'hq.course.read',
    'hq.course.write',
    'hq.course.review',
    'hq.course.publish',
    'hq.stats.read',
  ]
}

export function requireCurrentUser(state: MockDatabaseState, expectedRole?: UserRole): UserRef {
  if (!state.current_user_id) {
    throw new MockHttpError(401, 'AUTH_REQUIRED', '请先登录服务端会话')
  }
  if (state.session_expires_at && Date.parse(state.session_expires_at) <= Date.now()) {
    state.current_user_id = null
    state.session_expires_at = null
    saveState(state)
    throw new MockHttpError(401, 'SESSION_EXPIRED', '会话已过期，请重新登录')
  }
  const user = toUserRef(state.current_user_id)
  if (expectedRole && user.role !== expectedRole) {
    throw new MockHttpError(403, 'FORBIDDEN_ROLE', '当前角色无权调用该接口')
  }
  return user
}

export function findOpenRetrain(retrains: StoredRetrain[]): StoredRetrain | null {
  for (let i = retrains.length - 1; i >= 0; i -= 1) {
    const item = retrains[i]
    if (
      item.status === 'pending' ||
      item.status === 'submitted_unfixed' ||
      item.status === 'fixed_pending_review'
    ) {
      return item
    }
  }
  return null
}

export function formatOpenRetrain(retrain: StoredRetrain | null): OpenRetrain | null {
  if (!retrain) return null
  return {
    id: retrain.id,
    status: retrain.status,
    focus: { ...retrain.focus },
    issued_at: retrain.issued_at,
    version: retrain.version,
  }
}

export function resolveReleaseCourseVersion(
  state: MockDatabaseState,
  releaseId: string,
): { course: StoredCourse; version: StoredCourseVersion } {
  const release = state.releases.find((item) => item.id === releaseId)
  if (release) {
    const course = state.courses.find((item) => item.id === release.course_id)
    const version = course?.versions.find((item) => item.id === release.course_version_id)
    if (course && version) {
      return { course, version }
    }
  }
  const fallbackCourse = state.courses[0]
  return { course: fallbackCourse, version: fallbackCourse.versions[0] }
}

/** 按 M1 §5.1 派生学员任务状态（与 backend/app/services/learning.py 一致） */
export function deriveStatus(
  asg: StoredAssignment,
  requiredChapters = CHIIKAWA_COURSE_CONTENT.chapters.length,
): AssignmentStatus {
  const openRetrain = findOpenRetrain(asg.retrains)
  if (openRetrain) {
    if (openRetrain.status === 'pending') return 'retrain_pending'
    if (openRetrain.status === 'submitted_unfixed') return 'retrain_unfixed'
    return 'pending_review'
  }
  if (asg.retrains.length > 0 && asg.retrains[asg.retrains.length - 1].status === 'verified') {
    return 'verified'
  }
  if (asg.qualified_at) return 'passed'
  const hasAttempt = asg.rounds.some((round) => Boolean(round.attempt))
  if (hasAttempt) return 'failed'
  if (requiredChapters > 0 && asg.chapter_progress.length >= requiredChapters) {
    return 'ready_for_roleplay'
  }
  if (asg.chapter_progress.length > 0) return 'learning'
  return 'not_started'
}

export function getStoreName(storeId: string): string {
  return MOCK_STORES.find((store) => store.id === storeId)?.name ?? storeId
}

function getOwnedAssignment(
  state: MockDatabaseState,
  userId: string,
  assignmentId: string,
): StoredAssignment {
  const asg = state.assignments.find(
    (item) => item.assignment_id === assignmentId && item.user_id === userId,
  )
  if (!asg) {
    throw new MockHttpError(404, 'NOT_FOUND', '学习任务不存在')
  }
  return asg
}

function missingChapterKeys(state: MockDatabaseState, asg: StoredAssignment): string[] {
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)
  const completedSet = new Set(asg.chapter_progress.map((item) => item.chapter_key))
  return version.content.chapters.map((ch) => ch.key).filter((key) => !completedSet.has(key))
}

function toSummary(state: MockDatabaseState, asg: StoredAssignment): StaffAssignmentSummary {
  const { course, version } = resolveReleaseCourseVersion(state, asg.release_id)
  const sortedProgress = [...asg.chapter_progress].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at),
  )
  return {
    assignment_id: asg.assignment_id,
    release_id: asg.release_id,
    store: {
      id: asg.store_id,
      name: getStoreName(asg.store_id),
    },
    course: {
      id: course.id,
      name: version.content.product.name,
      tag: version.content.product.tag,
      price: version.content.product.price,
      chapter_count: version.content.chapters.length,
    },
    published_at: asg.published_at,
    deadline_at: asg.deadline_at,
    status: asg.status,
    completed_chapters: sortedProgress.map((item) => item.chapter_key),
    completed_chapter_count: sortedProgress.length,
    required_chapters: version.content.chapters.length,
    last_score: asg.last_score,
    best_score: asg.best_score,
    qualified_at: asg.qualified_at,
    open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
    state_version: asg.state_version,
  }
}

export async function mockDevLogin(userId: string): Promise<DevLoginResponse> {
  const state = loadState()
  const trimmed = String(userId ?? '').trim()
  if (!trimmed) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', 'user_id 不能为空')
  }
  const user = toUserRef(trimmed)
  const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString()
  state.current_user_id = user.id
  state.session_expires_at = expiresAt
  saveState(state)
  return {
    user,
    session: { expires_at: expiresAt },
  }
}

export async function mockLogout(): Promise<void> {
  const state = loadState()
  state.current_user_id = null
  state.session_expires_at = null
  saveState(state)
}

export async function mockFetchMe(): Promise<MeResponse> {
  const state = loadState()
  const user = requireCurrentUser(state)
  return {
    user,
    capabilities: capabilitiesForRole(user.role),
    server_time: new Date().toISOString(),
  }
}

export async function mockListStaffAssignments(): Promise<
  PageResponse<StaffAssignmentSummary>
> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const owned = state.assignments.filter((item) => item.user_id === user.id)
  owned.sort((a, b) => {
    const aOpen = findOpenRetrain(a.retrains) ? 0 : 1
    const bOpen = findOpenRetrain(b.retrains) ? 0 : 1
    if (aOpen !== bOpen) return aOpen - bOpen
    const dCmp = a.deadline_at.localeCompare(b.deadline_at)
    if (dCmp !== 0) return dCmp
    return a.published_at.localeCompare(b.published_at)
  })
  return {
    items: owned.map((item) => toSummary(state, item)),
    next_cursor: null,
  }
}

export async function mockGetStaffAssignment(
  assignmentId: string,
): Promise<StaffAssignmentDetailResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = getOwnedAssignment(state, user.id, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)

  const sortedProgress = [...asg.chapter_progress].sort((a, b) =>
    a.completed_at.localeCompare(b.completed_at),
  )
  const completedChapters = sortedProgress.map((item) => item.chapter_key)
  const chapterCompletedAt: Record<string, string> = {}
  for (const item of sortedProgress) {
    chapterCompletedAt[item.chapter_key] = item.completed_at
  }

  const attempts: StaffAttemptSummary[] = asg.rounds
    .filter((round) => Boolean(round.full_attempt))
    .sort((a, b) => b.round_no - a.round_no)
    .slice(0, 10)
    .map((round) => {
      const full = round.full_attempt!
      return {
        attempt_id: full.attempt_id,
        round_no: round.round_no,
        total: full.total,
        passed: full.passed,
        missed_required_facts: full.missed_required_facts,
        redline_hits: full.redline_hits,
        computed_at: full.computed_at,
      }
    })

  return {
    assignment: {
      assignment_id: asg.assignment_id,
      release_id: asg.release_id,
      status: asg.status,
      completed_chapters: completedChapters,
      required_chapters: version.content.chapters.length,
      last_score: asg.last_score,
      best_score: asg.best_score,
      qualified_at: asg.qualified_at,
      state_version: asg.state_version,
      deadline_at: asg.deadline_at,
    },
    course_version: {
      id: version.id,
      version_no: version.version_no,
      content: structuredClone(version.content),
    },
    progress: {
      completed_chapters: completedChapters,
      chapter_completed_at: chapterCompletedAt,
    },
    attempts,
    open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
    roleplay_session_id: asg.roleplay_session?.id ?? null,
  }
}

export async function mockCompleteChapter(
  assignmentId: string,
  chapterKey: string,
): Promise<ChapterCompleteResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = getOwnedAssignment(state, user.id, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)

  const validKeys = version.content.chapters.map((ch) => ch.key)
  if (!validKeys.includes(chapterKey)) {
    throw new MockHttpError(422, 'UNKNOWN_CHAPTER', '章节键不属于当前课程版本', {
      chapter_key: chapterKey,
    })
  }

  const existing = asg.chapter_progress.find((item) => item.chapter_key === chapterKey)
  if (existing) {
    return {
      chapter_key: chapterKey,
      completed_at: existing.completed_at,
      already_completed: true,
      completed_chapter_count: asg.chapter_progress.length,
      required_chapters: validKeys.length,
      assignment_status: asg.status,
      state_version: asg.state_version,
    }
  }

  const completedAt = nextTimestamp(state)
  asg.chapter_progress.push({ chapter_key: chapterKey, completed_at: completedAt })
  asg.status = deriveStatus(asg, validKeys.length)
  asg.state_version += 1
  saveState(state)

  return {
    chapter_key: chapterKey,
    completed_at: completedAt,
    already_completed: false,
    completed_chapter_count: asg.chapter_progress.length,
    required_chapters: validKeys.length,
    assignment_status: asg.status,
    state_version: asg.state_version,
  }
}

export async function mockCreateOrGetRoleplaySession(
  assignmentId: string,
): Promise<CreateRoleplaySessionResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = getOwnedAssignment(state, user.id, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)

  const missing = missingChapterKeys(state, asg)
  if (missing.length > 0) {
    throw new MockHttpError(
      409,
      'CHAPTERS_INCOMPLETE',
      '请先完成全部课程章节再开始正式对练',
      { missing_chapters: missing },
    )
  }

  if (!asg.roleplay_session) {
    const now = nextTimestamp(state)
    state.next_session_seq += 1
    asg.roleplay_session = {
      id: `rps_mock_${state.next_session_seq}`,
      assignment_id: asg.assignment_id,
      last_round_no: 0,
      created_at: now,
      updated_at: now,
    }
    saveState(state)
  }

  return {
    session: { ...asg.roleplay_session },
    persona: {
      name: version.rubric.scenario.persona_name,
      style: version.rubric.scenario.persona_style,
      question: version.rubric.scenario.question,
      alt_question: version.rubric.scenario.alt_question,
    },
  }
}

export async function mockPreviewRoleplay(
  assignmentId: string,
  body: RoleplayPreviewRequest,
): Promise<RoleplayPreviewResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = getOwnedAssignment(state, user.id, assignmentId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)

  const answerText = String(body.answer_text ?? '').trim()
  if (!answerText) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '话术内容不能为空')
  }
  if (body.question_variant !== 'default' && body.question_variant !== 'alt') {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '问题变体不存在')
  }

  const scored = scoreMockAnswer(version.rubric, answerText)
  return {
    preview: true,
    persisted: false,
    ...scored,
  }
}

function findSessionOwner(
  state: MockDatabaseState,
  userId: string,
  sessionId: string,
): StoredAssignment {
  const asg = state.assignments.find(
    (item) => item.user_id === userId && item.roleplay_session?.id === sessionId,
  )
  if (!asg || !asg.roleplay_session) {
    throw new MockHttpError(404, 'NOT_FOUND', '对练会话不存在')
  }
  return asg
}

export async function mockGetRoleplaySession(
  sessionId: string,
): Promise<RoleplaySessionDetailResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = findSessionOwner(state, user.id, sessionId)

  const rounds: RoleplayRoundItem[] = [...asg.rounds]
    .sort((a, b) => a.round_no - b.round_no)
    .map((item) => {
      const base: RoleplayRoundItem = {
        round_no: item.round_no,
        client_round_id: item.client_round_id,
        question_variant: item.question_variant,
        question_text: item.question_text,
        answer_text: item.answer_text,
        status: item.status,
        submitted_at: item.submitted_at,
        scored_at: item.scored_at,
      }
      if (item.status === 'failed') {
        base.failure_code = item.failure_code ?? 'SCORING_UNAVAILABLE'
      }
      if (item.attempt) {
        base.attempt = { ...item.attempt }
      }
      return base
    })

  return {
    session: { ...asg.roleplay_session! },
    rounds,
  }
}

function resolveQuestionText(rubric: RubricRules, variant: QuestionVariant): string {
  if (variant === 'alt') return rubric.scenario.alt_question
  if (variant === 'default') return rubric.scenario.question
  throw new MockHttpError(422, 'VALIDATION_ERROR', '问题变体不存在')
}

export async function mockSubmitRoleplayRound(
  sessionId: string,
  body: RoleplayRoundRequest,
): Promise<RoleplayRoundSubmitResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'staff')
  const asg = findSessionOwner(state, user.id, sessionId)
  const { version } = resolveReleaseCourseVersion(state, asg.release_id)
  const sessionRef = asg.roleplay_session!

  const missing = missingChapterKeys(state, asg)
  if (missing.length > 0) {
    throw new MockHttpError(
      409,
      'CHAPTERS_INCOMPLETE',
      '请先完成全部课程章节再提交正式对练',
      { missing_chapters: missing },
    )
  }

  const clientRoundId = String(body.client_round_id ?? '').trim().toLowerCase()
  if (!UUID_RE.test(clientRoundId)) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', 'client_round_id 必须是 UUID')
  }
  const answerText = String(body.answer_text ?? '').trim()
  if (!answerText) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '话术内容不能为空')
  }

  let existing = asg.rounds.find((item) => item.client_round_id === clientRoundId)
  if (existing?.full_attempt) {
    // 已评分轮次同键重放：不写新成绩，返回原轮次并标记 replayed=true
    return {
      round: {
        round_no: existing.round_no,
        client_round_id: existing.client_round_id,
        question_variant: existing.question_variant,
        question_text: existing.question_text,
        answer_text: existing.answer_text,
        status: existing.status,
        submitted_at: existing.submitted_at,
        scored_at: existing.scored_at,
      },
      attempt: existing.full_attempt,
      assignment: {
        assignment_id: asg.assignment_id,
        status: asg.status,
        state_version: asg.state_version,
        qualified_at: asg.qualified_at,
      },
      open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
      replayed: true,
    }
  }

  const now = nextTimestamp(state)
  if (!existing) {
    const questionText = resolveQuestionText(version.rubric, body.question_variant)
    sessionRef.last_round_no += 1
    sessionRef.updated_at = now
    existing = {
      round_no: sessionRef.last_round_no,
      client_round_id: clientRoundId,
      question_variant: body.question_variant,
      question_text: questionText,
      answer_text: answerText,
      status: 'scoring',
      submitted_at: now,
      scored_at: null,
    }
    asg.rounds.push(existing)
    saveState(state)
  }

  // 检查是否注入了一次模拟评分故障（用于演示和自动化验证 failed 保留与同键恢复）
  const fault = pendingRoundFault
  if (fault) {
    pendingRoundFault = null
    if (fault === 'SCORING_IN_PROGRESS') {
      existing.status = 'scoring'
      saveState(state)
      throw new MockHttpError(409, 'SCORING_IN_PROGRESS', '该轮次正在评分，请稍后重试', {
        round_no: existing.round_no,
        client_round_id: existing.client_round_id,
        status: 'scoring',
        retry_after_seconds: 3,
      })
    }
    existing.status = 'failed'
    existing.failure_code = fault
    existing.scored_at = now
    saveState(state)
    if (fault === 'SCORING_INVALID_OUTPUT') {
      throw new MockHttpError(
        502,
        'SCORING_INVALID_OUTPUT',
        '评分结果未通过业务核验，轮次已保存，请重试',
        {
          round_no: existing.round_no,
          client_round_id: existing.client_round_id,
          status: 'failed',
        },
      )
    }
    throw new MockHttpError(
      503,
      'SCORING_UNAVAILABLE',
      '评分服务暂时不可用，轮次已保存，请用同一轮次重试',
      {
        round_no: existing.round_no,
        client_round_id: existing.client_round_id,
        status: 'failed',
      },
    )
  }

  // 对已有轮次重试时必须使用服务端已保存的 answer_text，与后端 _prepare_round 一致
  const evalResult = scoreMockAnswer(version.rubric, existing.answer_text)
  state.next_attempt_seq += 1
  const scoredAt = nextTimestamp(state)
  const fullAttempt: StoredAttempt = {
    attempt_id: `att_mock_${state.next_attempt_seq}`,
    round_no: existing.round_no,
    answer_text: existing.answer_text,
    ...evalResult,
    computed_at: scoredAt,
  }

  existing.status = 'scored'
  existing.failure_code = undefined
  existing.scored_at = scoredAt
  existing.attempt = {
    attempt_id: fullAttempt.attempt_id,
    total: fullAttempt.total,
    passed: fullAttempt.passed,
    missed_required_facts: fullAttempt.missed_required_facts,
    computed_at: fullAttempt.computed_at,
  }
  existing.full_attempt = fullAttempt
  sessionRef.updated_at = scoredAt

  asg.last_score = fullAttempt.total
  asg.best_score = Math.max(asg.best_score ?? 0, fullAttempt.total)
  if (fullAttempt.passed && !asg.qualified_at) {
    asg.qualified_at = scoredAt
  }
  asg.state_version += 1

  // 推进进行中的补训工单（仅基线之后的轮次且未冻结前推进）
  const openRetrain = findOpenRetrain(asg.retrains)
  if (
    openRetrain &&
    openRetrain.status !== 'fixed_pending_review' &&
    existing.round_no > openRetrain.baseline_round_no &&
    (openRetrain.evidence_round_no === null ||
      existing.round_no >= openRetrain.evidence_round_no)
  ) {
    if (fullAttempt.passed) {
      openRetrain.status = 'fixed_pending_review'
      openRetrain.evidence_round_no = existing.round_no
      openRetrain.evidence_attempt_id = fullAttempt.attempt_id
    } else {
      openRetrain.status = 'submitted_unfixed'
      openRetrain.evidence_round_no = existing.round_no
      openRetrain.evidence_attempt_id = null
    }
    openRetrain.version += 1
  }

  asg.status = deriveStatus(asg, version.content.chapters.length)
  saveState(state)

  return {
    round: {
      round_no: existing.round_no,
      client_round_id: existing.client_round_id,
      question_variant: existing.question_variant,
      question_text: existing.question_text,
      answer_text: existing.answer_text,
      status: existing.status,
      submitted_at: existing.submitted_at,
      scored_at: existing.scored_at,
    },
    attempt: fullAttempt,
    assignment: {
      assignment_id: asg.assignment_id,
      status: asg.status,
      state_version: asg.state_version,
      qualified_at: asg.qualified_at,
    },
    open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
    replayed: false,
  }
}
