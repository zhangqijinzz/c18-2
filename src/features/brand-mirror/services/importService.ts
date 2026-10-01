import { clampTokenValues, cloneTokens, isHexColor } from '../domain/brandRules'
import type {
  BrandTokens,
  ImportConflictMode,
  ImportDraft,
  ImportFieldKey,
  ImportFieldPreview,
  ImportIssue,
  ImportScaleStrategy,
  ImportValueCandidate,
} from '../models/brandMirrorModels'

const SCALE_TARGETS = {
  radiusScale: { length: 4, label: '圆角尺度', min: 0, max: 40, step: 4 },
  spacingScale: { length: 5, label: '间距体系', min: 2, max: 64, step: 4 },
  typeScale: { length: 6, label: '字体比例', min: 10, max: 72, step: 4, growth: 1.2 },
} as const

const FIELD_LABELS: Record<ImportFieldKey, string> = {
  primary: '主色',
  secondary: '辅助色',
  radiusScale: '圆角尺度',
  spacingScale: '间距体系',
  typeScale: '字体比例',
}

const METADATA_KEYS = new Set(['$schema', '$description', '$extensions', '$metadata', 'description', 'extensions', 'meta', 'metadata'])

export function createImportPreview(text: string, currentTokens: BrandTokens, fileName = 'tokens.json'): ImportDraft {
  const issues: ImportIssue[] = []
  const { leaves, ignoredCount } = collectLeaves(text)
  const candidates = leaves.map((leaf, index) => createCandidate(leaf, index)).filter((candidate): candidate is ImportValueCandidate => candidate !== null)
  const assignments = autoAssign(candidates)
  let draft: ImportDraft = {
    fileName,
    parsedAt: new Date().toISOString(),
    conflictMode: 'overwrite',
    scaleStrategy: 'extend',
    fields: (Object.keys(FIELD_LABELS) as ImportFieldKey[]).map((key) => createField(key, currentTokens, getMappedCandidate(candidates, assignments.get(key)), 'extend')),
    candidates,
    unmatchedCandidates: getUnmatchedCandidates(candidates, assignments),
    ignoredCount,
    issues,
  }
  draft.issues = buildGlobalIssues(draft)
  return draft
}

export function changeImportMode(draft: ImportDraft, currentTokens: BrandTokens, conflictMode: ImportConflictMode): ImportDraft {
  const fields = draft.fields.map((field) => ({ ...field, selected: isFieldSelected(field, currentTokens, conflictMode) }))
  const next = { ...draft, conflictMode, fields }
  return { ...next, issues: buildGlobalIssues(next) }
}

export function changeScaleStrategy(draft: ImportDraft, currentTokens: BrandTokens, scaleStrategy: ImportScaleStrategy): ImportDraft {
  const fields = draft.fields.map((field) => field.kind === 'scale' ? createField(field.key, currentTokens, field.sourceCandidateId ? draft.candidates.find((candidate) => candidate.id === field.sourceCandidateId) : undefined, scaleStrategy, field.selected) : field)
  const next = { ...draft, scaleStrategy, fields }
  return { ...next, issues: buildGlobalIssues(next) }
}

export function changeFieldSelection(draft: ImportDraft, fieldKey: ImportFieldKey, selected: boolean): ImportDraft {
  const fields = draft.fields.map((field) => field.key === fieldKey ? { ...field, selected: field.status !== 'missing' && selected } : field)
  const next = { ...draft, fields }
  return { ...next, issues: buildGlobalIssues(next) }
}

