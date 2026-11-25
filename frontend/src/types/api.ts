/**
 * M1 身份、业务状态与接口契约 TypeScript 类型定义（v1.0）。
 * 严格保持接口字段 snake_case，Mock 与真实 FastAPI 共用本套类型。
 */

export type UserRole = 'staff' | 'store_manager' | 'hq_ops'
export type StoreRole = 'staff' | 'store_manager'

export type AssignmentStatus =
  | 'not_started'
  | 'learning'
  | 'ready_for_roleplay'
  | 'failed'
  | 'passed'
  | 'retrain_pending'
  | 'retrain_unfixed'
  | 'pending_review'
  | 'verified'

export type RetrainStatus =
  | 'pending'
  | 'submitted_unfixed'
  | 'fixed_pending_review'
  | 'verified'

export type QuestionVariant = 'default' | 'alt'
export type RoundStatus = 'scoring' | 'scored' | 'failed'
export type DimensionKey = 'selling' | 'objection' | 'cross_sell' | 'affinity'

export interface ApiErrorDetailItem {
  loc?: (string | number)[]
  msg?: string
  type?: string
}

export interface ApiErrorEnvelope {
  error: {
    code: string
    message: string
    request_id: string
    details?: Record<string, unknown>
  }
}

export interface StoreRef {
  id: string
  name: string
  role?: StoreRole
}

export interface UserRef {
  id: string
  name: string
  role: UserRole
  stores: StoreRef[]
}

export interface DevLoginRequest {
  user_id: string
}

export interface DevLoginResponse {
  user: UserRef
  session: {
    expires_at: string
  }
}

export interface MeResponse {
  user: UserRef
  capabilities: string[]
  server_time: string
}

export interface PageResponse<T> {
  items: T[]
  next_cursor: string | null
}

export interface CourseProductInfo {
  name: string
  summary: string
  price: string
  tag: string
  icon: string
}

export interface CourseChapter {
  key: string
  short: string
  title: string
  preview: string
  speech: string
  actions: string[]
  mantra: string
}

export interface CourseContent {
  product: CourseProductInfo
  chapters: CourseChapter[]
}

export interface FactRef {
  key: string
  label: string
}

export interface RedlineHit {
  term: string
  reason: string
  evidence: string
}

export interface DimensionScore {
  key: DimensionKey
  name: string
  score: number
}

export interface FactCheckResult {
  key: string
  label: string
  required: boolean
  status: 'hit' | 'missed'
  evidence: string | null
}

export interface OpenRetrain {
  id: string
  status: RetrainStatus
  focus: {
    fact_key: string
    label: string
  }
  issued_at: string
  version: number
}

export interface StaffAssignmentSummary {
  assignment_id: string
  release_id: string
  store: {
    id: string
    name: string
  }
  course: {
    id: string
    name: string
    tag: string | null
    price: string | null
    chapter_count: number
  }
  published_at: string
  deadline_at: string
  status: AssignmentStatus
  completed_chapters: string[]
  completed_chapter_count: number
  required_chapters: number
  last_score: number | null
  best_score: number | null
  qualified_at: string | null
  open_retrain: OpenRetrain | null
  state_version: number
}

export interface StaffAttemptSummary {
  attempt_id: string
  round_no: number
  total: number
  passed: boolean
  missed_required_facts: FactRef[]
  redline_hits: RedlineHit[]
  computed_at: string
}

export interface StaffAssignmentDetailResponse {
  assignment: {
    assignment_id: string
    release_id: string
    status: AssignmentStatus
    completed_chapters: string[]
    required_chapters: number
    last_score: number | null
    best_score: number | null
    qualified_at: string | null
    state_version: number
    deadline_at: string
  }
  course_version: {
    id: string
    version_no: number
    content: CourseContent
  }
  progress: {
    completed_chapters: string[]
    chapter_completed_at: Record<string, string>
  }
  attempts: StaffAttemptSummary[]
  open_retrain: OpenRetrain | null
  roleplay_session_id: string | null
}

export interface ChapterCompleteResponse {
  chapter_key: string
  completed_at: string
  already_completed: boolean
  completed_chapter_count: number
  required_chapters: number
  assignment_status: AssignmentStatus
  state_version: number
}

export interface RoleplaySessionRef {
  id: string
  assignment_id: string
  last_round_no: number
  created_at: string
  updated_at: string
}

export interface CustomerPersona {
  name: string
  style: string
  question: string
  alt_question: string
}

export interface CreateRoleplaySessionResponse {
  session: RoleplaySessionRef
  persona: CustomerPersona
}

export interface RoleplayRoundAttemptBrief {
  attempt_id: string
  total: number
  passed: boolean
  missed_required_facts: FactRef[]
  computed_at: string
}

export interface RoleplayRoundItem {
  round_no: number
  client_round_id: string
  question_variant: QuestionVariant
  question_text: string
  answer_text: string
  status: RoundStatus
  submitted_at: string
  scored_at: string | null
  failure_code?: string | null
  attempt?: RoleplayRoundAttemptBrief
}

