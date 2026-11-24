import {
  MockHttpError,
  getStoreName,
  type MockDatabaseState,
  type StoredRelease,
} from '@/mock/server'
import type { ReleaseStatsResponse, StoreWindowStats } from '@/types/api'

const WINDOW_HOURS = 48
const WINDOW_MS = WINDOW_HOURS * 3_600_000

/** 规范化请求体指纹，用于检测 Idempotency-Key 是否被复用于不同载荷 */
export function canonicalFingerprint(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return JSON.stringify(payload)
  if (Array.isArray(payload)) return `[${payload.map((i) => canonicalFingerprint(i)).join(',')}]`
  const entries = Object.entries(payload as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return `{${entries
    .map(([key, value]) => `${JSON.stringify(key)}:${canonicalFingerprint(value)}`)
    .join(',')}}`
}

export function requireIdempotencyKey(key: string | undefined): string {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) {
    throw new MockHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少必需的 Idempotency-Key 请求头')
  }
  if (trimmed.length > 64) {
    throw new MockHttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key 长度不得超过 64 字符')
  }
  return trimmed
}

export function lookupIdempotencyReplay<T>(
  state: MockDatabaseState,
  userId: string,
  route: string,
  key: string,
  fingerprint: string,
): T | null {
  const record = state.idempotency_records.find(
    (item) => item.user_id === userId && item.route === route && item.key === key,
  )
  if (!record) return null
  if (record.request_fingerprint !== fingerprint) {
    throw new MockHttpError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      '相同 Idempotency-Key 不得用于不同的请求内容',
    )
  }
  return structuredClone(record.response_body) as T
}

export function saveIdempotencyRecord(
  state: MockDatabaseState,
  userId: string,
  route: string,
  key: string,
  fingerprint: string,
  statusCode: number,
  responseBody: unknown,
): void {
  state.idempotency_records.push({
    user_id: userId,
    route,
    key,
    request_fingerprint: fingerprint,
    status_code: statusCode,
    response_body: structuredClone(responseBody),
  })
}

/** 严格按 M1 §7 计算单个发布批次的 48 小时窗口统计（左闭右开、空名单 rate=null） */
export function computeReleaseStats(
  state: MockDatabaseState,
  release: StoredRelease,
  allowedStoreIds?: Set<string>,
  nowOverrideIso?: string,
): ReleaseStatsResponse {
  const startMs = Date.parse(release.published_at)
  const endMs = startMs + WINDOW_MS
  const windowEnd = new Date(endMs).toISOString()

  const latestQualifiedMs = state.assignments
    .filter((item) => item.release_id === release.id)
    .reduce((maxMs, item) => {
      const qMs = item.qualified_at ? Date.parse(item.qualified_at) : 0
      return Math.max(maxMs, Number.isNaN(qMs) ? 0 : qMs)
    }, startMs)

  const computedMs = nowOverrideIso
    ? Date.parse(nowOverrideIso)
    : Math.max(Date.parse('2026-11-24T11:00:00.000Z') + state.time_tick * 1000, latestQualifiedMs)
  const computedAt = new Date(computedMs).toISOString()
  const windowOpen = computedMs < endMs

  const targetStores = release.target_store_ids.filter(
    (storeId) => !allowedStoreIds || allowedStoreIds.has(storeId),
  )

  const byStore: StoreWindowStats[] = targetStores.map((storeId) => {
    const storeAsgs = state.assignments.filter(
      (item) => item.release_id === release.id && item.store_id === storeId,
    )
    const denominator = storeAsgs.length
    let numerator = 0
    let qualifiedAfterWindow = 0
    for (const asg of storeAsgs) {
      if (!asg.qualified_at) continue
      const qMs = Date.parse(asg.qualified_at)
      if (qMs >= startMs && qMs < endMs) {
        numerator += 1
      } else if (qMs >= endMs && qMs <= computedMs) {
        qualifiedAfterWindow += 1
      }
    }
    const emptyRoster = denominator === 0
    return {
      store_id: storeId,
      store_name: getStoreName(storeId),
      denominator,
      numerator,
      qualified_after_window: qualifiedAfterWindow,
      rate: emptyRoster ? null : Number((numerator / denominator).toFixed(4)),
      empty_roster: emptyRoster,
    }
  })

  const denominator = byStore.reduce((sum, s) => sum + s.denominator, 0)
  const numerator = byStore.reduce((sum, s) => sum + s.numerator, 0)
  const qualifiedAfterWindow = byStore.reduce((sum, s) => sum + s.qualified_after_window, 0)
  const emptyRoster = denominator === 0

  return {
    release_id: release.id,
    published_at: release.published_at,
    window_start: release.published_at,
    window_end: windowEnd,
    window_hours: WINDOW_HOURS,
    window_open: windowOpen,
    computed_at: computedAt,
    denominator,
    numerator,
    qualified_after_window: qualifiedAfterWindow,
    rate: emptyRoster ? null : Number((numerator / denominator).toFixed(4)),
    empty_roster: emptyRoster,
    by_store: byStore,
  }
}
