import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import { INITIAL_TOKENS, type BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { applyImportDraft, changeImportMode, changeScaleStrategy, createImportPreview } from '../services/importService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  load(): BrandDocument | null { return this.document }
  save(document: BrandDocument): void { this.document = document }
}

const tokenFile = JSON.stringify({
  color: {
    brand: { primary: { $value: '#123456', $type: 'color' }, secondary: '#654321' },
  },
  radius: { scale: [4, 8, 12] },
  spacing: { scale: [4, 8, 12, 20, 32, 48] },
  font: { size: ['12px', '14px', '18px'] },
})

describe('token import mapping', () => {
  it('maps common external token names and normalizes values', () => {
    const preview = createImportPreview(tokenFile, INITIAL_TOKENS, 'figma-tokens.json')
    const fields = Object.fromEntries(preview.fields.map((field) => [field.key, field]))
    expect(fields.primary.proposedValue).toBe('#123456')
    expect(fields.secondary.proposedValue).toBe('#654321')
    expect(fields.radiusScale.proposedValue).toEqual([4, 8, 12, 16])
    expect(fields.radiusScale.issues[0].message).toContain('补齐')
    expect(fields.spacingScale.proposedValue).toEqual([4, 8, 12, 20, 32])
    expect(fields.spacingScale.issues[0].message).toContain('裁剪')
    expect(fields.typeScale.proposedValue).toEqual([12, 14, 18, 22, 26, 31])
  })

  it('lists unmatched and metadata fields item by item', () => {
    const preview = createImportPreview(JSON.stringify({
      primary: '#123456',
      secondary: '#654321',
      borderRadius: [4, 8, 12, 16],
      spacing: [4, 8, 12, 20, 32],
      fontSize: [12, 14, 16, 20, 28, 40],
      custom: { value: '#ABCDEF' },
      $metadata: { source: 'figma' },
    }), INITIAL_TOKENS)
    expect(preview.unmatchedCandidates.map((candidate) => candidate.path)).toContain('custom')
    expect(preview.ignoredCount).toBe(1)
    expect(preview.issues.some((issue) => issue.message.includes('未映射'))).toBe(true)
  })

  it('retains local layers when that strategy is selected', () => {
    const preview = changeScaleStrategy(createImportPreview(tokenFile, INITIAL_TOKENS), INITIAL_TOKENS, 'retain')
    const radius = preview.fields.find((field) => field.key === 'radiusScale')
    expect(radius?.proposedValue).toEqual([4, 8, 12, 28])
    expect(radius?.issues[0].message).toContain('保留本地')
  })

  it('applies only selected fields', () => {
    const preview = changeImportMode(createImportPreview(tokenFile, { ...INITIAL_TOKENS, primary: '', secondary: '' }), { ...INITIAL_TOKENS, primary: '', secondary: '' }, 'fillEmpty')
    const applied = applyImportDraft(preview, { ...INITIAL_TOKENS, primary: '', secondary: '' })
    expect(applied.primary).toBe('#123456')
    expect(applied.secondary).toBe('#654321')
  })

  it('keeps locally customized fields untouched in retain mode', () => {
    const localTokens = { ...INITIAL_TOKENS, radiusScale: [7, 11, 17, 27], spacingScale: [3, 7, 13, 21, 33], typeScale: [13, 15, 17, 21, 29, 41] }
    const preview = changeImportMode(createImportPreview(tokenFile, localTokens), localTokens, 'keepLocal')
    expect(preview.fields.every((field) => !field.selected)).toBe(true)
  })

  it('updates preview, export and saves an import version through the view model', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.previewImportText(tokenFile, 'external.json')
    expect(viewModel.getSnapshot().importDraft?.fileName).toBe('external.json')
    viewModel.applyImport()
    const snapshot = viewModel.getSnapshot()
    expect(snapshot.tokens.primary).toBe('#123456')
    expect(snapshot.versions).toHaveLength(1)
    expect(snapshot.versions[0].label).toContain('external')
    expect(repository.document?.tokens.typeScale).toEqual(snapshot.tokens.typeScale)
    expect(snapshot.importDraft).toBeNull()
  })
})