export interface RoleplaySessionDetailResponse {
  session: RoleplaySessionRef
  rounds: RoleplayRoundItem[]
}

export interface RoleplayPreviewRequest {
  answer_text: string
  question_variant: QuestionVariant
}

export interface RoleplayPreviewResponse {
  preview: true
  persisted: false
  total: number
  passed: boolean
  threshold: number
  dims: DimensionScore[]
  fact_checks: FactCheckResult[]
  missed_required_facts: FactRef[]
  redline_hits: RedlineHit[]
  weakest: DimensionScore
  advice: string
  demo_pitch: string
}

export interface RoleplayRoundRequest {
  client_round_id: string
  answer_text: string
  question_variant: QuestionVariant
}

export interface RoleplayFullAttempt {
  attempt_id: string
  total: number
  passed: boolean
  threshold: number
  dims: DimensionScore[]
  fact_checks: FactCheckResult[]
  missed_required_facts: FactRef[]
  missed_facts: FactRef[]
  redline_hits: RedlineHit[]
  weakest: DimensionScore
  advice: string
  demo_pitch: string
  computed_at: string
}

export interface RoleplayRoundSubmitResponse {
  round: {
    round_no: number
    client_round_id: string
    question_variant: QuestionVariant
    question_text: string
    answer_text: string
    status: RoundStatus
    submitted_at: string
    scored_at: string | null
  }
  attempt: RoleplayFullAttempt
  assignment: {
    assignment_id: string
    status: AssignmentStatus
    state_version: number
    qualified_at: string | null
  }
  open_retrain: OpenRetrain | null
  replayed: boolean
}

/* ==================== 总部课程、审校、发布与统计契约（M1 §6.5 / §6.8） ==================== */

export type CourseVersionStatus = 'draft' | 'approved' | 'published' | 'superseded'
export type ReleaseStatus = 'published' | 'closed'

export interface UserBrief {
  id: string
  name: string
}

export interface RubricPriceFactRule {
  key: string
  label: string
  type: 'price'
  required?: boolean
  patterns: string[]
  negation_guard?: boolean
}

export interface RubricGroupsFactRule {
  key: string
  label: string
  type: 'groups'
  required?: boolean
  groups: string[][]
}

export type RubricFactRule = RubricPriceFactRule | RubricGroupsFactRule

export interface RubricRules {
  schema_version: number
  pass_threshold: number
  weights: Record<DimensionKey, number>
  required_facts: RubricFactRule[]
  dimensions: Record<DimensionKey, { label: string; keywords: string[] }>
  redlines: Array<{ term: string; reason: string }>
  scenario: {
    persona_name: string
    persona_style: string
    question: string
    alt_question: string
    happy_reply: string
    concern_reply: string
  }
  average_pitch: string
  demo_pitch: string
}

export interface HqCourseVersionSummary {
  id: string
  version_no: number
  status: CourseVersionStatus
  revision: number
  updated_at: string
}

export interface HqCourseListItem {
  course_id: string
  sku_code: string
  name: string
  latest_version: HqCourseVersionSummary | null
  published_release_count: number
}

