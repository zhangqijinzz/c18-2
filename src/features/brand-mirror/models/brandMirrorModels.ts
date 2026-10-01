export type BrandTheme = 'studio' | 'editorial' | 'night'
export type MirrorStatus = 'loading' | 'ready' | 'editing' | 'error'

export type ColorField = 'primary' | 'secondary'
export type ScaleField = 'radiusScale' | 'spacingScale' | 'typeScale'
export type TokenFieldKey = ColorField | ScaleField

/** 尺度槽位允许为 null：导入“只补空缺”前，用户也可以把某个槽位清空 */
export type ScaleValues = (number | null)[]

export interface BrandTokens {
  primary: string | null
  secondary: string | null
  radiusScale: ScaleValues
  spacingScale: ScaleValues
  typeScale: ScaleValues
}

export interface SavedVersion {
  id: string
  label: string
  tokens: BrandTokens
  createdAt: string
}

export interface BrandDocument {
  version: 1
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
}

/** 各尺度的标准层级数量，导入时多余裁剪、不足补齐 */
export const SCALE_LENGTHS: Record<ScaleField, number> = {
  radiusScale: 4,
  spacingScale: 5,
  typeScale: 6,
}

export type ImportMode = 'overwrite' | 'fillEmpty' | 'keepLocal'

export type ImportIssueLevel = 'warning' | 'info'

export interface ImportIssue {
  level: ImportIssueLevel
  message: string
}

export interface ImportFieldPreview {
  key: TokenFieldKey
  label: string
  matched: boolean
  sourcePath: string | null
  /** 颜色为单值；尺度为已经按策略补齐/裁剪后的槽位序列，无效项为 null */
  values: (string | number | null)[]
  issues: ImportIssue[]
}

export interface UnmappedEntry {
  path: string
  value: string
}

export type TokenImportParse =
  | { error: string }
  | {
      error: null
      fileName: string
      fields: ImportFieldPreview[]
      unmapped: UnmappedEntry[]
      issues: ImportIssue[]
    }

export interface ImportMergeEntry {
  key: TokenFieldKey
  label: string
  /** 尺度字段的槽位下标；颜色字段为 undefined */
  slot?: number
  local: string | number | null
  incoming: string | number | null
  result: string | number | null
  action: 'overwrite' | 'fill' | 'keep'
  issue: string | null
}

export type ImportState =
  | { phase: 'closed' }
  | { phase: 'idle'; parseError?: string }
  | ({ phase: 'review'; fileName: string; mode: ImportMode; fields: ImportFieldPreview[]; unmapped: UnmappedEntry[]; issues: ImportIssue[] } & ImportMergeSummary)

export interface ImportMergeSummary {
  entries: ImportMergeEntry[]
  changeCount: number
  fillCount: number
  keepCount: number
  warningCount: number
}

export interface BrandMirrorSnapshot {
  status: MirrorStatus
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
  compareMode: boolean
  activeVersionId: string | null
  contrastRatio: number | null
  contrastWarning: boolean
  message: string
  importState: ImportState
}

/** 初始/主题预设的令牌均为完整非空值 */
export interface CompleteBrandTokens extends BrandTokens {
  primary: string
  secondary: string
  radiusScale: number[]
  spacingScale: number[]
  typeScale: number[]
}

export const INITIAL_TOKENS: CompleteBrandTokens = {
  primary: '#F15A47',
  secondary: '#24324A',
  radiusScale: [8, 12, 18, 28],
  spacingScale: [4, 8, 12, 20, 32],
  typeScale: [12, 14, 16, 20, 28, 40],
}

export const THEME_PRESETS: Record<BrandTheme, { label: string; tokens: CompleteBrandTokens }> = {
  studio: {
    label: 'Studio warm',
    tokens: INITIAL_TOKENS,
  },
  editorial: {
    label: 'Editorial green',
    tokens: {
      primary: '#238B73', secondary: '#173C35', radiusScale: [4, 8, 12, 18], spacingScale: [4, 8, 16, 24, 40], typeScale: [12, 14, 16, 22, 30, 44],
    },
  },
  night: {
    label: 'Night signal',
    tokens: {
      primary: '#A98BFF', secondary: '#191829', radiusScale: [6, 10, 14, 22], spacingScale: [4, 8, 12, 18, 28], typeScale: [12, 14, 16, 20, 28, 38],
    },
  },
}
