import { executeApi, httpRequest } from '@/api/client'
import {
  mockCloneHqCourseVersion,
  mockCreateHqCourse,
  mockGetHqCourseDetail,
  mockGetHqReleaseDetail,
  mockGetHqReleaseStats,
  mockListHqCourses,
  mockListHqReleaseAssignees,
  mockPublishHqCourseVersion,
  mockReviewHqCourseVersion,
  mockUpdateHqCourseVersion,
} from '@/mock/hq'
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

/** 总部：获取全部课程及最新版本摘要（GET /api/v1/hq/courses） */
export function listHqCourses(): Promise<PageResponse<HqCourseListItem>> {
  return executeApi(
    () => httpRequest<PageResponse<HqCourseListItem>>('/hq/courses'),
    () => mockListHqCourses(),
  )
}

/** 总部：新建新品课程、草稿版本与评分规则（POST /api/v1/hq/courses） */
export function createHqCourse(body: HqCourseCreateRequest): Promise<HqCourseCreateResponse> {
  return executeApi(
    () => httpRequest<HqCourseCreateResponse>('/hq/courses', { method: 'POST', body }),
    () => mockCreateHqCourse(body),
  )
}

/** 总部：获取课程详情与全部版本（GET /api/v1/hq/courses/{course_id}） */
export function getHqCourseDetail(courseId: string): Promise<HqCourseDetailResponse> {
  return executeApi(
    () => httpRequest<HqCourseDetailResponse>(`/hq/courses/${encodeURIComponent(courseId)}`),
    () => mockGetHqCourseDetail(courseId),
  )
}

/** 总部：从不可变版本克隆新草稿版本（POST /api/v1/hq/courses/{course_id}/versions） */
export function cloneHqCourseVersion(
  courseId: string,
  body: HqCourseVersionCloneRequest,
): Promise<HqCourseCreateResponse> {
  return executeApi(
    () =>
      httpRequest<HqCourseCreateResponse>(`/hq/courses/${encodeURIComponent(courseId)}/versions`, {
        method: 'POST',
        body,
      }),
    () => mockCloneHqCourseVersion(courseId, body),
  )
}

/** 总部：更新草稿内容（PUT /api/v1/hq/course-versions/{version_id}） */
export function updateHqCourseVersion(
  versionId: string,
  body: HqCourseVersionUpdateRequest,
): Promise<HqCourseVersionSummary> {
  return executeApi(
    () =>
      httpRequest<HqCourseVersionSummary>(
        `/hq/course-versions/${encodeURIComponent(versionId)}`,
        { method: 'PUT', body },
      ),
    () => mockUpdateHqCourseVersion(versionId, body),
  )
}

/** 总部：人工审校通过（POST /api/v1/hq/course-versions/{version_id}/review） */
export function reviewHqCourseVersion(
  versionId: string,
  body: HqCourseReviewRequest,
): Promise<HqCourseReviewResponse> {
  return executeApi(
    () =>
      httpRequest<HqCourseReviewResponse>(
        `/hq/course-versions/${encodeURIComponent(versionId)}/review`,
        { method: 'POST', body },
      ),
    () => mockReviewHqCourseVersion(versionId, body),
  )
}

/** 总部：定向门店发布（POST /api/v1/hq/course-versions/{version_id}/publish，携带 Idempotency-Key） */
export function publishHqCourseVersion(
  versionId: string,
  body: HqPublishRequest,
  idempotencyKey: string,
): Promise<IdempotentResult<HqPublishResponse>> {
  return executeApi(
    async () => {
      let replayed = false
      const data = await httpRequest<HqPublishResponse>(
        `/hq/course-versions/${encodeURIComponent(versionId)}/publish`,
        {
          method: 'POST',
          body,
          headers: { 'Idempotency-Key': idempotencyKey },
          onResponse: (res) => {
            replayed = res.headers.get('Idempotent-Replay') === 'true'
          },
        },
      )
      return { data, replayed }
    },
    () => mockPublishHqCourseVersion(versionId, body, idempotencyKey),
  )
}

/** 总部：获取发布批次详情（GET /api/v1/hq/releases/{release_id}） */
export function getHqReleaseDetail(releaseId: string): Promise<HqReleaseDetailResponse> {
  return executeApi(
    () => httpRequest<HqReleaseDetailResponse>(`/hq/releases/${encodeURIComponent(releaseId)}`),
    () => mockGetHqReleaseDetail(releaseId),
  )
}

/** 总部：获取发布批次应训名单与进度（GET /api/v1/hq/releases/{release_id}/assignees） */
export function listHqReleaseAssignees(
  releaseId: string,
): Promise<PageResponse<HqReleaseAssigneeItem>> {
  return executeApi(
    () =>
      httpRequest<PageResponse<HqReleaseAssigneeItem>>(
        `/hq/releases/${encodeURIComponent(releaseId)}/assignees`,
      ),
    () => mockListHqReleaseAssignees(releaseId),
  )
}

/** 总部：获取发布批次 48 小时统计（GET /api/v1/hq/releases/{release_id}/stats） */
export function getHqReleaseStats(releaseId: string): Promise<ReleaseStatsResponse> {
  return executeApi(
    () =>
      httpRequest<ReleaseStatsResponse>(`/hq/releases/${encodeURIComponent(releaseId)}/stats`),
    () => mockGetHqReleaseStats(releaseId),
  )
}
