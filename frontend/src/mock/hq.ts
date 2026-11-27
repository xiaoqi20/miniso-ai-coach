import {
  canonicalFingerprint,
  computeReleaseStats,
  lookupIdempotencyReplay,
  requireIdempotencyKey,
  saveIdempotencyRecord,
} from '@/mock/helpers'
import { DEV_USERS, MOCK_STORES } from '@/mock/seed'
import {
  MockHttpError,
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
  type StoredCourseVersion,
  type StoredRelease,
} from '@/mock/server'
import type {
  HqCourseCreateRequest,
  HqCourseCreateResponse,
  HqCourseDetailResponse,
  HqCourseListItem,
  HqCourseReviewRequest,
  HqCourseReviewResponse,
  HqCourseVersionCloneRequest,
  HqCourseVersionSummary,
  HqCourseVersionUpdateRequest,
  HqPublishRequest,
  HqPublishResponse,
  HqReleaseAssigneeItem,
  HqReleaseDetailResponse,
  IdempotentResult,
  PageResponse,
  ReleaseStatsResponse,
} from '@/types/api'

function findVersion(state: MockDatabaseState, versionId: string) {
  for (const course of state.courses) {
    const version = course.versions.find((item) => item.id === versionId)
    if (version) return { course, version }
  }
  throw new MockHttpError(404, 'NOT_FOUND', '课程版本不存在')
}

export async function mockListHqCourses(): Promise<PageResponse<HqCourseListItem>> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const sorted = [...state.courses].sort((a, b) => {
    const aLatest = a.versions[a.versions.length - 1]?.updated_at ?? a.created_at
    const bLatest = b.versions[b.versions.length - 1]?.updated_at ?? b.created_at
    return bLatest.localeCompare(aLatest) || b.id.localeCompare(a.id)
  })

  return {
    items: sorted.map((course) => {
      const latest = course.versions.reduce<StoredCourseVersion | null>(
        (best, cur) => (!best || cur.version_no > best.version_no ? cur : best),
        null,
      )
      return {
        course_id: course.id,
        sku_code: course.sku_code,
        name: course.name,
        latest_version: latest
          ? {
              id: latest.id,
              version_no: latest.version_no,
              status: latest.status,
              revision: latest.revision,
              updated_at: latest.updated_at,
            }
          : null,
        published_release_count: state.releases.filter((r) => r.course_id === course.id).length,
      }
    }),
    next_cursor: null,
  }
}

export async function mockCreateHqCourse(
  body: HqCourseCreateRequest,
): Promise<HqCourseCreateResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'hq_ops')

  const skuCode = String(body.sku_code ?? '').trim()
  const name = String(body.name ?? '').trim()
  if (!skuCode || !name || !body.content?.product?.name?.trim() || !body.content.chapters?.length) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', 'SKU 编码、课程名称与章节内容不能为空')
  }
  if (state.courses.some((item) => item.sku_code === skuCode)) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', 'sku_code 已存在')
  }

  state.next_course_seq += 1
  const now = nextTimestamp(state)
  const courseId = `crs_mock_${state.next_course_seq}`
  const versionId = `crv_mock_${state.next_course_seq}_v1`
  const rubricId = `rbn_mock_${state.next_course_seq}_v1`

  const version: StoredCourseVersion = {
    id: versionId,
    course_id: courseId,
    version_no: 1,
    status: 'draft',
    revision: 1,
    content: structuredClone(body.content),
    rubric_version_id: rubricId,
    rubric: structuredClone(body.rubric),
    created_by: user.id,
    created_at: now,
    updated_at: now,
    reviewed_by: null,
    reviewed_at: null,
  }

  state.courses.unshift({
    id: courseId,
    sku_code: skuCode,
    name,
    created_by: user.id,
    created_at: now,
    versions: [version],
  })
  saveState(state)

  return {
    course: { id: courseId, sku_code: skuCode, name, created_by: user.id, created_at: now },
    version: {
      id: version.id,
      course_id: version.course_id,
      version_no: version.version_no,
      status: version.status,
      revision: version.revision,
      created_by: version.created_by,
      created_at: version.created_at,
      updated_at: version.updated_at,
    },
    rubric_version: { id: rubricId, course_version_id: version.id, version_no: 1, created_at: now },
  }
}

