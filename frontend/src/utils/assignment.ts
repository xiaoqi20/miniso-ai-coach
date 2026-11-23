import type { AssignmentStatus, OpenRetrain, UserRole } from '@/types/api'

/**
 * 学员任务状态在 UI 层的统一展示元数据（严格对齐 M1 §5.1 与 §5.5）。
 */
export interface StatusPresentation {
  /** 徽章简短文案 */
  badgeText: string
  /** 徽章语义样式类 */
  badgeTone: 'ok' | 'warn' | 'info'
  /** 主动作按钮文案 */
  ctaLabel: string
  /** 推荐跳转目标：学习详情页或文字对练页 */
  target: 'course' | 'roleplay'
  /** 是否归入已完成态（passed / verified） */
  isCompleted: boolean
  /** 顶部主卡标签描述 */
  tagText: string
}

/**
 * 将服务端派生的 AssignmentStatus 映射为一致的前端文案和路由意图。
 */
export function presentAssignmentStatus(params: {
  status: AssignmentStatus
  completedCount: number
  requiredCount: number
  lastScore: number | null
  bestScore: number | null
  openRetrain: OpenRetrain | null
}): StatusPresentation {
  const { status, completedCount, requiredCount, lastScore, bestScore, openRetrain } = params

  switch (status) {
    case 'retrain_pending':
      return {
        badgeText: '待补练',
        badgeTone: 'warn',
        ctaLabel: '去补练',
        target: 'roleplay',
        isCompleted: false,
        tagText: openRetrain
          ? `店长指派补训 · 考点「${openRetrain.focus.label}」`
          : '店长指派补训',
      }
    case 'retrain_unfixed':
      return {
        badgeText: '复练未改正',
        badgeTone: 'warn',
        ctaLabel: '继续补练',
        target: 'roleplay',
        isCompleted: false,
        tagText: openRetrain
          ? `未改正考点「${openRetrain.focus.label}」· 需继续补练`
          : '复练未改正 · 需继续补练',
      }
    case 'pending_review':
      return {
        badgeText: '已改正待复查',
        badgeTone: 'info',
        ctaLabel: '查看 / 继续练习',
        target: 'roleplay',
        isCompleted: false,
        tagText: '目标考点已改正达标 · 等待店长复查',
      }
    case 'not_started':
      return {
        badgeText: `待学习 0/${requiredCount}`,
        badgeTone: 'warn',
        ctaLabel: '开始学习',
        target: 'course',
        isCompleted: false,
        tagText: '待学习 · 总部新下发课程',
      }
    case 'learning':
      return {
        badgeText: `学习中 ${completedCount}/${requiredCount}`,
        badgeTone: 'warn',
        ctaLabel: '继续学习',
        target: 'course',
        isCompleted: false,
        tagText: `学习中 · 已完成 ${completedCount}/${requiredCount} 节`,
      }
    case 'ready_for_roleplay':
      return {
        badgeText: '待对练',
        badgeTone: 'warn',
        ctaLabel: '去对练',
        target: 'roleplay',
        isCompleted: false,
        tagText: '章节已学完 · 去文字对练通关',
      }
    case 'failed':
      return {
        badgeText: lastScore !== null ? `未通关 ${lastScore} 分` : '未通关',
        badgeTone: 'warn',
        ctaLabel: '去对练',
        target: 'roleplay',
        isCompleted: false,
        tagText: '未通关 · 需补齐必考事实并达到 85 分',
      }
    case 'passed':
      return {
        badgeText: `已通关 ${bestScore ?? lastScore ?? ''} 分`.trim(),
        badgeTone: 'ok',
        ctaLabel: '复习课程',
        target: 'course',
        isCompleted: true,
        tagText: '已完成 · 正式对练已通关',
      }
    case 'verified':
      return {
        badgeText: '复查通过',
        badgeTone: 'ok',
        ctaLabel: '复习课程',
        target: 'course',
        isCompleted: true,
        tagText: '已完成 · 店长已确认复查通过',
      }
  }
}

/**
 * 将 UTC ISO 时间格式化为本地可读时间字符串（仅展示用，统计口径永远由服务端计算）。
 */
export function formatDateTimeLabel(isoString: string | null | undefined): string {
  if (!isoString) return '—'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return isoString
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

/**
 * 格式化截止时间及相对当前客户端时间的剩余提示（纯展示提示，不作为业务判断依据）。
 */
export function formatDeadlineSummary(deadlineIso: string): string {
  const formatted = formatDateTimeLabel(deadlineIso)
  const diffMs = Date.parse(deadlineIso) - Date.now()
  if (Number.isNaN(diffMs)) return formatted
  if (diffMs <= 0) return `${formatted}（已过截止）`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${formatted}（余 ${days} 天 ${hours % 24} 小时）`
  }
  if (hours >= 1) return `${formatted}（余 ${hours} 小时）`
  const mins = Math.max(1, Math.floor(diffMs / 60_000))
  return `${formatted}（余 ${mins} 分钟）`
}

/**
 * 返回各角色的默认首页路径，供登录跳转和越权回退复用。
 */
export function homeRouteForRole(role: UserRole): string {
  if (role === 'staff') return '/staff'
  if (role === 'store_manager') return '/manager'
  return '/hq'
}

/**
 * 返回角色的中文展示名称。
 */
export function roleDisplayName(role: UserRole): string {
  if (role === 'staff') return '门店员工'
  if (role === 'store_manager') return '门店店长'
  return '总部运营'
}

/**
 * 生成用于 client_round_id / Idempotency-Key 的标准 UUID v4 字符串。
 * 优先使用浏览器/Node 原生 crypto.randomUUID，不支持时回退 RFC4122 v4 格式。
 */
export function createClientUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16)
    const val = ch === 'x' ? rand : (rand & 0x3) | 0x8
    return val.toString(16)
  })
}