export function mapImportCandidate(draft: ImportDraft, currentTokens: BrandTokens, fieldKey: ImportFieldKey, candidateId: string): ImportDraft {
  const assignments = new Map<ImportFieldKey, string | undefined>()
  draft.fields.forEach((field) => {
    if (field.key === fieldKey || !field.sourceCandidateId || field.sourceCandidateId === candidateId) return
    assignments.set(field.key, field.sourceCandidateId)
  })
  if (candidateId) assignments.set(fieldKey, candidateId)
  const fields = draft.fields.map((field) => createField(field.key, currentTokens, getMappedCandidate(draft.candidates, assignments.get(field.key)), draft.scaleStrategy, isFieldSelectedWithMapping(field.key, assignments, draft.candidates, currentTokens, draft.conflictMode)))
  const next = { ...draft, fields, unmatchedCandidates: getUnmatchedCandidates(draft.candidates, assignments) }
  return { ...next, issues: buildGlobalIssues(next) }
}

export function applyImportDraft(draft: ImportDraft, currentTokens: BrandTokens): BrandTokens {
  const tokens = cloneTokens(currentTokens)
  draft.fields.forEach((field) => {
    if (!field.selected || field.status === 'missing') return
    if (field.kind === 'color' && typeof field.proposedValue === 'string' && (field.key === 'primary' || field.key === 'secondary')) {
      tokens[field.key] = field.proposedValue
    }
    if (field.kind === 'scale' && Array.isArray(field.proposedValue) && field.key !== 'primary' && field.key !== 'secondary') {
      tokens[field.key] = field.proposedValue
    }
  })
  return clampTokenValues(tokens)
}

type RawLeaf = { path: string; value: unknown }

function collectLeaves(text: string): { leaves: RawLeaf[]; ignoredCount: number } {
  const parsed = JSON.parse(text) as unknown
  const leaves: RawLeaf[] = []
  let ignoredCount = 0

  const walk = (value: unknown, pathParts: string[]): void => {
    if (Array.isArray(value)) {
      if (value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
        leaves.push({ path: pathParts.join('.'), value })
        return
      }
      if (value.length > 0 && value.every((item) => typeof item === 'string' && parseNumeric(item) !== null)) {
        leaves.push({ path: pathParts.join('.'), value: value.map((item) => parseNumeric(item) as number) })
        return
      }
      value.forEach((item, index) => walk(item, [...pathParts, String(index + 1)]))
      return
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const tokenValue = '$value' in record ? record.$value : record.value
      if (typeof tokenValue === 'string' || typeof tokenValue === 'number') {
        leaves.push({ path: pathParts.join('.'), value: tokenValue })
        return
      }
      Object.entries(record).forEach(([key, child]) => {
        if (METADATA_KEYS.has(key)) {
          ignoredCount += countValues(child)
          return
        }
        walk(child, [...pathParts, normalizePathPart(key)])
      })
      return
    }
    if (typeof value === 'string' || typeof value === 'number') leaves.push({ path: pathParts.join('.'), value })
    else ignoredCount += 1
  }

  walk(parsed, [])
  return { leaves, ignoredCount }
}

function countValues(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((count, item) => count + countValues(item), 0)
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).reduce<number>((count, item) => count + countValues(item), 0)
  return 1
}

function createCandidate(leaf: RawLeaf, index: number): ImportValueCandidate | null {
  const id = `candidate-${index + 1}`
  const path = leaf.path || 'root'
  const scorePath = normalizeScorePath(path)
  if (typeof leaf.value === 'number' && Number.isFinite(leaf.value)) {
    return { id, path, rawText: formatNumber(leaf.value), kind: 'number', numbers: [leaf.value], scorePath }
  }
  if (Array.isArray(leaf.value)) {
    return { id, path, rawText: leaf.value.map(formatNumber).join(', '), kind: 'numberArray', numbers: leaf.value, scorePath }
  }
  if (typeof leaf.value === 'string') {
    const color = parseColor(leaf.value)
    const number = parseNumeric(leaf.value)
    if (color) return { id, path, rawText: leaf.value, kind: 'color', color, scorePath }
    if (number !== null) return { id, path, rawText: leaf.value, kind: 'number', numbers: [number], scorePath }
    return { id, path, rawText: leaf.value, kind: 'unknown', scorePath }
  }
  return null
}

