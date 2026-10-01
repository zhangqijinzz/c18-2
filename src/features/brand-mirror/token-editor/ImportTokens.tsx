import { useRef } from 'react'
import type {
  BrandMirrorSnapshot,
  ImportConflictMode,
  ImportFieldKey,
  ImportFieldPreview,
  ImportScaleStrategy,
} from '../models/brandMirrorModels'

interface ImportTokensProps {
  snapshot: BrandMirrorSnapshot
  onImportFile: (file: File) => void
  onCancel: () => void
  onApply: () => void
  onModeChange: (mode: ImportConflictMode) => void
  onStrategyChange: (strategy: ImportScaleStrategy) => void
  onFieldToggle: (field: ImportFieldKey, selected: boolean) => void
  onFieldMap: (field: ImportFieldKey, candidateId: string) => void
}

const conflictOptions: { id: ImportConflictMode; label: string; description: string }[] = [
  { id: 'overwrite', label: '覆盖当前值', description: '用导入值替换所有选中字段' },
  { id: 'fillEmpty', label: '只补空缺', description: '仅选中本地为空或无效的字段，其余可手动勾选' },
  { id: 'keepLocal', label: '保留本地已有', description: '默认不覆盖任何字段，需要的层级可手动勾选' },
]

const strategyOptions: { id: ImportScaleStrategy; label: string; description: string }[] = [
  { id: 'extend', label: '补齐或裁剪', description: '不足按末尾步进补齐，多余层级裁剪' },
  { id: 'retain', label: '保留本地层级', description: '导入同名层级，缺失保留本地，多余裁剪' },
]

export function ImportTokens(props: ImportTokensProps) {
  const { snapshot } = props
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <button className="import-trigger" type="button" onClick={() => inputRef.current?.click()}>⇪ 导入令牌文件</button>
      <input
        ref={inputRef}
        className="import-file-input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) props.onImportFile(file)
          event.target.value = ''
        }}
      />
      {snapshot.importDraft && <ImportDialog {...props} draft={snapshot.importDraft} />}
    </>
  )
}

function ImportDialog({ draft, onCancel, onApply, onModeChange, onStrategyChange, onFieldToggle, onFieldMap }: ImportTokensProps & { draft: NonNullable<BrandMirrorSnapshot['importDraft']> }) {
  const selectedCount = draft.fields.filter((field) => field.selected).length
  const errorCount = draft.fields.reduce((count, field) => count + field.issues.filter((issue) => issue.severity === 'error').length, 0)

  return (
    <div className="import-backdrop" role="presentation">
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-dialog-title">
        <header className="import-dialog-head">
          <div>
            <span className="eyebrow">IMPORT / MAPPING</span>
            <h2 id="import-dialog-title">导入前映射预览</h2>
            <p>{draft.fileName} · 请确认字段、层级策略和冲突处理方式</p>
          </div>
          <button type="button" className="import-close" onClick={onCancel} aria-label="关闭导入预览">×</button>
        </header>

        <div className="import-summary">
          {draft.issues.length === 0 && <span className="import-badge okay">映射正常</span>}
          {draft.issues.map((issue, index) => <span key={`${issue.severity}-${index}`} className={`import-badge ${issue.severity}`}>{issue.message}</span>)}
        </div>

        <div className="import-option-grid">
          <ImportOptions title="冲突处理" options={conflictOptions} activeId={draft.conflictMode} onChange={(id) => onModeChange(id as ImportConflictMode)} />
          <ImportOptions title="层级数量不一致" options={strategyOptions} activeId={draft.scaleStrategy} onChange={(id) => onStrategyChange(id as ImportScaleStrategy)} />
        </div>

        <div className="import-fields">
          {draft.fields.map((field) => <FieldRow key={field.key} field={field} draft={draft} onToggle={onFieldToggle} onMap={onFieldMap} />)}
        </div>

        {draft.unmatchedCandidates.length > 0 && (
          <section className="import-unmatched">
            <h3>未映射字段（{draft.unmatchedCandidates.length}）</h3>
            <div className="import-unmatched-list">
              {draft.unmatchedCandidates.map((candidate) => <span key={candidate.id}><code>{candidate.path}</code>{candidate.rawText}</span>)}
            </div>
          </section>
        )}

        <footer className="import-dialog-footer">
          <span>{selectedCount} 个字段将写入 · 确认后同步预览、版本与导出</span>
          <div>
            <button type="button" className="secondary-button" onClick={onCancel}>取消</button>
            <button type="button" className="primary-button" disabled={selectedCount === 0 || errorCount > 0} onClick={onApply}>确认导入</button>
          </div>
        </footer>
      </section>
    </div>
  )
}

function ImportOptions({ title, options, activeId, onChange }: { title: string; options: { id: string; label: string; description: string }[]; activeId: string; onChange: (id: string) => void }) {
  return <section className="import-options"><h3>{title}</h3><div>{options.map((option) => <label key={option.id} className={activeId === option.id ? 'selected' : ''}><input type="radio" name={title} checked={activeId === option.id} onChange={() => onChange(option.id)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></section>
}

function FieldRow({ field, draft, onToggle, onMap }: { field: ImportFieldPreview; draft: NonNullable<BrandMirrorSnapshot['importDraft']>; onToggle: ImportTokensProps['onFieldToggle']; onMap: ImportTokensProps['onFieldMap'] }) {
  const candidates = draft.candidates.filter((candidate) => field.kind === 'color' ? candidate.kind === 'color' : candidate.kind === 'numberArray')
  return (
    <article className={`import-field ${field.status}`}>
      <label className="import-field-check">
        <input type="checkbox" checked={field.selected} disabled={field.status === 'missing' || field.status === 'invalid'} onChange={(event) => onToggle(field.key, event.target.checked)} />
        <span>{field.label}</span>
      </label>
      <div className="import-source">
        <select aria-label={`${field.label}来源字段`} value={field.sourceCandidateId ?? ''} onChange={(event) => onMap(field.key, event.target.value)}>
          <option value="">跳过该字段</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.path}（{candidate.rawText}）</option>)}
        </select>
        {field.status === 'missing' && <span className="field-state warning">未识别</span>}
        {field.status === 'invalid' && <span className="field-state error">值无效</span>}
        {field.status === 'adjusted' && <span className="field-state info">已按策略处理</span>}
        {field.status === 'ready' && <span className="field-state okay">可导入</span>}
      </div>
      <div className="import-values"><span><small>本地</small><strong>{field.currentText}</strong></span><span>→</span><span><small>导入结果</small><strong>{field.proposedText ?? '—'}</strong></span></div>
      <FieldIssues field={field} />
    </article>
  )
}

function FieldIssues({ field }: { field: ImportFieldPreview }) {
  if (field.issues.length === 0) return null
  return <ul className="import-field-issues">{field.issues.map((issue, index) => <li key={index} className={issue.severity}>{issue.message}</li>)}</ul>
}
