import type { BrandDocument, BrandTokens } from '../models/brandMirrorModels'
import { SCALE_LENGTHS } from '../models/brandMirrorModels'
import { clampTokenValues } from '../domain/brandRules'
import type { StorageService } from '../services/storageService'

export interface BrandRepository {
  load(): BrandDocument | null
  save(document: BrandDocument): void
}

export class LocalBrandRepository implements BrandRepository {
  constructor(private readonly storage: StorageService) {}

  load(): BrandDocument | null {
    const raw = this.storage.read()
    if (!raw) return null
    try {
      const candidate: unknown = JSON.parse(raw)
      if (!isDocument(candidate)) return null
      return { ...candidate, tokens: clampTokenValues(repairTokens(candidate.tokens)) }
    } catch {
      return null
    }
  }

  save(document: BrandDocument): void {
    // 编辑中的令牌允许有空槽位；版本保存与导出前由 ViewModel 做完整校验
    this.storage.write(JSON.stringify(document))
  }
}

/** 老版本数据中颜色为 string、尺度为 number[]，统一补齐为固定长度并把非法值置空 */
function repairTokens(tokens: Partial<BrandTokens>): BrandTokens {
  const repairScale = (field: keyof Pick<BrandTokens, 'radiusScale' | 'spacingScale' | 'typeScale'>, fallback: number[]) => {
    const expected = SCALE_LENGTHS[field]
    const source = Array.isArray(tokens[field]) ? tokens[field] : fallback
    const values = source.slice(0, expected).map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : null))
    while (values.length < expected) values.push(null)
    return values
  }
  return {
    primary: typeof tokens.primary === 'string' ? tokens.primary : null,
    secondary: typeof tokens.secondary === 'string' ? tokens.secondary : null,
    radiusScale: repairScale('radiusScale', [8, 12, 18, 28]),
    spacingScale: repairScale('spacingScale', [4, 8, 12, 20, 32]),
    typeScale: repairScale('typeScale', [12, 14, 16, 20, 28, 40]),
  }
}

function isDocument(value: unknown): value is BrandDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<BrandDocument>
  return candidate.version === 1 && !!candidate.tokens && Array.isArray(candidate.versions) && typeof candidate.theme === 'string'
}
