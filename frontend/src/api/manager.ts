import { executeApi, httpRequest } from '@/api/client'
import {
  mockGetManagerAssignmentDetail,
  mockGetManagerReleaseDetail,
  mockGetManagerReleaseStats,
  mockIssueManagerRetrain,
  mockListManagerReleaseAssignees,
  mockListManagerReleases,
  mockReviewManagerRetrain,
} from '@/mock/manager'
import type {
  IdempotentResult,
  IssueRetrainRequest,
  IssueRetrainResponse,
  ManagerAssignmentDetailResponse,
  ManagerReleaseAssigneeItem,
  ManagerReleaseDetailResponse,
  ManagerReleaseListItem,
  PageResponse,
  ReleaseStatsResponse,
  ReviewRetrainRequest,
  ReviewRetrainResponse,
} from '@/types/api'

/** 店长：获取管辖门店的发布批次列表（GET /api/v1/manager/releases） */
export function listManagerReleases(): Promise<PageResponse<ManagerReleaseListItem>> {
  return executeApi(
    () => httpRequest<PageResponse<ManagerReleaseListItem>>('/manager/releases'),
    () => mockListManagerReleases(),
  )
}

/** 店长：获取单个发布批次概览（GET /api/v1/manager/releases/{release_id}） */
export function getManagerReleaseDetail(releaseId: string): Promise<ManagerReleaseDetailResponse> {
  return executeApi(
    () =>
      httpRequest<ManagerReleaseDetailResponse>(
        `/manager/releases/${encodeURIComponent(releaseId)}`,
      ),
    () => mockGetManagerReleaseDetail(releaseId),
  )
}

/** 店长：获取本店应训名单与状态（GET /api/v1/manager/releases/{release_id}/assignees） */
export function listManagerReleaseAssignees(
  releaseId: string,
): Promise<PageResponse<ManagerReleaseAssigneeItem>> {
  return executeApi(
    () =>
      httpRequest<PageResponse<ManagerReleaseAssigneeItem>>(
        `/manager/releases/${encodeURIComponent(releaseId)}/assignees`,
      ),
    () => mockListManagerReleaseAssignees(releaseId),
  )
}

/** 店长：获取店员成绩、复练证据、补训与审计详情（GET /api/v1/manager/assignments/{assignment_id}） */
export function getManagerAssignmentDetail(
  assignmentId: string,
): Promise<ManagerAssignmentDetailResponse> {
  return executeApi(
    () =>
      httpRequest<ManagerAssignmentDetailResponse>(
        `/manager/assignments/${encodeURIComponent(assignmentId)}`,
      ),
    () => mockGetManagerAssignmentDetail(assignmentId),
  )
}

/** 店长：按最近成绩漏讲项指派补训（POST /api/v1/manager/assignments/{assignment_id}/retrains） */
export function issueManagerRetrain(
  assignmentId: string,
  body: IssueRetrainRequest,
  idempotencyKey: string,
): Promise<IdempotentResult<IssueRetrainResponse>> {
  return executeApi(
    async () => {
      let replayed = false
      const data = await httpRequest<IssueRetrainResponse>(
        `/manager/assignments/${encodeURIComponent(assignmentId)}/retrains`,
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
    () => mockIssueManagerRetrain(assignmentId, body, idempotencyKey),
  )
}

/** 店长：确认或驳回待复查补训（POST /api/v1/manager/retrains/{retrain_id}/review） */
export function reviewManagerRetrain(
  retrainId: string,
  body: ReviewRetrainRequest,
  idempotencyKey: string,
): Promise<IdempotentResult<ReviewRetrainResponse>> {
  return executeApi(
    async () => {
      let replayed = false
      const data = await httpRequest<ReviewRetrainResponse>(
        `/manager/retrains/${encodeURIComponent(retrainId)}/review`,
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
    () => mockReviewManagerRetrain(retrainId, body, idempotencyKey),
  )
}

/** 店长：获取本店 48 小时统计（GET /api/v1/manager/releases/{release_id}/stats） */
export function getManagerReleaseStats(releaseId: string): Promise<ReleaseStatsResponse> {
  return executeApi(
    () =>
      httpRequest<ReleaseStatsResponse>(
        `/manager/releases/${encodeURIComponent(releaseId)}/stats`,
      ),
    () => mockGetManagerReleaseStats(releaseId),
  )
}
