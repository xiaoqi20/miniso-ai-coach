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

interface TokenSpan {
  start: number
  end: number
}

const FIELD_VALUE_CONNECTOR_RE =
  /^[\s:：=＝~～]*(?:(?:大约|大概|差不多|足足|整整|刚好|正好|约莫|一共|总共|仅)?(?:为|是|有|在|约|约为|约有|达|达到|做到|做到了|接近|近|重约|长达|宽达|高达|厚达|深达|仅重)?)[\s:：=＝~～]*$/
const REVERSE_VALUE_FIELD_RE = /^[\s的]*$/
const LEADING_OWN_ASSIGN_RE = /(?:为|是|有|:|：|=|＝)\s*$/
const TRAILING_OWN_VALUE_RE =
  /^[\s:：=＝~～]*(?:(?:大约|大概|差不多|足足|整整|刚好|正好|约莫|一共|总共|仅)?(?:为|是|有|在|约|约为|约有|达|达到|做到|做到了|接近|近|重约|长达|宽达|高达|厚达|深达|仅重)?)[\s:：=＝~～]*\d/

function buildBoundaryTokenRegex(rawToken: string): RegExp | null {
  const token = casefold(rawToken)
  if (!token) return null

  const startsWithDigit = /^\d/.test(token)
  const endsWithDigit = /\d$/.test(token)
  const startsWithAsciiLetter = /^[a-z]/.test(token)
  const endsWithAsciiLetter = /[a-z]$/.test(token)

  const prefix = startsWithDigit ? '(?<![0-9.])' : startsWithAsciiLetter ? '(?<![a-z])' : ''
  const suffix = endsWithDigit ? '(?![0-9.])' : endsWithAsciiLetter ? '(?![a-z])' : ''
  return new RegExp(`${prefix}${escapeRegex(token)}${suffix}`, 'g')
}

function findBoundaryTokenSpans(textCf: string, rawToken: string): TokenSpan[] {
  const regex = buildBoundaryTokenRegex(rawToken)
  if (!regex) return []
  const spans: TokenSpan[] = []
  for (const match of textCf.matchAll(regex)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length })
  }
  return spans
}

function matchBoundaryToken(textCf: string, rawToken: string): boolean {
  const regex = buildBoundaryTokenRegex(rawToken)
  return regex ? regex.test(textCf) : false
}

function isTextFieldGroup(group: string[]): boolean {
  const tokens = group.map((word) => casefold(word)).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => !/^\d/.test(token))
}

function isMeasurementGroup(group: string[]): boolean {
  const tokens = group.map((word) => casefold(word)).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => /^\d+(?:\.\d+)?(?:\s*\S+)?$/.test(token))
}

function isBoundFieldMeasurement(
  clauseCf: string,
  fieldSpan: TokenSpan,
  measureSpan: TokenSpan,
): boolean {
  // 正向绑定：如「宽度 39 厘米」「宽度为 39 厘米」「宽度约 39 cm」「宽度：39cm」
  if (fieldSpan.end <= measureSpan.start) {
    const between = clauseCf.slice(fieldSpan.end, measureSpan.start)
    return FIELD_VALUE_CONNECTOR_RE.test(between)
  }
  // 倒装绑定：如「39 厘米宽度」「39 厘米的宽度」，排除前属其他字段赋值或字段后自有其他数值的情况
  if (measureSpan.end <= fieldSpan.start) {
    const between = clauseCf.slice(measureSpan.end, fieldSpan.start)
    if (!REVERSE_VALUE_FIELD_RE.test(between)) return false
    const beforeMeasure = clauseCf.slice(0, measureSpan.start)
    if (LEADING_OWN_ASSIGN_RE.test(beforeMeasure)) return false
    const afterField = clauseCf.slice(fieldSpan.end)
    if (TRAILING_OWN_VALUE_RE.test(afterField)) return false
    return true
  }
  return false
}

function matchGroupsFact(
  text: string,
  groups: string[][],
): { hit: boolean; evidence: string | null } {
  for (const clause of splitClauses(text)) {
    const clauseCf = clause.toLowerCase()
    const groupSpans = groups.map((group) =>
      group.flatMap((word) => findBoundaryTokenSpans(clauseCf, word)),
    )
    if (groupSpans.some((spans) => spans.length === 0)) {
      continue
    }

    // 相邻的「文本字段组 + 测量值组」必须在当前子句中存在直接对应关系，防止「宽度为 139 厘米和高度为 39 厘米」串用数值
    let bindingOk = true
    for (let i = 0; i < groups.length - 1; i += 1) {
      if (isTextFieldGroup(groups[i]) && isMeasurementGroup(groups[i + 1])) {
        const hasBoundPair = groupSpans[i].some((fieldSpan) =>
          groupSpans[i + 1].some((measureSpan) =>
            isBoundFieldMeasurement(clauseCf, fieldSpan, measureSpan),
          ),
        )
        if (!hasBoundPair) {
          bindingOk = false
          break
        }
      }
    }

    if (bindingOk) {
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
