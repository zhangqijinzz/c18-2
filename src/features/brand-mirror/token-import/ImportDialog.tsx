import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import type { BrandMirrorSnapshot, ImportMergeEntry, ImportMode } from '../models/brandMirrorModels'

interface ImportDialogProps {
  snapshot: BrandMirrorSnapshot
  onClose: () => void
  onFile: (file: File) => void
  onModeChange: (mode: ImportMode) => void
  onConfirm: () => void
}

const MODES: { id: ImportMode; title: string; description: string }[] = [
  { id: 'overwrite', title: '覆盖当前值', description: '用文件中的值替换所有映射到的槽位，本地原值被覆盖' },
  { id: 'fillEmpty', title: '只补空缺', description: '仅填充当前为空的槽位，已有值的槽位一律不动' },
  { id: 'keepLocal', title: '保留本地已有', description: '只要该字段本地已有值，整段保留；整段为空的字段才从文件导入' },
]

export function ImportDialog({ snapshot, onClose, onFile, onModeChange, onConfirm }: ImportDialogProps) {
  const state = snapshot.importState
  if (state.phase === 'closed') return null

  return (
    <div className="import-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="import-dialog" role="dialog" aria-modal="true" aria-label="导入设计令牌">
        <header className="import-header">
          <div>
            <span className="eyebrow">IMPORT TOKENS</span>
            <h2>导入设计令牌</h2>
          </div>
          <button className="import-close" type="button" aria-label="关闭导入" onClick={onClose}>×</button>
        </header>

        <ImportDropzone parseError={state.phase === 'idle' ? state.parseError : undefined} onFile={onFile} />

        {state.phase === 'review' && (
          <>
            <section className="import-modes">
              {MODES.map((mode) => (
                <button key={mode.id} type="button" className={`import-mode ${state.mode === mode.id ? 'selected' : ''}`} onClick={() => onModeChange(mode.id)}>
                  <span className="import-mode-radio" />
                  <strong>{mode.title}</strong>
                  <small>{mode.description}</small>
                </button>
              ))}
            </section>

            <div className="import-summary">
              <span className="summary-chip overwrite">覆盖 {state.changeCount}</span>
              <span className="summary-chip fill">补齐 {state.fillCount}</span>
              <span className="summary-chip keep">保留 {state.keepCount}</span>
              {state.warningCount > 0 && <span className="summary-chip warning">{state.warningCount} 条需注意</span>}
            </div>

            <div className="import-table-head"><span>令牌字段</span><span>本地当前</span><span>导入后</span><span>处理</span></div>
            <div className="import-entries">
              {state.entries.map((entry) => <ImportRow key={`${entry.key}-${entry.slot ?? 'color'}`} entry={entry} />)}
            </div>

            {hasFieldIssues(state) && (
              <section className="import-notes">
                <h3>映射与层级提示</h3>
                {state.fields.flatMap((field) => field.issues.map((issue, index) => (
                  <div className={`import-note ${issue.level}`} key={`${field.key}-${index}`}>
                    <span>{issue.level === 'warning' ? '!' : 'i'}</span>
                    <div><strong>{field.label}</strong><p>{issue.message}</p></div>
                  </div>
                )))}
              </section>
            )}

            {state.unmapped.length > 0 && (
              <details className="import-unmapped">
                <summary>{state.unmapped.length} 个未映射字段将被忽略（点击查看）</summary>
                <ul>
                  {state.unmapped.map((entry) => (
                    <li key={entry.path}><code>{entry.path}</code><span>{entry.value}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <footer className="import-footer">
          <span className="muted">{state.phase === 'review' ? `来源文件：${state.fileName}` : '支持 JSON（W3C DTCG / Style Dictionary）与 CSV / TSV'}</span>
          <div className="import-footer-actions">
            <button className="secondary-button" type="button" onClick={onClose}>取消</button>
            <button className="primary-button" type="button" disabled={state.phase !== 'review'} onClick={onConfirm}>
              {state.phase === 'review' ? `确认导入（${state.changeCount + state.fillCount} 项变更）` : '确认导入'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function ImportDropzone({ parseError, onFile }: { parseError?: string; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = (files: FileList | null) => {
    if (files && files.length > 0) onFile(files[0])
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(event.target.files)
    event.target.value = ''
  }

  return (
    <div
      className={`import-dropzone ${dragging ? 'dragging' : ''} ${parseError ? 'has-error' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".json,.csv,.tsv,.txt,application/json,text/csv,text/plain" onChange={handleChange} hidden />
      <span className="dropzone-icon">↑</span>
      <div>
        <strong>{parseError ?? '点击选择，或把令牌文件拖到这里'}</strong>
        {!parseError && <small>导入前会先展示每条字段的映射结果，不会直接改动当前令牌</small>}
      </div>
    </div>
  )
}

function hasFieldIssues(state: Extract<BrandMirrorSnapshot['importState'], { phase: 'review' }>): boolean {
  return state.fields.some((field) => field.issues.length > 0)
}

function formatValue(value: string | number | null): string {  if (value === null || value === '') return '— 空 —'
  return typeof value === 'number' ? `${value}px` : value
}

function ImportRow({ entry }: { entry: ImportMergeEntry }) {
  const actionLabel = { overwrite: '覆盖', fill: '补齐', keep: '保留' }[entry.action]
  return (
    <div className={`import-row ${entry.action} ${entry.issue ? 'has-issue' : ''}`}>
      <span className="import-row-name">{entry.label}</span>
      <span className={`import-row-value local ${entry.local === null ? 'empty' : ''}`}>{formatValue(entry.local)}</span>
      <span className="import-arrow">→</span>
      <span className={`import-row-value result ${entry.result === null ? 'empty' : ''}`}>{formatValue(entry.result)}</span>
      <span className={`import-badge ${entry.action}`}>{actionLabel}</span>
      {entry.issue && <span className="import-row-issue" title={entry.issue}>!</span>}
    </div>
  )
}