function autoAssign(candidates: ImportValueCandidate[]): Map<ImportFieldKey, string | undefined> {
  const assignments = new Map<ImportFieldKey, string | undefined>()
  const primaryColors = candidates.filter((candidate) => candidate.kind === 'color')
  const primary = primaryColors.sort((a, b) => colorScore(b, 'primary') - colorScore(a, 'primary'))[0]
  const secondary = primaryColors.filter((candidate) => candidate.id !== primary?.id).sort((a, b) => colorScore(b, 'secondary') - colorScore(a, 'secondary'))[0]
  const primaryMatch = primary && colorScore(primary, 'primary') >= 6
  const secondaryMatch = secondary && colorScore(secondary, 'secondary') >= 6
  assignments.set('primary', primaryMatch ? primary?.id : undefined)
  assignments.set('secondary', secondaryMatch ? secondary?.id : undefined)
  ;(Object.keys(SCALE_TARGETS) as (keyof typeof SCALE_TARGETS)[]).forEach((key) => {
    const groups = candidates.filter((candidate) => candidate.kind === 'numberArray' && scaleScore(candidate, key) > 0)
    const scalars = candidates.filter((candidate) => candidate.kind === 'number' && scaleScore(candidate, key) >= 3)
    const group = groups.sort((a, b) => scaleScore(b, key) - scaleScore(a, key))[0]
    if (group) assignments.set(key, group.id)
    else if (scalars.length >= 2) assignments.set(key, buildScalarGroup(key, scalars, candidates).id)
    else assignments.set(key, undefined)
  })
  return assignments
}

function buildScalarGroup(key: ImportFieldKey, scalars: ImportValueCandidate[], candidates: ImportValueCandidate[]): ImportValueCandidate {
  const ordered = scalars.sort((a, b) => scaleScore(b, key) - scaleScore(a, key) || candidateIndex(a) - candidateIndex(b))
  const existing = candidates.find((candidate) => candidate.kind === 'numberArray' && candidate.memberIds?.length === ordered.length && ordered.every((scalar) => candidate.memberIds?.includes(scalar.id)))
  if (existing) return existing
  const group: ImportValueCandidate = {
    id: `derived-${key}`,
    path: ordered.map((candidate) => candidate.path).join(' / '),
    rawText: ordered.map((candidate) => candidate.rawText).join(', '),
    kind: 'numberArray',
    numbers: ordered.flatMap((candidate) => candidate.numbers ?? []),
    scorePath: ordered[0].scorePath,
    memberIds: ordered.map((candidate) => candidate.id),
  }
  candidates.push(group)
  return group
}

function createField(key: ImportFieldKey, currentTokens: BrandTokens, candidate: ImportValueCandidate | undefined, strategy: ImportScaleStrategy, selected?: boolean): ImportFieldPreview {
  const currentValue = currentTokens[key]
  const currentText = Array.isArray(currentValue) ? currentValue.map(formatNumber).join(' / ') : currentValue
  const base: ImportFieldPreview = {
    key,
    label: FIELD_LABELS[key],
    kind: key === 'primary' || key === 'secondary' ? 'color' : 'scale',
    currentText,
    sourceCandidateId: candidate?.id,
    selected: false,
    status: 'missing',
    issues: [],
  }
  if (!candidate) {
    base.issues = [{ severity: 'warning', message: '未识别到对应字段，可手动指定来源或跳过' }]
    return base
  }
  base.importedText = candidate.rawText
  if (base.kind === 'color') {
    if (candidate.kind !== 'color' || !candidate.color || !isHexColor(candidate.color)) {
      base.status = 'invalid'
      base.issues = [{ severity: 'error', message: `来源值 “${candidate.rawText}” 不是可识别颜色` }]
      return base
    }
    base.proposedText = candidate.color
    base.proposedValue = candidate.color
    base.status = 'ready'
    if (candidate.rawText.trim().toUpperCase() !== candidate.color) base.issues.push({ severity: 'info', message: `已归一化为 ${candidate.color}` })
  } else {
    const target = SCALE_TARGETS[key === 'primary' || key === 'secondary' ? 'radiusScale' : key]
    const incoming = candidate.numbers ?? []
    const resolved = resolveScale(incoming, currentValue as number[], target, strategy)
    base.proposedText = resolved.values.map(formatNumber).join(' / ')
    base.proposedValue = resolved.values
    base.status = resolved.issues.length > 0 ? 'adjusted' : 'ready'
    base.issues = resolved.issues
  }
  base.selected = selected ?? true
  return base
}

