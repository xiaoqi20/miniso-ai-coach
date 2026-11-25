import type { HqCourseVersionDetail, RubricFactRule, RubricRules } from '@/types/api'

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

/** 常见规格计量单位同义变体，用于将「数值+单位」绑定为同一条件组并支持口语/缩写 */
const UNIT_SYNONYMS: Record<string, string[]> = {
  厘米: ['厘米', 'cm'],
  cm: ['cm', '厘米'],
  毫米: ['毫米', 'mm'],
  mm: ['mm', '毫米'],
  毫升: ['毫升', 'ml'],
  ml: ['ml', '毫升'],
  千克: ['千克', 'kg'],
  kg: ['kg', '千克'],
  小时: ['小时', 'h'],
  h: ['h', '小时'],
  克: ['克', 'g'],
  g: ['g', '克'],
  米: ['米', 'm'],
  升: ['升', 'l'],
  秒: ['秒'],
  分钟: ['分钟'],
  天: ['天'],
  个: ['个'],
  只: ['只'],
  件: ['件'],
  套: ['套'],
  盒: ['盒'],
  格: ['格'],
}

const LEADING_UNIT_RE = new RegExp(
  `^(${Object.keys(UNIT_SYNONYMS)
    .sort((a, b) => b.length - a.length)
    .map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?![a-z])(.*)$`,
  'i',
)

/** 严格匹配标准零售金额（如 ¥39.00 / 39元 / 39.9 / RMB 79 / 零售价 39 元），拒绝「39 厘米」「79 毫升」等规格或占位文本 */
const VALID_PRICE_RE =
  /^(?:(?:零售价|售价|价格|定价|标价|单价)[:：]?)?(?:[¥￥]|rmb|cny)?(\d+(?:\.\d{1,2})?)(?:元|块|块钱|rmb|cny)?$/i