export async function mockGetHqCourseDetail(courseId: string): Promise<HqCourseDetailResponse> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const course = state.courses.find((item) => item.id === courseId)
  if (!course) throw new MockHttpError(404, 'NOT_FOUND', '课程不存在')

  return {
    course: { id: course.id, sku_code: course.sku_code, name: course.name },
    versions: [...course.versions]
      .sort((a, b) => a.version_no - b.version_no)
      .map((v) => ({
        id: v.id,
        version_no: v.version_no,
        status: v.status,
        revision: v.revision,
        content: structuredClone(v.content),
        rubric: structuredClone(v.rubric),
        reviewed_by: v.reviewed_by ? { ...v.reviewed_by } : null,
        reviewed_at: v.reviewed_at,
        created_at: v.created_at,
        updated_at: v.updated_at,
      })),
  }
}

export async function mockCloneHqCourseVersion(
  courseId: string,
  body: HqCourseVersionCloneRequest,
): Promise<HqCourseCreateResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'hq_ops')

  const course = state.courses.find((item) => item.id === courseId)
  if (!course) throw new MockHttpError(404, 'NOT_FOUND', '课程不存在')
  const source = course.versions.find((item) => item.id === body.source_version_id)
  if (!source) throw new MockHttpError(404, 'NOT_FOUND', '来源版本不存在')
  if (source.status === 'draft') {
    throw new MockHttpError(409, 'STATE_CONFLICT', '草稿版本不能作为克隆来源，请直接修改草稿', {
      current_status: source.status,
    })
  }

  const nextNo = Math.max(...course.versions.map((v) => v.version_no)) + 1
  const now = nextTimestamp(state)
  state.next_course_seq += 1
  const versionId = `crv_${course.id}_v${nextNo}_${state.next_course_seq}`
  const rubricId = `rbn_${course.id}_v${nextNo}_${state.next_course_seq}`

  const cloned: StoredCourseVersion = {
    id: versionId,
    course_id: course.id,
    version_no: nextNo,
    status: 'draft',
    revision: 1,
    content: structuredClone(source.content),
    rubric_version_id: rubricId,
    rubric: structuredClone(source.rubric),
    created_by: user.id,
    created_at: now,
    updated_at: now,
    reviewed_by: null,
    reviewed_at: null,
  }
  course.versions.push(cloned)
  saveState(state)

  return {
    course: {
      id: course.id,
      sku_code: course.sku_code,
      name: course.name,
      created_by: course.created_by,
      created_at: course.created_at,
    },
    version: {
      id: cloned.id,
      course_id: cloned.course_id,
      version_no: cloned.version_no,
      status: cloned.status,
      revision: cloned.revision,
      created_by: cloned.created_by,
      created_at: cloned.created_at,
      updated_at: cloned.updated_at,
    },
    rubric_version: { id: rubricId, course_version_id: cloned.id, version_no: 1, created_at: now },
  }
}

export async function mockUpdateHqCourseVersion(
  versionId: string,
  body: HqCourseVersionUpdateRequest,
): Promise<HqCourseVersionSummary> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const { version } = findVersion(state, versionId)
  if (version.status !== 'draft') {
    throw new MockHttpError(409, 'VERSION_IMMUTABLE', '已审校或已发布版本不可修改')
  }
  if (version.revision !== body.expected_revision) {
    throw new MockHttpError(409, 'VERSION_CONFLICT', '课程草稿已被更新，请刷新后重试', {
      expected_revision: body.expected_revision,
      current_revision: version.revision,
    })
  }
  if (!body.content?.product?.name?.trim() || !body.content.chapters?.length) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '商品名称与章节内容不能为空')
  }

  version.content = structuredClone(body.content)
  version.revision += 1
  version.updated_at = nextTimestamp(state)
  saveState(state)

  return {
    id: version.id,
    version_no: version.version_no,
    status: version.status,
    revision: version.revision,
    updated_at: version.updated_at,
  }
}

