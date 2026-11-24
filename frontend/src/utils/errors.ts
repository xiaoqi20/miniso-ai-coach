import { ApiClientError } from '@/api/client'

/**
 * 将接口错误转换为面向总部/店长操作者的可理解反馈与恢复引导。
 */
export interface FormattedApiError {
  title: string
  detail: string
  code: string
  requestId: string
  /** 是否建议提示用户刷新服务端最新状态（如版本冲突、状态冲突、证据变化） */
  shouldRefresh: boolean
}

const CHECKLIST_LABELS: Record<string, string> = {
  price_verified: '零售价已核对',
  spec_verified: '规格与购买规则已核对',
  redline_verified: '话术禁用红线已核对',
}

export function formatApiError(err: unknown, fallback = '操作失败，请稍后重试'): FormattedApiError {
  if (!(err instanceof ApiClientError)) {
    return {
      title: fallback,
      detail: err instanceof Error ? err.message : '',
      code: 'UNKNOWN_ERROR',
      requestId: '',
      shouldRefresh: false,
    }
  }

  const details = err.details ?? {}
  switch (err.code) {
    case 'FORBIDDEN_ROLE':
      return {
        title: '权限不足',
        detail: `${err.message}。请确认当前登录角色是否为授权操作账号。`,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    case 'NOT_FOUND':
      return {
        title: '资源不存在或无权访问',
        detail: `${err.message}。如为跨门店任务、未发布草稿或不存在的批次，系统会统一拦截并返回 404。`,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    case 'VERSION_CONFLICT': {
      const expected = details.expected_revision
      const current = details.current_revision
      const revHint =
        typeof expected === 'number' && typeof current === 'number'
          ? `（当前已更新为修订 #${current}，您提交的是 #${expected}）`
          : ''
      return {
        title: '草稿已被其他人更新',
        detail: `${err.message}${revHint}，请先刷新获取最新草稿后再保存或发布。`,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    }
    case 'VERSION_IMMUTABLE':
      return {
        title: '当前版本已冻结不可修改',
        detail: '已审校或已发布的版本不可直接编辑，请点击「复制为新草稿版本」再进行修改。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'STATE_CONFLICT': {
      const currentStatus = details.current_status
      const currentVersion = details.current_version
      const extras: string[] = []
      if (typeof currentStatus === 'string') extras.push(`当前状态：${currentStatus}`)
      if (typeof currentVersion === 'number') extras.push(`最新版本：v${currentVersion}`)
      return {
        title: '状态冲突，操作未生效',
        detail: `${err.message}${extras.length ? `（${extras.join('，')}）` : ''}。请刷新获取最新状态后再操作。`,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    }
    case 'RETRAIN_EXISTS':
      return {
        title: '已有进行中的补训工单',
        detail: '同一学员同一发布批次最多保留一条进行中的补训，请刷新查看当前补训进展。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'NO_ATTEMPT':
      return {
        title: '尚无正式对练成绩',
        detail: '该员工还未完成正式对练评分，暂时无法按漏讲项指派补训。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'EVIDENCE_MISMATCH':
      return {
        title: '复查证据已变更',
        detail: '您看到的复练证据与服务端当前冻结证据不一致，请刷新页面核对最新证据后再确认。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'IDEMPOTENCY_KEY_REUSED':
      return {
        title: '重复提交参数不一致',
        detail: '检测到同一提交键被用于不同的表单内容，已自动拒绝以防误操作。请确认参数后重新提交。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    case 'IDEMPOTENCY_KEY_REQUIRED':
      return {
        title: '缺少防重复提交凭证',
        detail: err.message,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    case 'REVIEW_CHECKLIST_INCOMPLETE': {
      const pending = Array.isArray(details.pending)
        ? details.pending
            .map((key) => CHECKLIST_LABELS[String(key)] ?? String(key))
            .join('、')
        : ''
      return {
        title: '审校清单尚未全部确认',
        detail: pending ? `请先核对并勾选：${pending}。` : err.message,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    }
    case 'AMBIGUOUS_STAFF_STORE': {
      const ids = Array.isArray(details.user_ids) ? details.user_ids.join('、') : ''
      return {
        title: '目标门店存在归属冲突员工',
        detail: ids
          ? `员工 ${ids} 同时属于多个本次选中的目标门店，发布已整体中止，请调整目标门店或先核查成员关系。`
          : err.message,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    }
    case 'FOCUS_NOT_MISSED':
      return {
        title: '所选考点非最近一次漏讲项',
        detail: '补训考点只能从员工最近一次正式对练的漏讲必考事实中选择，请刷新核对最新成绩。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'FOCUS_NOT_FIXED':
      return {
        title: '目标考点尚未改正',
        detail: '当前冻结的复练证据未命中目标补训考点，不能确认通过。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'ATTEMPT_NOT_PASSED':
      return {
        title: '复练成绩未达到整轮通关标准',
        detail: '员工复练必须满足总分 ≥ 85、无红线且全部必考事实命中，方可确认复查通过。',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: true,
      }
    case 'VALIDATION_ERROR':
      return {
        title: '表单校验未通过',
        detail: err.message,
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
    default:
      return {
        title: err.message || fallback,
        detail: err.status ? `服务端返回 HTTP ${err.status}（${err.code}）` : '',
        code: err.code,
        requestId: err.requestId,
        shouldRefresh: false,
      }
  }
}

/** 48 小时通过率格式化：分母为 0 时必须显示「暂无应训人员」，不得显示 0%（M1 §7.3.6） */
export function formatPassRate(rate: number | null, emptyRoster: boolean): string {
  if (emptyRoster || rate === null) return '暂无应训人员'
  return `${(rate * 100).toFixed(1)}%`
}
