import { describe, expect, it } from 'vitest'
import { BrandMirrorViewModel } from '../viewmodels/brandMirrorViewModel'
import type { BrandDocument } from '../models/brandMirrorModels'
import type { BrandRepository } from '../repositories/brandRepository'
import { buildBrandGuidelinesMarkdown, type BrandGuidelinesExporter } from '../services/exportService'

class MemoryRepository implements BrandRepository {
  document: BrandDocument | null = null
  save(document: BrandDocument): void { this.document = document }
  load(): BrandDocument | null { return this.document }
}

class MemoryExporter implements BrandGuidelinesExporter {
  received = ''
  export(snapshot: Parameters<BrandGuidelinesExporter['export']>[0]): void { this.received = buildBrandGuidelinesMarkdown(snapshot) }
}

const W3C_FILE = () => JSON.stringify({
  color: { brand: { primary: { $type: 'color', $value: '#238B73' } }, ink: { secondary: { $type: 'color', $value: '#173C35' } } },
  radius: { sm: { $value: '6px' }, md: { $value: '10px' }, lg: { $value: '14px' }, xl: { $value: '22px' } },
  spacing: { 1: { $value: '4px' }, 2: { $value: '8px' }, 3: { $value: '12px' }, 4: { $value: '18px' }, 5: { $value: '28px' } },
  font: { size: { 1: { $value: 12 }, 2: { $value: 14 }, 3: { $value: 16 }, 4: { $value: 20 }, 5: { $value: 28 }, 6: { $value: 38 } } },
  shadow: { card: { $value: '0 2px 8px rgba(0,0,0,.1)' } },
})

describe('import flow in the view model', () => {
  it('parses a file into review state and lists per-entry actions before anything changes', () => {
    const viewModel = new BrandMirrorViewModel(new MemoryRepository())
    viewModel.initialize()
    const before = viewModel.getSnapshot().tokens.primary
    viewModel.openImport()
    expect(viewModel.getSnapshot().importState.phase).toBe('idle')
    viewModel.loadImportText('tokens.json', W3C_FILE())
    const state = viewModel.getSnapshot().importState
    expect(state.phase).toBe('review')
    // 确认前本地令牌不变
    expect(viewModel.getSnapshot().tokens.primary).toBe(before)
    if (state.phase !== 'review') throw new Error('expected review')
    expect(state.entries.length).toBe(2 + 4 + 5 + 6)
    expect(state.entries.filter((entry) => entry.action === 'overwrite').length).toBeGreaterThan(0)
    expect(state.unmapped.some((entry) => entry.path.includes('shadow'))).toBe(true)
  })

  it('overwrite mode applies the file and immediately reflects it in tokens, versions and export', () => {
    const repository = new MemoryRepository()
    const exporter = new MemoryExporter()
    const viewModel = new BrandMirrorViewModel(repository, exporter)
    viewModel.initialize()
    viewModel.openImport()
    viewModel.loadImportText('tokens.json', W3C_FILE())
    viewModel.confirmImport()

    const snapshot = viewModel.getSnapshot()
    expect(snapshot.importState.phase).toBe('closed')
    expect(snapshot.tokens.primary).toBe('#238B73')
    expect(snapshot.tokens.radiusScale).toEqual([6, 10, 14, 22])
    expect(snapshot.message).toContain('覆盖')
    // 已持久化
    expect(repository.document?.tokens.primary).toBe('#238B73')

    // 保存的版本携带导入后的令牌
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions[0].tokens.primary).toBe('#238B73')

    // 导出内容反映导入结果
    viewModel.exportBrandGuidelines()
    expect(exporter.received).toContain('#238B73')
    expect(exporter.received).toContain('`radius.1`: 6px')
  })

  it('fillEmpty only fills slots that are locally empty', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    viewModel.updateColor('primary', '')
    viewModel.updateScale('radiusScale', 0, null)
    viewModel.openImport()
    viewModel.loadImportText('tokens.json', W3C_FILE())
    viewModel.setImportMode('fillEmpty')
    viewModel.confirmImport()

    const tokens = viewModel.getSnapshot().tokens
    expect(tokens.primary).toBe('#238B73')
    expect(tokens.secondary).toBe('#24324A')
    expect(tokens.radiusScale[0]).toBe(6)
    expect(tokens.radiusScale[1]).toBe(12)
  })

  it('keepLocal leaves partially-filled fields untouched and imports whole empty fields', () => {
    const repository = new MemoryRepository()
    const viewModel = new BrandMirrorViewModel(repository)
    viewModel.initialize()
    // 清空整个间距字段，其它字段保留
    viewModel.getSnapshot().tokens.spacingScale.forEach((_, index) => viewModel.updateScale('spacingScale', index, null))
    viewModel.openImport()
    viewModel.loadImportText('tokens.json', W3C_FILE())
    viewModel.setImportMode('keepLocal')
    viewModel.confirmImport()

    const tokens = viewModel.getSnapshot().tokens
    expect(tokens.primary).toBe('#F15A47')
    expect(tokens.radiusScale).toEqual([8, 12, 18, 28])
    expect(tokens.spacingScale).toEqual([4, 8, 12, 18, 28])
  })

  it('surfaces parse errors without touching local tokens, and cancel leaves everything intact', () => {
    const viewModel = new BrandMirrorViewModel(new MemoryRepository())
    viewModel.initialize()
    viewModel.openImport()
    viewModel.loadImportText('bad.json', '{ broken')
    const errorState = viewModel.getSnapshot().importState
    expect(errorState.phase).toBe('idle')
    expect(errorState.phase === 'idle' ? errorState.parseError : '').toContain('JSON')
    expect(viewModel.getSnapshot().tokens.primary).toBe('#F15A47')

    viewModel.loadImportText('tokens.json', W3C_FILE())
    viewModel.closeImport()
    expect(viewModel.getSnapshot().importState.phase).toBe('closed')
    expect(viewModel.getSnapshot().tokens.primary).toBe('#F15A47')
  })

  it('blocks version saving while imported tokens have unfilled slots and explains why', () => {
    const viewModel = new BrandMirrorViewModel(new MemoryRepository())
    viewModel.initialize()
    viewModel.openImport()
    // 只含两个尺度层的圆角文件 → 补齐策略后尾部为空
    viewModel.loadImportText('partial.json', JSON.stringify({
      color: { primary: '#123456', secondary: '#654321' },
      radius: [4, 8, 12, 18],
      spacing: [4, 8, 12, 20, 32],
      type: [12, 14],
    }))
    viewModel.confirmImport()
    const versionsBefore = viewModel.getSnapshot().versions.length
    viewModel.saveVersion()
    expect(viewModel.getSnapshot().versions).toHaveLength(versionsBefore)
    expect(viewModel.getSnapshot().message).toContain('不完整')
  })
})