function resolveScale(incoming: number[], current: number[], target: (typeof SCALE_TARGETS)[keyof typeof SCALE_TARGETS], strategy: ImportScaleStrategy): { values: number[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  if (incoming.length === 0) return { values: current, issues: [{ severity: 'error', message: '来源不包含有效数值' }] }
  if (strategy === 'retain') {
    const values = current.map((value, index) => clamp(index < incoming.length ? incoming[index] : value, target.min, target.max))
    if (incoming.length < target.length) issues.push({ severity: 'info', message: `来源仅 ${incoming.length} 层，后 ${target.length - incoming.length} 层保留本地值` })
    if (incoming.length > target.length) issues.push({ severity: 'info', message: `来源有 ${incoming.length} 层，已裁剪多余的 ${incoming.length - target.length} 层` })
    return { values, issues }
  }
  const values = incoming.slice(0, target.length).map((value) => clamp(value, target.min, target.max))
  while (values.length < target.length) {
    const last = values[values.length - 1]
    const next = 'growth' in target ? last * target.growth : last + target.step
    values.push(clamp(next, target.min, target.max))
  }
  if (incoming.length < target.length) issues.push({ severity: 'info', message: `来源仅 ${incoming.length} 层，已按末尾步进补齐 ${target.length - incoming.length} 层` })
  if (incoming.length > target.length) issues.push({ severity: 'info', message: `来源有 ${incoming.length} 层，已裁剪多余的 ${incoming.length - target.length} 层` })
  return { values, issues }
}

function isFieldSelected(field: ImportFieldPreview, currentTokens: BrandTokens, mode: ImportConflictMode): boolean {
  if (field.status === 'missing') return false
  if (mode === 'overwrite') return true
  const current = currentTokens[field.key]
  if (Array.isArray(current)) {
    if (mode === 'fillEmpty') return current.some((value) => !Number.isFinite(value))
    return false
  }
  if (mode === 'fillEmpty') return !isHexColor(current)
  return false
}

function isFieldSelectedWithMapping(key: ImportFieldKey, assignments: Map<ImportFieldKey, string | undefined>, candidates: ImportValueCandidate[], currentTokens: BrandTokens, mode: ImportConflictMode): boolean {
  const candidate = getMappedCandidate(candidates, assignments.get(key))
  const field = createField(key, currentTokens, candidate, 'extend')
  return isFieldSelected(field, currentTokens, mode)
}

function getMappedCandidate(candidates: ImportValueCandidate[], id?: string): ImportValueCandidate | undefined {
  return id ? candidates.find((candidate) => candidate.id === id) : undefined
}

function getUnmatchedCandidates(candidates: ImportValueCandidate[], assignments: Map<ImportFieldKey, string | undefined>): ImportValueCandidate[] {
  const assignedIds = new Set([...assignments.values()].filter((id): id is string => !!id))
  return candidates.filter((candidate) => {
    if (assignedIds.has(candidate.id)) return false
    if (candidate.memberIds?.some((id) => assignedIds.has(id))) return false
    const parent = candidates.find((item) => item.memberIds?.includes(candidate.id) && assignedIds.has(item.id))
    return !parent
  })
}

function buildGlobalIssues(draft: ImportDraft): ImportIssue[] {
  const issues: ImportIssue[] = []
  const mapped = draft.fields.filter((field) => field.status !== 'missing')
  const selected = draft.fields.filter((field) => field.selected)
  if (mapped.length === 0) issues.push({ severity: 'warning', message: '没有可自动映射的字段，请手动指定来源' })
  if (selected.length === 0) issues.push({ severity: 'warning', message: '当前没有选中任何导入字段' })
  if (draft.unmatchedCandidates.length > 0) issues.push({ severity: 'info', message: `${draft.unmatchedCandidates.length} 个来源字段未映射，将被忽略` })
  if (draft.ignoredCount > 0) issues.push({ severity: 'info', message: `${draft.ignoredCount} 个元数据字段已自动跳过` })
  return issues
}

function colorScore(candidate: ImportValueCandidate, field: 'primary' | 'secondary'): number {
  if (candidate.kind !== 'color') return 0
  const path = candidate.scorePath
  if (field === 'primary') {
    if (/brand|primary|main/.test(path)) return 10
    if (/accent|brandcolor/.test(path)) return 6
  }
  if (field === 'secondary') {
    if (/secondary|supporting/.test(path)) return 10
    if (/accent/.test(path)) return 6
  }
  if (/color|colour|fill/.test(path)) return 2
  return 0
}

function scaleScore(candidate: ImportValueCandidate, field: ImportFieldKey): number {
  const path = candidate.scorePath
  if (field === 'radiusScale' && /(radius|corner)/.test(path)) return 10
  if (field === 'spacingScale' && /(spacing|space|gap|padding|margin)/.test(path)) return 10
  if (field === 'typeScale' && /(fontsize|font|type|textsize|text)/.test(path)) return 10
  if (/(scale|token)/.test(path)) return 1
  return 0
}

function parseColor(value: string): string | null {
  const text = value.trim()
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
  if (hex) {
    let digits = hex[1]
    if (digits.length === 3) digits = digits.split('').map((part) => part + part).join('')
    if (digits.length === 8 && !digits.endsWith('FF')) return null
    return `#${digits.slice(0, 6).toUpperCase()}`
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/i)
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => part.trim())
    const numbers = parts.slice(0, 3).map((part) => parseColorPart(part))
    const alpha = parts[3] === undefined ? 1 : Number(parts[3])
    if (numbers.every((number) => number !== null) && alpha >= 1) return rgbToHex(numbers as number[])
  }
  const hsl = text.match(/^hsla?\(([^)]+)\)$/i)
  if (hsl) {
    const parts = hsl[1].split(',').map((part) => part.trim())
    const h = Number(parts[0]) / 360
    const s = parsePercent(parts[1])
    const l = parsePercent(parts[2])
    if ([h, s, l].every(Number.isFinite)) return rgbToHex(hslToRgb(h, s ?? 0, l ?? 0))
  }
  return null
}

function parseColorPart(value: string): number | null {
  if (value.endsWith('%')) {
    const percent = parsePercent(value)
    return percent === null ? null : Math.round(percent * 255)
  }
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(255, Math.max(0, Math.round(number))) : null
}

function parsePercent(value: string): number | null {
  const number = Number(value.replace('%', ''))
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number / 100)) : null
}

function rgbToHex(rgb: number[]): string {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function hslToRgb(h: number, s: number, l: number): number[] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)].map((value) => value * 255)
}

function parseNumeric(value: string): number | null {
  const text = value.trim().toLowerCase()
  const rem = text.match(/^(-?\d+(?:\.\d+)?)rem$/)
  if (rem) return Number(rem[1]) * 16
  const px = text.match(/^(-?\d+(?:\.\d+)?)(?:px)?$/)
  if (px) return Number(px[1])
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function normalizePathPart(part: string): string {
  return part.replace(/^\$/, '').replace(/^--/, '')
}

function normalizeScorePath(path: string): string {
  return path.toLowerCase().replace(/[^a-z]/g, '')
}

function candidateIndex(candidate: ImportValueCandidate): number {
  return Number(candidate.id.replace(/\D/g, '')) || 0
}
