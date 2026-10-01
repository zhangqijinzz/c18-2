import { describe, expect, it } from 'vitest'
import { alignScale, mergeImportedTokens, parseColor, parseTokenImport, previewImportMerge } from '../services/tokenImport'
import { INITIAL_TOKENS, type BrandTokens, type TokenImportParse } from '../models/brandMirrorModels'

const reviewOf = (parsed: TokenImportParse) => {
  expect(parsed.error).toBeNull()
  return parsed as Extract<TokenImportParse, { error: null }>
}

const completeTokens = (): BrandTokens => JSON.parse(JSON.stringify(INITIAL_TOKENS))

describe('parseColor', () => {
  it('normalizes shorthand hex, rgb and alpha hex', () => {
    expect(parseColor('#abc')).toBe('#AABBCC')
    expect(parseColor('#F15A47FF')).toBe('#F15A47')
    expect(parseColor('rgb(241, 90, 71)')).toBe('#F15A47')
    expect(parseColor('rgba(36, 50, 74, 0.5)')).toBe('#24324A')
    expect(parseColor('red')).toBeNull()
  })
})

describe('parseTokenImport — W3C DTCG JSON', () => {
  it('maps $value color tokens and dimension series, padding missing scale levels', () => {
    const file = JSON.stringify({
      color: {
        brand: { primary: { $type: 'color', $value: '#123456' } },
        ink: { secondary: { $type: 'color', $value: '#abcdef' } },
      },
      radius: {
        sm: { $type: 'dimension', $value: '4px' },
        md: { $type: 'dimension', $value: '8px' },
        lg: { $type: 'dimension', $value: '12px' },
      },
    })
    const parsed = reviewOf(parseTokenImport('tokens.json', file))
    const primary = parsed.fields.find((field) => field.key === 'primary')
    const secondary = parsed.fields.find((field) => field.key === 'secondary')
    const radius = parsed.fields.find((field) => field.key === 'radiusScale')
    expect(primary?.matched).toBe(true)
    expect(primary?.values[0]).toBe('#123456')
    expect(secondary?.values[0]).toBe('#ABCDEF')
    expect(radius?.values).toEqual([4, 8, 12, null])
    expect(radius?.issues.some((issue) => issue.message.includes('留空待补'))).toBe(true)
  })

  it('truncates scales that have more levels than the standard', () => {
    const file = JSON.stringify({
      color: { primary: '#111111', secondary: '#222222' },
      typeScale: [12, 14, 16, 20, 28, 40, 56, 72],
      radiusScale: [2, 4, 8, 12],
      spacingScale: [2, 4, 8, 12, 16],
    })
    const parsed = reviewOf(parseTokenImport('tokens.json', file))
    const type = parsed.fields.find((field) => field.key === 'typeScale')
    expect(type?.values).toHaveLength(6)
    expect(type?.values).toEqual([12, 14, 16, 20, 28, 40])
    expect(type?.issues[0].message).toContain('裁剪')
  })

  it('keeps numbered tailwind-style color shades available for color matching instead of treating them as scales', () => {
    const file = JSON.stringify({
      primary: { 100: '#ff0000', 200: '#ee0000', 500: '#F15A47', 600: '#d94838' },
      secondary: '#24324A',
      radius1: 4, radius2: 8, radius3: 12, radius4: 18,
      spacing1: 4, spacing2: 8, spacing3: 12, spacing4: 20, spacing5: 32,
      type1: 12, type2: 14, type3: 16, type4: 20, type5: 28, type6: 40,
    })
    const parsed = reviewOf(parseTokenImport('tokens.json', file))
    const primary = parsed.fields.find((field) => field.key === 'primary')
    expect(primary?.matched).toBe(true)
    expect(typeof primary?.values[0]).toBe('string')
    const radius = parsed.fields.find((field) => field.key === 'radiusScale')
    expect(radius?.values).toEqual([4, 8, 12, 18])
  })

  it('converts rem values at 16px base and reports unrecognized entries', () => {
    const file = JSON.stringify({
      color: { primary: '#000000', secondary: '#ffffff' },
      spacing: { s1: '0.5rem', s2: '1rem', s3: 'auto', s4: '24px', s5: 40 },
      radius: [4, 8, 12, 18],
      type: [12, 14, 16, 20, 28, 40],
    })
    const parsed = reviewOf(parseTokenImport('tokens.json', file))
    const spacing = parsed.fields.find((field) => field.key === 'spacingScale')
    expect(spacing?.values).toEqual([8, 16, null, 24, 40])
    expect(spacing?.issues.some((issue) => issue.message.includes('无法识别'))).toBe(true)
  })

  it('lists unmatched fields and warns about missing mappings', () => {
    const file = JSON.stringify({ color: { primary: '#123456' }, borderRadius: [4, 8, 12, 18], shadow: '0 2px 8px rgba(0,0,0,.1)', fontWeight: { bold: 700 } })
    const parsed = reviewOf(parseTokenImport('tokens.json', file))
    expect(parsed.fields.find((field) => field.key === 'secondary')?.matched).toBe(false)
    expect(parsed.unmapped.some((entry) => entry.path.includes('shadow'))).toBe(true)
    expect(parsed.issues[0].message).toContain('未映射')
  })
})

