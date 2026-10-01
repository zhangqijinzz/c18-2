import type { BrandTheme, BrandTokens, ScaleField } from '../models/brandMirrorModels'
import { INITIAL_TOKENS, SCALE_LENGTHS, THEME_PRESETS } from '../models/brandMirrorModels'

const HEX_COLOR = /^#[0-9A-F]{6}$/i

export function cloneTokens(tokens: BrandTokens): BrandTokens {
  return { ...tokens, radiusScale: [...tokens.radiusScale], spacingScale: [...tokens.spacingScale], typeScale: [...tokens.typeScale] }
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** 输入不合法时返回 fallback（默认回到主色起点），编辑器清空时由调用方传入当前值 */
export function normalizeColor(value: string, fallback: string | null = INITIAL_TOKENS.primary): string {
  const candidate = value.trim().toUpperCase()
  return isHexColor(candidate) ? candidate : fallback ?? INITIAL_TOKENS.primary
}

const SCALE_LIMITS: Record<ScaleField, { min: number; max: number }> = {
  radiusScale: { min: 0, max: 40 },
  spacingScale: { min: 2, max: 64 },
  typeScale: { min: 10, max: 72 },
}

function clampScaleValue(field: ScaleField, value: number): number {
  const { min, max } = SCALE_LIMITS[field]
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampTokenValues(tokens: BrandTokens): BrandTokens {
  return {
    ...cloneTokens(tokens),
    radiusScale: tokens.radiusScale.map((value) => (value === null ? null : clampScaleValue('radiusScale', value))),
    spacingScale: tokens.spacingScale.map((value) => (value === null ? null : clampScaleValue('spacingScale', value))),
    typeScale: tokens.typeScale.map((value) => (value === null ? null : clampScaleValue('typeScale', value))),
  }
}

export function missingScaleEntries(tokens: BrandTokens): string[] {
  const labels: Record<ScaleField, string> = { radiusScale: '圆角尺度', spacingScale: '间距体系', typeScale: '字体比例' }
  return (Object.keys(SCALE_LENGTHS) as ScaleField[]).flatMap((field) => {
    const expected = SCALE_LENGTHS[field]
    const gaps: string[] = []
    if (tokens[field].length !== expected) gaps.push(`${labels[field]}层级数应为 ${expected}`)
    tokens[field].forEach((value, index) => {
      if (value === null) gaps.push(`${labels[field]}第 ${index + 1} 层为空`)
    })
    return gaps
  })
}

/** 保存版本/导出前的完整校验；允许本地存在未填槽位，只要显式提示即可 */
export function validateTokens(tokens: BrandTokens): string | null {
  if (!isHexColor(tokens.primary) || !isHexColor(tokens.secondary)) return '请输入 6 位 HEX 颜色'
  const gaps = missingScaleEntries(tokens)
  if (gaps.length > 0) return `令牌层级数量不完整：${gaps.slice(0, 2).join('，')}`
  if (tokens.typeScale.some((value) => value !== null && (value < 10 || value > 72))) return '字号范围应在 10–72px'
  return null
}

function channel(value: number): number {
  const scaled = value / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function luminance(color: string): number {
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

export function contrastRatio(first: string | null, second: string | null): number | null {
  if (!isHexColor(first) || !isHexColor(second)) return null
  const one = luminance(first)
  const two = luminance(second)
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05)
}

export function themeTokens(theme: BrandTheme): BrandTokens {
  return cloneTokens(THEME_PRESETS[theme].tokens)
}