export async function mockReviewHqCourseVersion(
  versionId: string,
  body: HqCourseReviewRequest,
): Promise<HqCourseReviewResponse> {
  const state = loadState()
  const user = requireCurrentUser(state, 'hq_ops')
  const { version } = findVersion(state, versionId)

  if (version.status !== 'draft') {
    throw new MockHttpError(409, 'STATE_CONFLICT', '当前状态不允许审校', {
      current_status: version.status,
    })
  }
  const checklist = body.checklist
  const pending: string[] = []
  if (!checklist?.price_verified) pending.push('price_verified')
  if (!checklist?.spec_verified) pending.push('spec_verified')
  if (!checklist?.redline_verified) pending.push('redline_verified')
  if (pending.length > 0) {
    throw new MockHttpError(422, 'REVIEW_CHECKLIST_INCOMPLETE', '审校清单未全部确认', { pending })
  }

  const now = nextTimestamp(state)
  version.status = 'approved'
  version.reviewed_by = { id: user.id, name: user.name }
  version.reviewed_at = now
  version.updated_at = now

  state.next_audit_seq += 1
  state.audit_events.push({
    id: `aud_mock_${state.next_audit_seq}`,
    action: 'course.reviewed',
    entity_type: 'course_version',
    entity_id: version.id,
    store_id: null,
    actor: { id: user.id, name: user.name },
    at: now,
    payload: { checklist: { ...checklist }, note: body.note ?? '' },
  })
  saveState(state)

  return {
    id: version.id,
    status: version.status,
    revision: version.revision,
    reviewed_by: { id: user.id, name: user.name },
    reviewed_at: now,
  }
}

export async function mockPublishHqCourseVersion(
  versionId: string,
  body: HqPublishRequest,
  idempotencyKey?: string,
): Promise<IdempotentResult<HqPublishResponse>> {
  const state = loadState()
  const user = requireCurrentUser(state, 'hq_ops')
  const key = requireIdempotencyKey(idempotencyKey)
  const route = `POST /api/v1/hq/course-versions/${versionId}/publish`
  const fingerprint = canonicalFingerprint(body)

  const replay = lookupIdempotencyReplay<HqPublishResponse>(state, user.id, route, key, fingerprint)
  if (replay) return { data: replay, replayed: true }

  const { course, version } = findVersion(state, versionId)
  if (version.status !== 'approved' && version.status !== 'published') {
    throw new MockHttpError(
      409,
      'STATE_CONFLICT',
      version.status === 'superseded'
        ? '该版本已被新版本替代，不可再次发布'
        : '课程版本尚未审校通过，不能发布',
      { current_status: version.status },
    )
  }
  if (version.revision !== body.expected_revision) {
    throw new MockHttpError(409, 'VERSION_CONFLICT', '课程版本已变更，请刷新后重试', {
      expected_revision: body.expected_revision,
      current_revision: version.revision,
    })
  }
  if (!Array.isArray(body.store_ids) || body.store_ids.length === 0) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '至少选择一个目标门店')
  }
  if (new Set(body.store_ids).size !== body.store_ids.length) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '目标门店不能重复')
  }
  if (
    typeof body.deadline_hours !== 'number' ||
    !Number.isInteger(body.deadline_hours) ||
    body.deadline_hours < 1 ||
    body.deadline_hours > 168
  ) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', '截止时间须为 1 至 168 之间的整数小时')
  }

  const activeStores = new Set(MOCK_STORES.filter((s) => s.active).map((s) => s.id))
  const missingStores = body.store_ids.filter((id) => !activeStores.has(id))
  if (missingStores.length > 0) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', `目标门店不存在或已停用：${missingStores.join('、')}`, {
      fields: [{ loc: ['body', 'store_ids'], msg: '目标门店不存在或已停用', missing: missingStores }],
    })
  }

  const now = nextTimestamp(state)
  const deadlineAt = new Date(Date.parse(now) + body.deadline_hours * 3_600_000).toISOString()
  state.next_release_seq += 1
  const releaseId = `rls_mock_${state.next_release_seq}`
  const inactiveSet = new Set(state.inactive_user_ids)

  const targets = []
  const newAssignments: StoredAssignment[] = []
  for (const storeId of body.store_ids) {
    const storeStaff = DEV_USERS.filter(
      (u) =>
        u.role === 'staff' &&
        !inactiveSet.has(u.id) &&
        u.stores.some((s) => s.id === storeId && s.role === 'staff'),
    )
    targets.push({
      store_id: storeId,
      store_name: getStoreName(storeId),
      assigned_count: storeStaff.length,
    })
    for (const staff of storeStaff) {
      newAssignments.push({
        assignment_id: `asg_${releaseId}_${staff.id}`,
        release_id: releaseId,
        store_id: storeId,
        user_id: staff.id,
        published_at: now,
        deadline_at: deadlineAt,
        status: 'not_started',
        chapter_progress: [],
        last_score: null,
        best_score: null,
        qualified_at: null,
        state_version: 1,
        roleplay_session: null,
        rounds: [],
        retrains: [],
      })
    }
  }

  if (version.status === 'approved') version.status = 'published'
  version.updated_at = now
  for (const sibling of course.versions) {
    if (sibling.id !== version.id && sibling.status === 'published') {
      sibling.status = 'superseded'
      sibling.updated_at = now
    }
  }

  const release: StoredRelease = {
    id: releaseId,
    course_id: course.id,
    course_version_id: version.id,
    rubric_version_id: version.rubric_version_id,
    status: 'published',
    deadline_hours: body.deadline_hours,
    deadline_at: deadlineAt,
    published_by: { id: user.id, name: user.name },
    published_at: now,
    target_store_ids: [...body.store_ids],
  }

  state.releases.unshift(release)
  state.assignments.push(...newAssignments)
  state.next_audit_seq += 1
  state.audit_events.push({
    id: `aud_mock_${state.next_audit_seq}`,
    action: 'release.published',
    entity_type: 'release',
    entity_id: release.id,
    store_id: body.store_ids.length === 1 ? body.store_ids[0] : null,
    actor: { id: user.id, name: user.name },
    at: now,
    payload: {
      course_id: course.id,
      course_version_id: version.id,
      store_ids: [...body.store_ids],
      assigned_total: newAssignments.length,
      deadline_hours: body.deadline_hours,
    },
  })

  const responseBody: HqPublishResponse = {
    release: {
      id: release.id,
      course_version_id: release.course_version_id,
      rubric_version_id: release.rubric_version_id,
      status: release.status,
      published_by: { ...release.published_by },
      published_at: release.published_at,
      deadline_hours: release.deadline_hours,
      deadline_at: release.deadline_at,
      targets,
      assigned_total: newAssignments.length,
    },
  }
  saveIdempotencyRecord(state, user.id, route, key, fingerprint, 201, responseBody)
  saveState(state)

  return { data: responseBody, replayed: false }
}