describe('parseTokenImport — Style Dictionary / flat JSON', () => {
  it('reads { value, type } nodes', () => {
    const file = JSON.stringify({
      color: { primary: { value: '#238B73', type: 'color' }, secondary: { value: '#173C35', type: 'color' } },
      radius: { 1: { value: '6px' }, 2: { value: '10px' }, 3: { value: '14px' }, 4: { value: '22px' } },
      spacing: { 1: { value: 4 }, 2: { value: 8 }, 3: { value: 12 }, 4: { value: 18 }, 5: { value: 28 } },
      font: { size: { 1: { value: 12 }, 2: { value: 14 }, 3: { value: 16 }, 4: { value: 20 }, 5: { value: 28 }, 6: { value: 38 } } },
    })
    const parsed = reviewOf(parseTokenImport('style-dictionary.json', file))
    expect(parsed.fields.filter((field) => field.matched)).toHaveLength(5)
    expect(parsed.fields.find((field) => field.key === 'typeScale')?.values).toEqual([12, 14, 16, 20, 28, 38])
  })
})

describe('parseTokenImport — CSV / TSV', () => {
  it('parses path/value rows including a header', () => {
    const csv = ['name,value', 'color.primary,#123456', 'color.secondary,#654321', 'radius.1,4', 'radius.2,8', 'radius.3,12', 'radius.4,18', 'spacing.1,4', 'spacing.2,8', 'spacing.3,12', 'spacing.4,20', 'spacing.5,32', 'type.1,12', 'type.2,14', 'type.3,16', 'type.4,20', 'type.5,28', 'type.6,40'].join('\n')
    const parsed = reviewOf(parseTokenImport('tokens.csv', csv))
    expect(parsed.fields.filter((field) => field.matched)).toHaveLength(5)
    expect(parsed.fields.find((field) => field.key === 'primary')?.values[0]).toBe('#123456')
  })

  it('returns a readable error for broken JSON or empty files', () => {
    expect(parseTokenImport('bad.json', '{ not json').error).toContain('JSON 解析失败')
    expect(parseTokenImport('empty.json', '   ').error).toContain('为空')
  })
})

describe('alignScale', () => {
  it('pads and truncates to the standard length', () => {
    expect(alignScale('radiusScale', [2, 4]).values).toEqual([2, 4, null, null])
    expect(alignScale('spacingScale', [1, 2, 3, 4, 5, 6, 7]).values).toEqual([1, 2, 3, 4, 5])
  })
})

describe('import merge strategies', () => {
  const buildFields = (fileName: string, file: string) => reviewOf(parseTokenImport(fileName, file)).fields

  it('overwrite replaces every mapped value', () => {
    const file = JSON.stringify({ color: { primary: '#123456', secondary: '#654321' }, radius: [2, 4, 6, 8], spacing: [4, 8, 12, 20, 32], type: [12, 14, 16, 20, 28, 40] })
    const merged = mergeImportedTokens(completeTokens(), buildFields('t.json', file), 'overwrite')
    expect(merged.primary).toBe('#123456')
    expect(merged.radiusScale).toEqual([2, 4, 6, 8])
  })

  it('fillEmpty only fills null slots and keeps existing local values', () => {
    const local: BrandTokens = { ...completeTokens(), primary: null, radiusScale: [null, 12, null, 28] }
    const file = JSON.stringify({ color: { primary: '#123456', secondary: '#654321' }, radius: [2, 4, 6, 8], spacing: [4, 8, 12, 20, 32], type: [12, 14, 16, 20, 28, 40] })
    const merged = mergeImportedTokens(local, buildFields('t.json', file), 'fillEmpty')
    expect(merged.primary).toBe('#123456')
    expect(merged.secondary).toBe(INITIAL_TOKENS.secondary)
    expect(merged.radiusScale).toEqual([2, 12, 6, 28])
  })

  it('keepLocal skips an entire field when the field has any local value', () => {
    const local: BrandTokens = { ...completeTokens(), radiusScale: [null, 12, null, 28], spacingScale: [null, null, null, null, null] }
    const file = JSON.stringify({ color: { primary: '#123456', secondary: '#654321' }, radius: [2, 4, 6, 8], spacing: [4, 8, 12, 20, 32], type: [12, 14, 16, 20, 28, 40] })
    const merged = mergeImportedTokens(local, buildFields('t.json', file), 'keepLocal')
    // 圆角字段本地已有值，整段保留（包括本地的空槽位）
    expect(merged.radiusScale).toEqual([null, 12, null, 28])
    // 间距字段整段为空，从文件整段导入
    expect(merged.spacingScale).toEqual([4, 8, 12, 20, 32])
    // 颜色字段本地已有值，整段保留
    expect(merged.primary).toBe(INITIAL_TOKENS.primary)
  })

  it('overwrite clears local slots that the source leaves empty after alignment, but keeps unmatched fields', () => {
    const local: BrandTokens = { ...completeTokens(), radiusScale: [2, 4, 8, 12] }
    const file = JSON.stringify({ color: { primary: '#123456' }, type: [12, 14], radius: [2, 4, 8, 12], spacing: [4, 8, 12, 20, 32] })
    const fields = buildFields('t.json', file)
    const merged = mergeImportedTokens(local, fields, 'overwrite')
    // 字体只给了 2 层，覆盖后尾部 4 层被清空（而非保留旧值）
    expect(merged.typeScale).toEqual([12, 14, null, null, null, null])
    // secondary 未出现在文件中，保留本地
    expect(merged.secondary).toBe(INITIAL_TOKENS.secondary)
  })

  it('keeps local values when the source file lacks a field in every mode', () => {
    const local = completeTokens()
    const file = JSON.stringify({ color: { primary: '#123456' }, radius: [2, 4, 6, 8] })
    const fields = buildFields('t.json', file)
    const summary = previewImportMerge(local, fields, 'overwrite')
    const secondaryEntry = summary.entries.find((entry) => entry.key === 'secondary')
    expect(secondaryEntry?.action).toBe('keep')
    expect(secondaryEntry?.result).toBe(local.secondary)
  })
})