export interface HqCourseVersionDetail {
  id: string
  version_no: number
  status: CourseVersionStatus
  revision: number
  content: CourseContent
  rubric: RubricRules | null
  reviewed_by: UserBrief | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

export interface HqCourseDetailResponse {
  course: {
    id: string
    sku_code: string
    name: string
  }
  versions: HqCourseVersionDetail[]
}

export interface HqCourseCreateRequest {
  sku_code: string
  name: string
  content: CourseContent
  rubric: RubricRules
}

export interface HqCourseCreateResponse {
  course: {
    id: string
    sku_code: string
    name: string
    created_by: string
    created_at: string
  }
  version: {
    id: string
    course_id: string
    version_no: number
    status: CourseVersionStatus
    revision: number
    created_by: string
    created_at: string
    updated_at: string
  }
  rubric_version: {
    id: string
    course_version_id: string
    version_no: number
    created_at: string
  }
}

export interface HqCourseVersionCloneRequest {
  source_version_id: string
}

export interface HqCourseVersionUpdateRequest {
  expected_revision: number
  content: CourseContent
}

export interface HqReviewChecklist {
  price_verified: boolean
  spec_verified: boolean
  redline_verified: boolean
}

export interface HqCourseReviewRequest {
  checklist: HqReviewChecklist
  note?: string | null
}

export interface HqCourseReviewResponse {
  id: string
  status: CourseVersionStatus
  revision: number
  reviewed_by: UserBrief
  reviewed_at: string
}

export interface HqPublishRequest {
  store_ids: string[]
  deadline_hours: number
  expected_revision: number
}

export interface ReleaseTargetSummary {
  store_id: string
  store_name: string
  assigned_count: number
}

export interface HqPublishReleasePayload {
  id: string
  course_version_id: string
  rubric_version_id: string
  status: ReleaseStatus
  published_by: UserBrief
  published_at: string
  deadline_hours: number
  deadline_at: string
  targets: ReleaseTargetSummary[]
  assigned_total: number
}

export interface HqPublishResponse {
  release: HqPublishReleasePayload
}

export interface HqReleaseDetailResponse {
  release: HqPublishReleasePayload & {
    course: {
      id: string
      name: string
    }
    qualified_in_window: number
    pending_review: number
    open_retrains: number
  }
}

export interface HqReleaseAssigneeItem {
  assignment_id: string
  user: {
    id: string
    name: string
    active: boolean
  }
  store_id: string
  status: AssignmentStatus
  completed_chapter_count: number
  required_chapters: number
  last_score: number | null
  best_score: number | null
  qualified_at: string | null
  open_retrain: OpenRetrain | null
  state_version: number
}

/* ==================== 店长看板、补训与复查契约（M1 §6.7） ==================== */

export interface ManagerReleaseListItem {
  release_id: string
  course: {
    id: string
    name: string
  }
  published_at: string
  deadline_at: string
  stores: string[]
  assigned: number
  qualified_in_window: number
  pending_review: number
  open_retrains: number
}

export interface ManagerReleaseStoreSummary {
  id: string
  name: string
  assigned: number
  qualified_in_window: number
  pending_review: number
  open_retrains: number
}

export interface ManagerReleaseDetailResponse {
  release: {
    id: string
    course: {
      id: string
      name: string
    }
    published_at: string
    deadline_at: string
    stores: ManagerReleaseStoreSummary[]
  }
}

export interface ManagerReleaseAssigneeItem {
  assignment_id: string
  user: {
    id: string
    name: string
    active: boolean
  }
  store_id?: string
  status: AssignmentStatus
  completed_chapter_count: number
  required_chapters?: number
  last_score: number | null
  best_score: number | null
  qualified_at: string | null
  open_retrain: OpenRetrain | null
  state_version: number
}

export interface ManagerAttemptDetail {
  attempt_id: string
  round_no: number
  total: number
  passed: boolean
  answer_text: string
  fact_checks: FactCheckResult[]
  missed_required_facts: FactRef[]
  redline_hits: RedlineHit[]
  computed_at: string
}

export interface ManagerRetrainDetail {
  id: string
  status: RetrainStatus
  focus: {
    fact_key: string
    label: string
  }
  note?: string | null
  baseline_round_no: number
  evidence_round_no: number | null
  evidence_attempt_id: string | null
  evidence_attempt?: ManagerAttemptDetail | null
  issued_by: UserBrief
  issued_at: string
  reviewed_by: UserBrief | null
  reviewed_at: string | null
  review_note?: string | null
  version: number
}

export interface AuditEventItem {
  action: string
  actor: UserBrief
  at: string
  payload: Record<string, unknown>
}

export interface ManagerAssignmentDetailResponse {
  assignment: {
    assignment_id: string
    release_id: string
    store_id: string
    user: {
      id: string
      name: string
      active: boolean
    }
    status: AssignmentStatus
    completed_chapter_count: number
    required_chapters?: number
    last_score: number | null
    best_score: number | null
    first_passed_at: string | null
    qualified_at: string | null
    state_version: number
  }
  attempts: ManagerAttemptDetail[]
  retrains: ManagerRetrainDetail[]
  audit: AuditEventItem[]
}

export interface IssueRetrainRequest {
  focus_fact_key: string
  note: string
}

export interface IssueRetrainResponse {
  retrain: {
    id: string
    status: RetrainStatus
    focus: {
      fact_key: string
      label: string
    }
    baseline_round_no: number
    version: number
    issued_by: UserBrief
    issued_at: string
  }
  assignment: {
    assignment_id: string
    status: AssignmentStatus
    state_version: number
  }
}

export type ReviewRetrainRequest =
  | {
      decision: 'confirm'
      expected_version: number
      evidence_attempt_id: string
      note: string
    }
  | {
      decision: 'reject'
      expected_version: number
      note: string
    }

export interface ReviewRetrainResponse {
  retrain: {
    id: string
    status: RetrainStatus
    evidence_attempt_id: string | null
    baseline_round_no?: number
    reviewed_by: UserBrief
    reviewed_at: string
    version: number
  }
  assignment: {
    assignment_id: string
    status: AssignmentStatus
    qualified_at?: string | null
    state_version: number
  }
}

/* ==================== 48 小时统计契约（M1 §6.8 / §7） ==================== */

export interface StoreWindowStats {
  store_id: string
  store_name: string
  denominator: number
  numerator: number
  qualified_after_window: number
  rate: number | null
  empty_roster: boolean
}

export interface ReleaseStatsResponse {
  release_id: string
  published_at: string
  window_start: string
  window_end: string
  window_hours: number
  window_open: boolean
  computed_at: string
  denominator: number
  numerator: number
  qualified_after_window: number
  rate: number | null
  empty_roster: boolean
  by_store: StoreWindowStats[]
}

/** 带幂等重放标记的客户端封装（仅用于 UI 提示，不改动服务端响应体结构） */
export interface IdempotentResult<T> {
  data: T
  replayed: boolean
}
