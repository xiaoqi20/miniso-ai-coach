import { executeApi, httpRequest } from '@/api/client'
import {
  mockCompleteChapter,
  mockCreateOrGetRoleplaySession,
  mockGetRoleplaySession,
  mockGetStaffAssignment,
  mockListStaffAssignments,
  mockPreviewRoleplay,
  mockSubmitRoleplayRound,
} from '@/mock/server'
import type {
  ChapterCompleteResponse,
  CreateRoleplaySessionResponse,
  PageResponse,
  RoleplayPreviewRequest,
  RoleplayPreviewResponse,
  RoleplayRoundRequest,
  RoleplayRoundSubmitResponse,
  RoleplaySessionDetailResponse,
  StaffAssignmentDetailResponse,
  StaffAssignmentSummary,
} from '@/types/api'

/** 获取当前员工本人应训任务列表（仅已发布给本人的任务） */
export function listStaffAssignments(): Promise<PageResponse<StaffAssignmentSummary>> {
  return executeApi(
    () => httpRequest<PageResponse<StaffAssignmentSummary>>('/staff/assignments'),
    () => mockListStaffAssignments(),
  )
}

/** 获取单条学习任务的课程内容、章节进度、最近正式成绩与补训信息 */
export function getStaffAssignment(
  assignmentId: string,
): Promise<StaffAssignmentDetailResponse> {
  return executeApi(
    () =>
      httpRequest<StaffAssignmentDetailResponse>(
        `/staff/assignments/${encodeURIComponent(assignmentId)}`,
      ),
    () => mockGetStaffAssignment(assignmentId),
  )
}

/** 幂等上报完成某一课程章节 */
export function completeStaffChapter(
  assignmentId: string,
  chapterKey: string,
): Promise<ChapterCompleteResponse> {
  return executeApi(
    () =>
      httpRequest<ChapterCompleteResponse>(
        `/staff/assignments/${encodeURIComponent(assignmentId)}/chapters/${encodeURIComponent(chapterKey)}/complete`,
        {
          method: 'POST',
          body: {},
        },
      ),
    () => mockCompleteChapter(assignmentId, chapterKey),
  )
}

/** 创建或恢复正式对练会话（未学完章节将返回 409 CHAPTERS_INCOMPLETE） */
export function createOrGetRoleplaySession(
  assignmentId: string,
): Promise<CreateRoleplaySessionResponse> {
  return executeApi(
    () =>
      httpRequest<CreateRoleplaySessionResponse>(
        `/staff/assignments/${encodeURIComponent(assignmentId)}/roleplay-sessions`,
        {
          method: 'POST',
        },
      ),
    () => mockCreateOrGetRoleplaySession(assignmentId),
  )
}

/** 演示话术试听评分（不要求学完章节，不落库、不计入正式成绩与统计） */
export function previewRoleplay(
  assignmentId: string,
  body: RoleplayPreviewRequest,
): Promise<RoleplayPreviewResponse> {
  return executeApi(
    () =>
      httpRequest<RoleplayPreviewResponse>(
        `/staff/assignments/${encodeURIComponent(assignmentId)}/roleplay-preview`,
        {
          method: 'POST',
          body,
        },
      ),
    () => mockPreviewRoleplay(assignmentId, body),
  )
}

/** 获取会话详情及全部已保存轮次（用于页面刷新或重启后恢复） */
export function getRoleplaySession(
  sessionId: string,
): Promise<RoleplaySessionDetailResponse> {
  return executeApi(
    () =>
      httpRequest<RoleplaySessionDetailResponse>(
        `/staff/roleplay-sessions/${encodeURIComponent(sessionId)}`,
      ),
    () => mockGetRoleplaySession(sessionId),
  )
}

/** 提交正式文字对练轮次（携带 client_round_id 保证幂等和失败重试不产生重复轮次） */
export function submitRoleplayRound(
  sessionId: string,
  body: RoleplayRoundRequest,
): Promise<RoleplayRoundSubmitResponse> {
  return executeApi(
    () =>
      httpRequest<RoleplayRoundSubmitResponse>(
        `/staff/roleplay-sessions/${encodeURIComponent(sessionId)}/rounds`,
        {
          method: 'POST',
          body,
        },
      ),
    () => mockSubmitRoleplayRound(sessionId, body),
  )
}
