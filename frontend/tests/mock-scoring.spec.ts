import { describe, expect, it } from 'vitest'
import { normalizeText, scoreMockAnswer } from '@/mock/scoring'
import { CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS } from '@/mock/seed'

describe('M1 §8.3-8.5 评分规则引擎一致性测试', () => {
  it('样本 1（正确）：金牌示范全文应得 99 分并通过', () => {
    const res = scoreMockAnswer(CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS.correct)
    expect(res.total).toBe(99)
    expect(res.passed).toBe(true)
    expect(res.missed_required_facts).toEqual([])
    expect(res.redline_hits).toEqual([])
    expect(res.dims.map((d) => d.score)).toEqual([99, 98, 99, 98])
  })

  it('样本 2（同义表达）：五十九块钱与端盒六个不重样应得 91 分并通过', () => {
    const res = scoreMockAnswer(CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS.synonym)
    expect(res.total).toBe(91)
    expect(res.passed).toBe(true)
    expect(res.missed_required_facts).toEqual([])
    expect(res.redline_hits).toEqual([])
    expect(res.dims.map((d) => d.score)).toEqual([99, 82, 99, 78])
  })

  it('样本 3（漏讲）：即使总分 99 仍因漏讲端盒规则一票否决不通关', () => {
    const res = scoreMockAnswer(CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS.missing)
    expect(res.total).toBe(99)
    expect(res.passed).toBe(false)
    expect(res.missed_required_facts.map((f) => f.key)).toEqual(['fact_box_rule'])
    expect(res.redline_hits).toEqual([])
    expect(res.dims.map((d) => d.score)).toEqual([99, 98, 99, 99])
  })

  it('样本 4（事实错误 + 红线）：端盒可能重复且买一送一应得 69 分并命中红线', () => {
    const res = scoreMockAnswer(CHIIKAWA_RUBRIC, M1_SAMPLE_INPUTS.factual_error)
    expect(res.total).toBe(69)
    expect(res.passed).toBe(false)
    expect(res.missed_required_facts.map((f) => f.key)).toEqual(['fact_box_rule'])
    expect(res.redline_hits.map((r) => r.term)).toEqual(['买一送一'])
    expect(res.dims.map((d) => d.score)).toEqual([60, 51, 99, 88])
  })

  it('价格否定词防护与 Unicode NFKC / 码点计数一致', () => {
    const negatedOnly = scoreMockAnswer(
      CHIIKAWA_RUBRIC,
      '这款不是 59 元，是正版联名授权，端盒 6 个不重复。',
    )
    const priceFact = negatedOnly.fact_checks.find((f) => f.key === 'fact_price')
    expect(priceFact?.status).toBe('missed')

    // 验证 NFKC 规范化可将全角数字转为半角匹配
    expect(normalizeText('  ５９ 元  ')).toBe('59 元')
    const fullWidthHit = scoreMockAnswer(
      CHIIKAWA_RUBRIC,
      '正版联名授权，零售价５９元，端盒６个不重复。',
    )
    expect(fullWidthHit.fact_checks.every((f) => f.status === 'hit')).toBe(true)
  })

  it('规格分组数字与单位边界匹配：错报尺寸/数量不得通过子串误命中', () => {
    // 端盒 16 个 / 60 个不得通过子串命中端盒 6 个
    const wrongBoxCount = scoreMockAnswer(
      CHIIKAWA_RUBRIC,
      '这款是正版联名授权，59 元一个，端盒 16 个不重复，您摸摸样品，加 9.9 元配防尘挂袋。',
    )
    expect(wrongBoxCount.passed).toBe(false)
    expect(wrongBoxCount.missed_required_facts.map((f) => f.key)).toEqual(['fact_box_rule'])

    const specRubric = {
      ...CHIIKAWA_RUBRIC,
      required_facts: [
        {
          key: 'fact_price',
          label: '零售价 39 元',
          type: 'price' as const,
          patterns: ['39'],
          negation_guard: true,
        },
        {
          key: 'fact_width',
          label: '宽度 39 厘米',
          type: 'groups' as const,
          groups: [['宽度'], ['39 厘米', '39厘米', '39 cm', '39cm']],
        },
      ],
    }

    // 错报 139 厘米、390 厘米、39.5 厘米、甚至同句含 39 元+宽度 139 厘米，均不得命中
    for (const wrongText of [
      '零售价 39 元，宽度 139 厘米，实用好用。',
      '零售价 39 元，宽度139cm，实用好用。',
      '零售价 39 元，宽度 390 厘米，实用好用。',
      '零售价 39 元，宽度 39.5 厘米，实用好用。',
      '这款零售价 39 元的收纳盒宽度 139 厘米，实用好用。',
    ]) {
      const res = scoreMockAnswer(specRubric, wrongText)
      expect(res.missed_required_facts.map((f) => f.key)).toContain('fact_width')
    }

    // 正确表达（39 厘米 / 39厘米 / 39 cm / 39cm）均应命中
    for (const rightText of [
      '零售价 39 元，宽度 39 厘米，实用好用。',
      '零售价 39 元，宽度39厘米，实用好用。',
      '零售价 39 元，宽度 39 cm，实用好用。',
      '零售价 39 元，宽度39cm，实用好用。',
    ]) {
      const res = scoreMockAnswer(specRubric, rightText)
      expect(res.missed_required_facts).toEqual([])
    }
  })
})
