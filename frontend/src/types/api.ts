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
