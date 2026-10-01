import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import {
  applyImportDraft,
  changeFieldSelection,
  changeImportMode,
  changeScaleStrategy,
  createImportPreview,
  mapImportCandidate,
} from '../services/importService'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type ImportConflictMode, type ImportFieldKey, type ImportScaleStrategy, type SavedVersion } from '../models/brandMirrorModels'

type Listener = () => void

export class BrandMirrorViewModel {
  private snapshot: BrandMirrorSnapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] })
  private readonly listeners = new Set<Listener>()
  private readonly repository: BrandRepository
  private readonly exporter?: BrandGuidelinesExporter

  constructor(repository: BrandRepository, exporter?: BrandGuidelinesExporter) {
    this.repository = repository
    this.exporter = exporter
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): BrandMirrorSnapshot {
    return this.snapshot
  }

  initialize(): void {
    const stored = this.repository.load()
    if (stored) {
      this.snapshot = this.makeSnapshot(stored, '已恢复最近一次工作状态')
    } else {
      this.snapshot = this.makeSnapshot({ tokens: INITIAL_TOKENS, theme: 'studio', versions: [] }, '从 Studio warm 开始探索')
    }
    this.emit()
  }

  selectTheme(theme: BrandTheme): void {
    this.update({ tokens: themeTokens(theme), theme }, '已切换基础主题')
  }

  updateColor(field: 'primary' | 'secondary', value: string): void {
    const color = normalizeColor(value)
    this.update({ tokens: { ...this.snapshot.tokens, [field]: color } }, '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number): void {
    const values = [...this.snapshot.tokens[field]]
    values[index] = Number.isFinite(value) ? value : values[index]
    this.update({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, '令牌已更新')
  }

  previewImportFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => this.previewImportText(String(reader.result ?? ''), file.name)
    reader.onerror = () => {
      this.snapshot = { ...this.snapshot, status: 'error', message: '文件读取失败，请重新选择令牌文件' }
      this.emit()
    }
    reader.readAsText(file)
  }

  previewImportText(text: string, fileName = 'tokens.json'): void {
    try {
      const importDraft = createImportPreview(text, this.snapshot.tokens, fileName)
      this.snapshot = { ...this.snapshot, status: 'ready', message: `已解析 ${fileName}，请确认映射结果`, importDraft }
      this.emit()
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '无法解析导入文件，请确认它是有效 JSON', importDraft: null }
      this.emit()
    }
  }

  selectImportConflictMode(conflictMode: ImportConflictMode): void {
    if (!this.snapshot.importDraft) return
    this.setImportDraft(changeImportMode(this.snapshot.importDraft, this.snapshot.tokens, conflictMode))
  }

  selectImportScaleStrategy(scaleStrategy: ImportScaleStrategy): void {
    if (!this.snapshot.importDraft) return
    this.setImportDraft(changeScaleStrategy(this.snapshot.importDraft, this.snapshot.tokens, scaleStrategy))
  }

  toggleImportField(fieldKey: ImportFieldKey, selected: boolean): void {
    if (!this.snapshot.importDraft) return
    this.setImportDraft(changeFieldSelection(this.snapshot.importDraft, fieldKey, selected))
  }

  mapImportField(fieldKey: ImportFieldKey, candidateId: string): void {
    if (!this.snapshot.importDraft) return
    this.setImportDraft(mapImportCandidate(this.snapshot.importDraft, this.snapshot.tokens, fieldKey, candidateId))
  }

  cancelImport(): void {
    if (!this.snapshot.importDraft) return
    this.snapshot = { ...this.snapshot, importDraft: null, message: '已取消导入，本地令牌未改变' }
    this.emit()
  }

  applyImport(): void {
    if (!this.snapshot.importDraft) return
    const draft = this.snapshot.importDraft
    const tokens = applyImportDraft(draft, this.snapshot.tokens)
    const appliedCount = draft.fields.filter((field) => field.selected && field.status !== 'missing').length
    if (appliedCount === 0) {
      this.snapshot = { ...this.snapshot, status: 'error', message: '请至少选择一个有效字段后再导入', importDraft: draft }
      this.emit()
      return
    }
    const nextVersion: SavedVersion = {
      id: `version-${Date.now()}`,
      label: `导入 ${draft.fileName.replace(/\.[^.]+$/, '')}`.slice(0, 24),
      tokens: cloneTokens(tokens),
      createdAt: new Date().toISOString(),
    }
    const document = { tokens, theme: this.snapshot.theme, versions: [...this.snapshot.versions, nextVersion] }
    try {
      this.repository.save({ version: 1, ...document })
      this.snapshot = this.makeSnapshot(document, `已导入 ${appliedCount} 个字段，并保存为版本「${nextVersion.label}」`, 'ready')
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导入结果无法保存，请检查令牌值', importDraft: draft }
    }
    this.emit()
  }

  private setImportDraft(importDraft: BrandMirrorSnapshot['importDraft']): void {
    this.snapshot = { ...this.snapshot, message: '映射预览已更新，尚未写入本地令牌', importDraft }
    this.emit()
  }

  reset(): void {
    this.update({ tokens: cloneTokens(INITIAL_TOKENS), theme: 'studio' }, '已恢复默认令牌')
  }

  saveVersion(): void {
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.snapshot = { ...this.snapshot, status: 'error', message: validationError }
      this.emit()
      return
    }
    const nextVersion: SavedVersion = {
      id: `version-${Date.now()}`,
      label: this.snapshot.versions.length === 0 ? 'Version A' : `Version ${String.fromCharCode(65 + this.snapshot.versions.length)}`,
      tokens: cloneTokens(this.snapshot.tokens),
      createdAt: new Date().toISOString(),
    }
    const versions = [...this.snapshot.versions, nextVersion]
    this.persist({ tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions }, '版本已保存')
  }

  toggleCompare(): void {
    this.snapshot = { ...this.snapshot, compareMode: !this.snapshot.compareMode, message: this.snapshot.compareMode ? '已退出对比模式' : '正在对比最近两个版本' }
    this.emit()
  }

  exportBrandGuidelines(): void {
    if (!this.exporter) return
    try {
      this.exporter.export(this.snapshot)
      this.snapshot = { ...this.snapshot, message: '品牌规范已导出' }
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导出失败，请稍后重试' }
    }
    this.emit()
  }

  private update(partial: Partial<Pick<BrandDocument, 'tokens' | 'theme'>>, message: string): void {
    const tokens = partial.tokens ?? this.snapshot.tokens
    this.snapshot = this.makeSnapshot({ tokens, theme: partial.theme ?? this.snapshot.theme, versions: this.snapshot.versions }, message, 'editing')
    this.persistCurrent()
  }

  private persistCurrent(): void {
    try {
      this.repository.save({ version: 1, tokens: this.snapshot.tokens, theme: this.snapshot.theme, versions: this.snapshot.versions })
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '本地保存失败，但当前编辑仍保留在页面中' }
    }
    this.emit()
  }

  private persist(document: Omit<BrandDocument, 'version'>, message: string): void {
    try {
      this.repository.save({ version: 1, ...document })
      this.snapshot = this.makeSnapshot(document, message, 'ready')
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '版本保存失败，请稍后重试' }
    }
    this.emit()
  }

  private makeSnapshot(document: Omit<BrandDocument, 'version'>, message = '', status: BrandMirrorSnapshot['status'] = 'ready', importDraft: BrandMirrorSnapshot['importDraft'] = null): BrandMirrorSnapshot {
    const ratio = contrastRatio(document.tokens.primary, document.tokens.secondary)
    const latestVersion = document.versions[document.versions.length - 1]
    return { status, tokens: cloneTokens(document.tokens), theme: document.theme, versions: document.versions, compareMode: false, activeVersionId: latestVersion?.id ?? null, contrastRatio: ratio, contrastWarning: ratio < 3, message, importDraft }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
