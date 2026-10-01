export type BrandTheme = 'studio' | 'editorial' | 'night'
export type MirrorStatus = 'loading' | 'ready' | 'editing' | 'error'
export type ImportConflictMode = 'overwrite' | 'fillEmpty' | 'keepLocal'
export type ImportScaleStrategy = 'extend' | 'retain'
export type ImportFieldKey = 'primary' | 'secondary' | 'radiusScale' | 'spacingScale' | 'typeScale'
export type ImportIssueSeverity = 'info' | 'warning' | 'error'

export interface ImportIssue {
  severity: ImportIssueSeverity
  message: string
}

export interface ImportValueCandidate {
  id: string
  path: string
  rawText: string
  kind: 'color' | 'number' | 'numberArray' | 'unknown'
  color?: string
  numbers?: number[]
  scorePath: string
  memberIds?: string[]
}

export interface ImportFieldPreview {
  key: ImportFieldKey
  label: string
  kind: 'color' | 'scale'
  currentText: string
  sourceCandidateId?: string
  importedText?: string
  proposedText?: string
  proposedValue?: string | number[]
  selected: boolean
  status: 'ready' | 'adjusted' | 'missing' | 'invalid'
  issues: ImportIssue[]
}

export interface ImportDraft {
  fileName: string
  parsedAt: string
  conflictMode: ImportConflictMode
  scaleStrategy: ImportScaleStrategy
  fields: ImportFieldPreview[]
  candidates: ImportValueCandidate[]
  unmatchedCandidates: ImportValueCandidate[]
  ignoredCount: number
  issues: ImportIssue[]
}

export interface BrandTokens {
  primary: string
  secondary: string
  radiusScale: number[]
  spacingScale: number[]
  typeScale: number[]
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

export interface BrandMirrorSnapshot {
  status: MirrorStatus
  tokens: BrandTokens
  theme: BrandTheme
  versions: SavedVersion[]
  compareMode: boolean
  activeVersionId: string | null
  contrastRatio: number
  contrastWarning: boolean
  message: string
  importDraft: ImportDraft | null
}

export const INITIAL_TOKENS: BrandTokens = {
  primary: '#F15A47',
  secondary: '#24324A',
  radiusScale: [8, 12, 18, 28],
  spacingScale: [4, 8, 12, 20, 32],
  typeScale: [12, 14, 16, 20, 28, 40],
}

export const THEME_PRESETS: Record<BrandTheme, { label: string; tokens: BrandTokens }> = {
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