/** 从短语中提取用于关键词匹配的紧凑词元，去重并过滤单字噪音 */
function extractTokens(text: string): string[] {
  const parts = text
    .split(/[\s,，、。；;！!？?：:（）()「」【】/|+·\-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
  return Array.from(new Set(parts))
}

/** 仅接受标准零售金额文案并提取规范化正数金额，规格文本（如「39 厘米」「79 毫升」）或占位文案返回空串 */
export function extractValidPriceNumber(priceText: string): string {
  const compact = String(priceText ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
  if (!compact) return ''
  const match = compact.match(VALID_PRICE_RE)
  if (!match) return ''
  const num = Number(match[1])
  if (!Number.isFinite(num) || num <= 0) return ''
  return String(num)
}

/**
 * 按语义判断一条必考事实是否仅仅是在重复表达当前售价本身。
 * 严禁用 `includes(priceNum)` 粗暴过滤，避免售价为 39 元时误删「宽度 39 厘米」等含同数字的必考规格。
 */
function isPurePriceFact(label: string, priceNum: string): boolean {
  return Boolean(priceNum) && extractValidPriceNumber(label) === priceNum
}

/**
 * 将单条必考规格事实拆分为分组匹配规则：
 * - 带数值和计量单位的规格（如「宽度 39 厘米」「容量 480ml」「30秒快速出汽」）：将「数值+单位」及其同义缩写绑定在同一条件组
 *   （如 `['39 厘米', '39厘米', '39 cm', '39cm']`），避免拆成独立数字 `['39']` 后被同句售价「39 元」凑齐或被子串误命中。
 * - 纯中文短语（如「透明亚克力材质」）：保留完整短语分组。
 */
function buildGroupsForFactLabel(label: string): string[][] {
  const rawParts = label
    .normalize('NFKC')
    .trim()
    .split(/[\s:：/|+·\-]+/)
    .flatMap((part) => part.split(/(\d+(?:\.\d+)?)/))
    .map((part) => part.trim())
    .filter(Boolean)

  if (rawParts.length <= 1) {
    return [[label.trim()]]
  }

  const groups: string[][] = []
  const seen = new Set<string>()
  const pushGroup = (variants: string[]): void => {
    const deduped = Array.from(new Set(variants.map((v) => v.trim()).filter(Boolean)))
    if (deduped.length === 0) return
    const key = deduped.map((v) => v.toLowerCase()).join('|')
    if (seen.has(key)) return
    seen.add(key)
    groups.push(deduped)
  }

  for (let i = 0; i < rawParts.length; i += 1) {
    const part = rawParts[i]
    const next = rawParts[i + 1]
    if (/^\d+(?:\.\d+)?$/.test(part) && next) {
      const unitMatch = next.match(LEADING_UNIT_RE)
      if (unitMatch) {
        const unit = unitMatch[1]
        const rest = unitMatch[2].trim()
        const unitVariants = UNIT_SYNONYMS[unit.toLowerCase()] ?? [unit]
        const combined = unitVariants.flatMap((u) => [`${part} ${u}`, `${part}${u}`])
        pushGroup(combined)
        i += 1
        if (rest) {
          pushGroup([rest])
        }
        continue
      }
    }
    pushGroup([part])
  }

  return groups.length > 0 ? groups : [[label.trim()]]
}

/**
 * 校验快捷表单是否具备经审校所需的完整内容（用于快捷保存草稿与快捷发布统一门槛）。
 * 因 M1 契约中 rubric_versions 随课程版本创建即冻结不可修改，建课前必须具备完整定价、必考事实与卖点话术。
 */
export function validateQuickCourseInput(input: QuickCourseRubricInput): string[] {
  const issues: string[] = []
  if (!input.name.trim()) {
    issues.push('新品名称')
  }
  if (!extractValidPriceNumber(input.price)) {
    issues.push('有效零售金额（如 ¥39.00、39 元，不得填写规格单位或占位文案）')
  }
  const factItems = input.facts
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (factItems.length === 0) {
    issues.push('必考核对事实点')
  }
  if (!input.desc.trim()) {
    issues.push('标准卖点与话术规范')
  }
  return issues
}

/**
 * 校验课程工作台中的草稿版本是否满足审校与发布门槛（课件内容完整且与绑定评分规则一致）。
 */
export function validateCourseVersionForReview(version: HqCourseVersionDetail): string[] {
  const issues: string[] = []
  const product = version.content?.product
  const chapters = version.content?.chapters ?? []

  if (!product?.name?.trim()) {
    issues.push('缺少商品名称')
  }
  const contentPriceNum = extractValidPriceNumber(product?.price ?? '')
  if (!contentPriceNum) {
    issues.push('零售价格式无效（请填写如 ¥79.00 或 79 元等标准金额，不得填写规格单位或占位文案）')
  }
  if (chapters.length === 0) {
    issues.push('至少需要 1 个授课章节')
  } else if (chapters.some((ch) => !ch.title?.trim() || !ch.speech?.trim())) {
    issues.push('存在章节标题或核心讲解口播为空')
  }

  const rubric = version.rubric
  if (!rubric || !Array.isArray(rubric.required_facts) || rubric.required_facts.length === 0) {
    issues.push('缺少绑定的评分规则或必考事实')
    return issues
  }

  const isPlaceholderOnly =
    rubric.required_facts.length === 1 && rubric.required_facts[0].key === 'fact_product_core'
  if (isPlaceholderOnly) {
    issues.push('当前版本仅绑定了基于商品名生成的占位评分规则，请补全真实定价与必考事实后新建课程版本')
  }

  const priceRule = rubric.required_facts.find((fact) => fact.type === 'price')
  if (!priceRule || priceRule.type !== 'price' || priceRule.patterns.length === 0) {
    issues.push('绑定评分规则缺少价格必考事实（type=price）')
  } else if (contentPriceNum) {
    const matchedPricePattern = priceRule.patterns.some(
      (pattern) => extractValidPriceNumber(pattern) === contentPriceNum,
    )
    if (!matchedPricePattern) {
      issues.push(
        `课件零售价（${product.price}）与绑定评分规则价格（${priceRule.label}）不一致，请保持二者一致后再审校`,
      )
    }
  }

  const escapedPrice = contentPriceNum.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!rubric.demo_pitch?.trim()) {
    issues.push('绑定评分规则缺少金牌示范话术')
  } else if (
    contentPriceNum &&
    !new RegExp(`(?<![0-9.])${escapedPrice}(?![0-9.])`).test(rubric.demo_pitch)
  ) {
    issues.push(`绑定金牌示范话术未包含当前零售价 ${contentPriceNum} 元`)
  }

  return issues
}

function buildRequiredFacts(
  name: string,
  priceNum: string,
  rawFacts: string,
): { rules: RubricFactRule[]; nonPriceFactLabels: string[] } {
  const rules: RubricFactRule[] = []
  const nonPriceFactLabels: string[] = []

  if (priceNum) {
    rules.push({
      key: 'fact_price',
      label: `零售价 ${priceNum} 元`,
      type: 'price',
      patterns: [priceNum],
      negation_guard: true,
    })
  }

  const seenLabels = new Set<string>()
  const customFacts = rawFacts
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false
      if (isPurePriceFact(s, priceNum)) return false
      const norm = s.toLowerCase()
      if (seenLabels.has(norm)) return false
      seenLabels.add(norm)
      return true
    })

  customFacts.forEach((label, idx) => {
    rules.push({
      key: `fact_custom_${idx + 1}`,
      label,
      type: 'groups',
      groups: buildGroupsForFactLabel(label),
    })
    nonPriceFactLabels.push(label)
  })

  // 若既无数字价格也未填自定义事实（仅防御性兜底，审校门槛会拦截此类占位规则）
  if (rules.length === 0) {
    const fallbackAnchor = extractTokens(name)[0] ?? name
    rules.push({
      key: 'fact_product_core',
      label: `${name}核心卖点`,
      type: 'groups',
      groups: [[fallbackAnchor]],
    })
  }

  return { rules, nonPriceFactLabels }
}

