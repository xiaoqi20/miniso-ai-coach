import type { RubricFactRule, RubricRules } from '@/types/api'

export interface QuickCourseRubricInput {
  name: string
  price: string
  cross: string
  facts: string
  desc: string
}

/** 全店通用合规红线词库（与具体商品无关，符合 M1 §8.1） */
const COMMON_REDLINES: Array<{ term: string; reason: string }> = [
  { term: '治病', reason: '禁止医疗功效宣称' },
  { term: '疗效', reason: '禁止医疗功效宣称' },
  { term: '杀菌', reason: '非消字号禁止宣称杀菌' },
  { term: '消毒', reason: '非消字号禁止宣称消毒' },
  { term: '绝对不过敏', reason: '禁止绝对化安全承诺' },
  { term: '永久不坏', reason: '禁止绝对化质保承诺' },
  { term: '买一送一', reason: '禁止未经授权的促销承诺' },
  { term: '保真退十', reason: '禁止未经授权的赔付承诺' },
]

/** 从短语中提取用于关键词匹配的紧凑词元，去重并过滤单字噪音 */
function extractTokens(text: string): string[] {
  const parts = text
    .split(/[\s,，、。；;！!？?：:（）()「」【】/|+·\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
  return Array.from(new Set(parts))
}

function normalizePriceNumber(priceText: string): string {
  const match = priceText.match(/\d+(?:\.\d+)?/)
  if (!match) return ''
  return match[0].replace(/\.00$/, '').replace(/\.0$/, '')
}

function buildRequiredFacts(
  name: string,
  priceNum: string,
  rawFacts: string,
): { rules: RubricFactRule[]; factLabels: string[] } {
  const rules: RubricFactRule[] = []
  const factLabels: string[] = []

  if (priceNum) {
    const label = `零售价 ${priceNum} 元`
    rules.push({
      key: 'fact_price',
      label,
      type: 'price',
      patterns: [priceNum],
      negation_guard: true,
    })
    factLabels.push(label)
  }

  const customFacts = rawFacts
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && (!priceNum || !s.includes(priceNum)))
    .slice(0, 4)

  customFacts.forEach((label, idx) => {
    const tokens = extractTokens(label)
    // 每个必考事实按原文词元构成分组，保证示范话术与正确复述可稳定命中
    const anchor = tokens[0] ?? label
    rules.push({
      key: `fact_custom_${idx + 1}`,
      label,
      type: 'groups',
      groups: [[anchor]],
    })
    factLabels.push(label)
  })

  // 若既无数字价格也未填自定义事实，以商品核心名称作为保底必考事实（满足后端 min_length=1）
  if (rules.length === 0) {
    const fallbackAnchor = extractTokens(name)[0] ?? name
    rules.push({
      key: 'fact_product_core',
      label: `${name}核心卖点`,
      type: 'groups',
      groups: [[fallbackAnchor]],
    })
    factLabels.push(name)
  }

  return { rules, factLabels }
}

/**
 * 完全依据当前新品表单内容生成独立的 M1 评分规则（RubricRules）。
 * 严禁复用或拷贝任何其他示例商品（如保温杯、Chiikawa）的示范话术、关键词与顾客回复。
 */
export function buildCourseRubricFromForm(input: QuickCourseRubricInput): RubricRules {
  const name = input.name.trim()
  const priceText = input.price.trim() || '以门店价签为准'
  const priceNum = normalizePriceNumber(priceText)
  const cross = input.cross.trim()
  const desc = input.desc.trim()

  const { rules: requiredFacts, factLabels } = buildRequiredFacts(name, priceNum, input.facts)

  const nameTokens = extractTokens(name)
  const factTokens = factLabels.flatMap((label) => extractTokens(label))
  const descTokens = extractTokens(desc).slice(0, 4)
  const crossTokens = cross ? extractTokens(cross).slice(0, 4) : []

  const sellingKeywords = Array.from(
    new Set([
      ...nameTokens.slice(0, 3),
      ...factTokens.slice(0, 3),
      ...descTokens,
      '核心卖点',
      '做工',
      '实用',
    ]),
  ).slice(0, 8)

  const objectionKeywords = Array.from(
    new Set(['性价比', '实用', '耐用', '品质', '日常', '省心', '适合', '放心']),
  )

  const crossSellKeywords = Array.from(
    new Set([
      ...crossTokens,
      '搭配',
      '加购',
      '连带',
      '顺手',
      '一起',
      '组合',
      '推荐',
    ]),
  ).slice(0, 8)

  const affinityKeywords = ['您', '放心', '试试', '推荐', '方便', '哦', '可以', '帮您']

  const priceClause = priceNum ? `零售价 ${priceNum} 元` : `零售价为 ${priceText}`
  const customFactList = factLabels.filter((label) => !priceNum || !label.includes(priceNum))
  const factsClause =
    customFactList.length > 0 ? `，核心亮点是${customFactList.join('、')}` : ''
  const descClause = desc ? `。${desc.replace(/[。！!]+$/, '')}` : ''
  const crossClause = cross
    ? `结账时还可以顺手搭配「${cross}」一起组合使用，日常更省心方便哦！`
    : '您可以顺手搭配同系列周边一起组合带走，日常使用更省心方便哦！'

  const demoPitch = `您好，推荐您看看这款「${name}」！它${priceClause}${factsClause}${descClause}。这款在性价比和实用做工上都很放心，${crossClause}您放心试试看，我可以帮您挑选！`
  const averagePitch = `这款「${name}」${priceClause}，平时用起来还可以，您喜欢的话可以拿一个试试。`

  return {
    schema_version: 1,
    pass_threshold: 85,
    weights: {
      selling: 0.35,
      objection: 0.3,
      cross_sell: 0.2,
      affinity: 0.15,
    },
    required_facts: requiredFacts,
    dimensions: {
      selling: { label: '卖点准确', keywords: sellingKeywords },
      objection: { label: '异议化解', keywords: objectionKeywords },
      cross_sell: { label: '连带引导', keywords: crossSellKeywords },
      affinity: { label: '服务亲和', keywords: affinityKeywords },
    },
    redlines: COMMON_REDLINES.map((item) => ({ ...item })),
    scenario: {
      persona_name: '门店进店顾客',
      persona_style: 'general',
      question: `这款「${name}」标价 ${priceText}，它有什么核心卖点？平时用起来划算吗？`,
      alt_question: cross
        ? `我想买「${name}」，平时怎么用更方便？和「${cross}」搭配买合适吗？`
        : `我想买「${name}」，它的材质和做工怎么样？有没有什么搭配建议？`,
      happy_reply: cross
        ? `听起来挺实用划算的！那我拿一个「${name}」，顺便也配一个「${cross}」。`
        : `听起来挺实用划算的！那我拿一个「${name}」试试。`,
      concern_reply: '嗯……我再对比看看店里其他款式吧。',
    },
    average_pitch: averagePitch,
    demo_pitch: demoPitch,
  }
}