export async function mockGetHqReleaseDetail(releaseId: string): Promise<HqReleaseDetailResponse> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const release = state.releases.find((item) => item.id === releaseId)
  if (!release) throw new MockHttpError(404, 'NOT_FOUND', '发布批次不存在')

  const { course } = resolveReleaseCourseVersion(state, release.id)
  const releaseAsgs = state.assignments.filter((item) => item.release_id === release.id)
  const stats = computeReleaseStats(state, release)

  return {
    release: {
      id: release.id,
      course: { id: course.id, name: course.name },
      course_version_id: release.course_version_id,
      rubric_version_id: release.rubric_version_id,
      status: release.status,
      published_by: { ...release.published_by },
      published_at: release.published_at,
      deadline_hours: release.deadline_hours,
      deadline_at: release.deadline_at,
      targets: release.target_store_ids.map((storeId) => ({
        store_id: storeId,
        store_name: getStoreName(storeId),
        assigned_count: releaseAsgs.filter((a) => a.store_id === storeId).length,
      })),
      assigned_total: releaseAsgs.length,
      qualified_in_window: stats.numerator,
      pending_review: releaseAsgs.filter((a) => a.status === 'pending_review').length,
      open_retrains: releaseAsgs.filter((a) => Boolean(findOpenRetrain(a.retrains))).length,
    },
  }
}

export async function mockListHqReleaseAssignees(
  releaseId: string,
): Promise<PageResponse<HqReleaseAssigneeItem>> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const release = state.releases.find((item) => item.id === releaseId)
  if (!release) throw new MockHttpError(404, 'NOT_FOUND', '发布批次不存在')

  const { version } = resolveReleaseCourseVersion(state, release.id)
  const requiredChapters = version.content.chapters.length
  const inactiveSet = new Set(state.inactive_user_ids)

  const items: HqReleaseAssigneeItem[] = state.assignments
    .filter((item) => item.release_id === release.id)
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
      required_chapters: requiredChapters,
      last_score: asg.last_score,
      best_score: asg.best_score,
      qualified_at: asg.qualified_at,
      open_retrain: formatOpenRetrain(findOpenRetrain(asg.retrains)),
      state_version: asg.state_version,
    }))
    .sort((a, b) => a.store_id.localeCompare(b.store_id) || a.user.name.localeCompare(b.user.name))

  return { items, next_cursor: null }
}

export async function mockGetHqReleaseStats(releaseId: string): Promise<ReleaseStatsResponse> {
  const state = loadState()
  requireCurrentUser(state, 'hq_ops')

  const release = state.releases.find((item) => item.id === releaseId)
  if (!release) throw new MockHttpError(404, 'NOT_FOUND', '发布批次不存在')
  return computeReleaseStats(state, release)
}