/**
 * 完全依据当前新品表单内容生成独立的 M1 评分规则（RubricRules）。
 * 严禁复用或拷贝任何其他示例商品（如保温杯、Chiikawa）的示范话术、关键词与顾客回复。
 */
export function buildCourseRubricFromForm(input: QuickCourseRubricInput): RubricRules {
  const name = input.name.trim()
  const priceText = input.price.trim()
  const priceNum = extractValidPriceNumber(priceText)
  const cross = input.cross.trim()
  const desc = input.desc.trim()

  const { rules: requiredFacts, nonPriceFactLabels } = buildRequiredFacts(
    name,
    priceNum,
    input.facts,
  )

  const nameTokens = extractTokens(name)
  const factTokens = nonPriceFactLabels.flatMap((label) => extractTokens(label))
  const descTokens = extractTokens(desc).slice(0, 4)
  const crossTokens = cross ? extractTokens(cross).slice(0, 4) : []

  const sellingKeywords = Array.from(
    new Set([
      ...nameTokens.slice(0, 3),
      ...factTokens.slice(0, 4),
      ...descTokens,
      '核心卖点',
      '做工',
      '实用',
    ]),
  ).slice(0, 10)

  const objectionKeywords = Array.from(
    new Set(['性价比', '实用', '耐用', '品质', '日常', '省心', '适合', '放心']),
  )

  const crossSellKeywords = Array.from(
    new Set([...crossTokens, '搭配', '加购', '连带', '顺手', '一起', '组合', '推荐']),
  ).slice(0, 8)

  const affinityKeywords = ['您', '放心', '试试', '推荐', '方便', '哦', '可以', '帮您']

  const displayPrice = priceText || (priceNum ? `¥${priceNum}` : '待定')
  const priceClause = priceNum ? `零售价 ${priceNum} 元` : `零售价为 ${displayPrice}`
  // 所有非纯价格必考规格（包括与售价同数字的规格如「宽度 39 厘米」）逐条独立写入示范话术，用逗号分隔避免跨句丢失
  const factsClause =
    nonPriceFactLabels.length > 0 ? `，核心特点包括${nonPriceFactLabels.join('，')}` : ''
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
      question: `这款「${name}」标价 ${displayPrice}，它有什么核心卖点？平时用起来划算吗？`,
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
