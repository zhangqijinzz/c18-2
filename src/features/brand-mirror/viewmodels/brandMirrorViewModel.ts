import { clampTokenValues, cloneTokens, contrastRatio, normalizeColor, themeTokens, validateTokens } from '../domain/brandRules'
import type { BrandRepository } from '../repositories/brandRepository'
import type { BrandGuidelinesExporter } from '../services/exportService'
import { mergeImportedTokens, parseTokenImport, previewImportMerge } from '../services/tokenImport'
import { INITIAL_TOKENS, type BrandDocument, type BrandMirrorSnapshot, type BrandTheme, type ImportMode, type ImportState, type SavedVersion, type TokenImportParse } from '../models/brandMirrorModels'

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
    const trimmed = value.trim()
    // 允许清空槽位，便于随后用“只补空缺”导入；失焦时输入框仍会回退到上一个合法值
    const color = trimmed === '' ? null : normalizeColor(trimmed, this.snapshot.tokens[field] ?? INITIAL_TOKENS.primary)
    this.update({ tokens: { ...this.snapshot.tokens, [field]: color } }, color === null ? '该颜色已清空，等待补齐' : '令牌已更新')
  }

  updateScale(field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number | null): void {
    const values = [...this.snapshot.tokens[field]]
    values[index] = value === null || !Number.isFinite(value) ? null : value
    this.update({ tokens: clampTokenValues({ ...this.snapshot.tokens, [field]: values }) }, value === null ? '该尺度槽位已清空' : '令牌已更新')
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
    const validationError = validateTokens(this.snapshot.tokens)
    if (validationError) {
      this.snapshot = { ...this.snapshot, status: 'error', message: validationError }
      this.emit()
      return
    }
    try {
      this.exporter.export(this.snapshot)
      this.snapshot = { ...this.snapshot, message: '品牌规范已导出' }
    } catch {
      this.snapshot = { ...this.snapshot, status: 'error', message: '导出失败，请稍后重试' }
    }
    this.emit()
  }

  // --- 令牌导入 -------------------------------------------------------------

  openImport(): void {
    if (this.snapshot.importState.phase === 'closed') {
      this.snapshot = { ...this.snapshot, importState: { phase: 'idle' }, message: '选择其它工具导出的令牌文件' }
      this.emit()
    }
  }

  closeImport(): void {
    this.snapshot = { ...this.snapshot, importState: { phase: 'closed' } }
    this.emit()
  }

  readImportFile(file: File): void {
    const reader = new FileReader()
    reader.onload = () => this.loadImportText(file.name, typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => {
      this.snapshot = { ...this.snapshot, importState: { phase: 'idle' }, status: 'error', message: '文件读取失败，请重试' }
      this.emit()
    }
    reader.readAsText(file)
  }

  loadImportText(fileName: string, text: string): void {
    const parsed = parseTokenImport(fileName, text)
    if (parsed.error !== null) {
      this.snapshot = { ...this.snapshot, importState: { phase: 'idle', parseError: parsed.error } }
      this.emit()
      return
    }
    this.applyReview(parsed, 'overwrite')
  }

  setImportMode(mode: ImportMode): void {
    const state = this.snapshot.importState
    if (state.phase !== 'review') return
    const review: Extract<TokenImportParse, { error: null }> = { error: null, fileName: state.fileName, fields: state.fields, unmapped: state.unmapped, issues: state.issues }
    this.applyReview(review, mode)
  }

  confirmImport(): void {
    const state = this.snapshot.importState
    if (state.phase !== 'review') return
    const merged = clampTokenValues(mergeImportedTokens(this.snapshot.tokens, state.fields, state.mode))
    const { changeCount, fillCount } = state
    this.snapshot = {
      ...this.makeSnapshot(
        { tokens: merged, theme: this.snapshot.theme, versions: this.snapshot.versions },
        `导入完成：覆盖 ${changeCount} 项，补齐 ${fillCount} 项`,
        'editing',
      ),
      importState: { phase: 'closed' },
    }
    this.persistCurrent()
  }

  private applyReview(parsed: Extract<TokenImportParse, { error: null }>, mode: ImportMode): void {
    const summary = previewImportMerge(this.snapshot.tokens, parsed.fields, mode)
    const importState: ImportState = {
      phase: 'review',
      fileName: parsed.fileName,
      mode,
      fields: parsed.fields,
      unmapped: parsed.unmapped,
      issues: parsed.issues,
      ...summary,
    }
    this.snapshot = { ...this.snapshot, importState, status: 'ready', message: `已解析 ${parsed.fileName}，请确认映射与导入方式` }
    this.emit()
  }

  // --- 内部状态 -------------------------------------------------------------

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

  private makeSnapshot(document: Omit<BrandDocument, 'version'>, message = '', status: BrandMirrorSnapshot['status'] = 'ready', importState: ImportState = { phase: 'closed' }): BrandMirrorSnapshot {
    const ratio = contrastRatio(document.tokens.primary, document.tokens.secondary)
    const latestVersion = document.versions[document.versions.length - 1]
    return { status, tokens: cloneTokens(document.tokens), theme: document.theme, versions: document.versions, compareMode: false, activeVersionId: latestVersion?.id ?? null, contrastRatio: ratio, contrastWarning: ratio !== null && ratio < 3, message, importState }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }
}
