import { getApiMode } from '@/api/client'

export interface RecentReleaseRef {
  release_id: string
  course_name: string
  published_at: string
  store_names: string[]
  assigned_total: number
}

const STORAGE_PREFIX = 'shouke_hq_recent_releases_'

function storageKey(): string {
  return `${STORAGE_PREFIX}${getApiMode()}`
}

/**
 * 读取本地记录的最近发布批次引用（因 M1 契约未提供 GET /hq/releases 列表接口，仅作快捷入口）。
 * Mock 模式下若尚无记录，默认提供预置种子批次 rls_m1_bj。
 */
export function loadRecentReleaseRefs(): RecentReleaseRef[] {
  const defaultMock: RecentReleaseRef[] =
    getApiMode() === 'mock'
      ? [
          {
            release_id: 'rls_m1_bj',
            course_name: 'Chiikawa 联名毛绒公仔盲盒',
            published_at: '2026-11-24T09:00:00.000Z',
            store_names: ['北京路旗舰店'],
            assigned_total: 3,
          },
        ]
      : []

  try {
    const raw = window.localStorage.getItem(storageKey())
    if (!raw) return defaultMock
    const parsed = JSON.parse(raw) as RecentReleaseRef[]
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultMock
    return parsed
  } catch {
    return defaultMock
  }
}

/** 记录新发布或已查看的批次引用，按 release_id 去重并置于首位 */
export function saveRecentReleaseRef(item: RecentReleaseRef): RecentReleaseRef[] {
  const current = loadRecentReleaseRefs().filter((ref) => ref.release_id !== item.release_id)
  const next = [item, ...current].slice(0, 12)
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(next))
  } catch {
    // 忽略本地存储配额异常
  }
  return next
}
