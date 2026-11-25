import type { RubricFactRule, RubricRules } from '@/mock/seed'
import type {
  DimensionKey,
  DimensionScore,
  FactCheckResult,
  FactRef,
  RedlineHit,
} from '@/types/api'

const DIMENSION_ORDER: DimensionKey[] = ['selling', 'objection', 'cross_sell', 'affinity']
const NEGATION_TERMS = ['不是', '并非', '不只', '不止', '别报', '错报成', '不是卖']
const PRICE_SUFFIX = '(?:\\s*(?:元|块|块钱|元左右))?'

export interface MockScoringResult {
  threshold: number
  total: number
  passed: boolean
  dims: DimensionScore[]
  fact_checks: FactCheckResult[]
  missed_required_facts: FactRef[]
  missed_facts: FactRef[]
  redline_hits: RedlineHit[]
  weakest: DimensionScore
  advice: string
  demo_pitch: string
}

export function normalizeText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
}

function casefold(value: string): string {
  return normalizeText(value).toLowerCase()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitClauses(text: string): string[] {
  return text
    .split(/[，。；,;!?！？\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function matchPriceFact(
  text: string,
  patterns: string[],
  negationGuard: boolean,
): { hit: boolean; evidence: string | null } {
  const textCf = text.toLowerCase()
  for (const pattern of patterns) {
    const cleaned = normalizeText(pattern)
    if (!cleaned) continue
    const isNumeric = /^\d+(?:\.\d+)?$/.test(cleaned)
    const escaped = escapeRegex(cleaned)
    const regex = isNumeric
      ? new RegExp(`(?<![0-9.])${escaped}(?![0-9.])${PRICE_SUFFIX}`, 'g')
      : new RegExp(`${escaped}${PRICE_SUFFIX}`, 'g')

    for (const match of textCf.matchAll(regex)) {
      const start = match.index ?? 0
      const before = textCf.slice(Math.max(0, start - 12), start)
      const negated = NEGATION_TERMS.some((term) => before.includes(term))
      if (negationGuard && negated) {
        continue
      }
      return {
        hit: true,
        evidence: text.slice(start, start + match[0].length).trim(),
      }
    }
  }
  return { hit: false, evidence: null }
}

function matchBoundaryToken(textCf: string, rawToken: string): boolean {
  const token = casefold(rawToken)
  if (!token) return false

  const startsWithDigit = /^\d/.test(token)
  const endsWithDigit = /\d$/.test(token)
  const startsWithAsciiLetter = /^[a-z]/.test(token)
  const endsWithAsciiLetter = /[a-z]$/.test(token)

  if (!startsWithDigit && !endsWithDigit && !startsWithAsciiLetter && !endsWithAsciiLetter) {
    return textCf.includes(token)
  }

  const prefix = startsWithDigit ? '(?<![0-9.])' : startsWithAsciiLetter ? '(?<![a-z])' : ''
  const suffix = endsWithDigit ? '(?![0-9.])' : endsWithAsciiLetter ? '(?![a-z])' : ''
  return new RegExp(`${prefix}${escapeRegex(token)}${suffix}`).test(textCf)
}

function matchGroupsFact(
  text: string,
  groups: string[][],
): { hit: boolean; evidence: string | null } {
  for (const clause of splitClauses(text)) {
    const clauseCf = clause.toLowerCase()
    const matched = groups.every((group) =>
      group.some((word) => matchBoundaryToken(clauseCf, word)),
    )
    if (matched) {
      return { hit: true, evidence: clause }
    }
  }
  return { hit: false, evidence: null }
}

function checkFact(fact: RubricFactRule, text: string): FactCheckResult {
  const outcome =
    fact.type === 'price'
      ? matchPriceFact(text, fact.patterns, Boolean(fact.negation_guard))
      : matchGroupsFact(text, fact.groups)

  return {
    key: fact.key,
    label: fact.label,
    required: fact.required ?? true,
    status: outcome.hit ? 'hit' : 'missed',
    evidence: outcome.hit ? outcome.evidence : null,
  }
}

function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5)
}

function clampScore(value: number): number {
  return Math.max(40, Math.min(99, roundHalfUp(value)))
}

function buildAdvice(
  redlineHits: RedlineHit[],
  missed: FactCheckResult[],
  weakest: DimensionScore,
): string {
  if (redlineHits.length > 0) {
    const terms = redlineHits.map((item) => `「${item.term}」`).join('、')
    return `当前话术命中红线${terms}，请立即停止使用并重新学习合规话术。`
  }
  if (missed.length > 0) {
    const labels = missed.map((item) => `「${item.label}」`).join('、')
    return `当前漏讲必考事实${labels}，请补齐后再复练。`
  }
  if (weakest.score < 90) {
    return `当前【${weakest.name}】偏弱（${weakest.score} 分），建议巩固后再复练。`
  }
  return '四维表达均衡，必考价格与核心规则逐项核对通过，达到金牌导购标准。'
}

/**
 * 与后端 roleplay_scoring.py 完全一致的 M1 评分函数（支持 §8.5 四样本精确复现）。
 */
export function scoreMockAnswer(rubric: RubricRules, answerText: string): MockScoringResult {
  const text = normalizeText(answerText)
  const textCf = text.toLowerCase()

  const factChecks = rubric.required_facts.map((fact) => checkFact(fact, text))
  const missedChecks = factChecks.filter((item) => item.status === 'missed')
  const missedRefs: FactRef[] = missedChecks.map((item) => ({
    key: item.key,
    label: item.label,
  }))

  const redlineSeen = new Set<string>()
  const redlineHits: RedlineHit[] = []
  for (const rule of rubric.redlines) {
    if (!rule.term || redlineSeen.has(rule.term)) continue
    if (textCf.includes(casefold(rule.term))) {
      redlineSeen.add(rule.term)
      redlineHits.push({
        term: rule.term,
        reason: rule.reason,
        evidence: rule.term,
      })
    }
  }

  const hitCounts: Record<DimensionKey, number> = {
    selling: 0,
    objection: 0,
    cross_sell: 0,
    affinity: 0,
  }
  for (const key of DIMENSION_ORDER) {
    const keywords = rubric.dimensions[key]?.keywords ?? []
    const matched = new Set(keywords.filter((kw) => matchBoundaryToken(textCf, kw)))
    hitCounts[key] = matched.size
  }

  const redlinePenalty = redlineHits.length > 0 ? 1 : 0
  const missedCount = missedChecks.length
  // 按 Unicode 码点计数，与 Python len() 对齐
  const textLen = Array.from(text).length

  const scores: Record<DimensionKey, number> = {
    selling: clampScore(
      52 + 16 * hitCounts.selling - 10 * missedCount - 30 * redlinePenalty,
    ),
    objection: clampScore(50 + 16 * hitCounts.objection - 15 * redlinePenalty),
    cross_sell: clampScore(48 + 17 * hitCounts.cross_sell),
    affinity: clampScore(58 + 10 * hitCounts.affinity + (textLen >= 24 ? 10 : 0)),
  }

  const total = roundHalfUp(
    DIMENSION_ORDER.reduce((sum, key) => sum + (rubric.weights[key] ?? 0) * scores[key], 0),
  )
  const threshold = rubric.pass_threshold ?? 85
  const passed = total >= threshold && redlineHits.length === 0 && missedChecks.length === 0

  const dims: DimensionScore[] = DIMENSION_ORDER.map((key) => ({
    key,
    name: rubric.dimensions[key]?.label ?? key,
    score: scores[key],
  }))

  let weakest = dims[0]
  for (const dim of dims) {
    if (dim.score < weakest.score) {
      weakest = dim
    }
  }

  return {
    threshold,
    total,
    passed,
    dims,
    fact_checks: factChecks,
    missed_required_facts: missedRefs,
    missed_facts: missedRefs,
    redline_hits: redlineHits,
    weakest,
    advice: buildAdvice(redlineHits, missedChecks, weakest),
    demo_pitch: rubric.demo_pitch,
  }
}
