import type { BrandMirrorSnapshot, BrandTheme } from '../models/brandMirrorModels'

interface TokenControlsProps {
  snapshot: BrandMirrorSnapshot
  onThemeChange: (theme: BrandTheme) => void
  onColorChange: (field: 'primary' | 'secondary', value: string) => void
  onScaleChange: (field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number | null) => void
  onReset: () => void
  onImport: () => void
}

const themes: { id: BrandTheme; label: string; note: string }[] = [
  { id: 'studio', label: 'Studio warm', note: '热烈 · 友好' },
  { id: 'editorial', label: 'Editorial green', note: '克制 · 自然' },
  { id: 'night', label: 'Night signal', note: '锐利 · 数字' },
]

export function TokenControls({ snapshot, onThemeChange, onColorChange, onScaleChange, onReset, onImport }: TokenControlsProps) {
  return (
    <aside className="control-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">01 / TOKENS</span>
          <h2>视觉令牌</h2>
        </div>
        <div className="panel-heading-actions">
          <button className="text-button import-entry" type="button" onClick={onImport}>↑ 导入令牌</button>
          <button className="text-button" type="button" onClick={onReset}>恢复默认</button>
        </div>
      </div>

      <section className="control-section">
        <div className="section-label"><span>基础主题</span><span className="muted">快速起点</span></div>
        <div className="theme-list">
          {themes.map((theme) => (
            <button className={`theme-option ${snapshot.theme === theme.id ? 'selected' : ''}`} key={theme.id} onClick={() => onThemeChange(theme.id)} type="button">
              <span className={`theme-dot ${theme.id}`} />
              <span><strong>{theme.label}</strong><small>{theme.note}</small></span>
              {snapshot.theme === theme.id && <span className="check-mark">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <div className="section-label"><span>品牌色</span><span className="muted">HEX / 6 位</span></div>
        <div className="color-fields">
          <ColorField label="主色" value={snapshot.tokens.primary} onChange={(value) => onColorChange('primary', value)} />
          <ColorField label="辅助色" value={snapshot.tokens.secondary} onChange={(value) => onColorChange('secondary', value)} />
        </div>
        <div className={`contrast-note ${snapshot.contrastWarning ? 'warning' : ''}`}>
          <span className="contrast-icon">◐</span>
          <span>对比度 <strong>{snapshot.contrastRatio === null ? '待补齐颜色' : `${snapshot.contrastRatio.toFixed(1)}:1`}</strong> · {snapshot.contrastRatio === null ? '两个颜色都填写后计算' : snapshot.contrastWarning ? '建议提高对比度' : '适合界面使用'}</span>
        </div>
      </section>

      <ScaleControl label="圆角尺度" hint="px" values={snapshot.tokens.radiusScale} field="radiusScale" onChange={onScaleChange} />
      <ScaleControl label="间距体系" hint="px" values={snapshot.tokens.spacingScale} field="spacingScale" onChange={onScaleChange} />
      <ScaleControl label="字体比例" hint="px" values={snapshot.tokens.typeScale} field="typeScale" onChange={onScaleChange} />

      <div className="panel-footer"><span className="live-dot" />所有调整实时同步到预览</div>
    </aside>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string) => void }) {
  return <label className="color-field"><span>{label}</span><div className="color-input"><input aria-label={label} type="color" value={value ?? '#000000'} onChange={(event) => onChange(event.target.value)} /><input aria-label={`${label} HEX`} value={value ?? ''} placeholder="待导入" onChange={(event) => onChange(event.target.value)} /></div></label>
}

function ScaleControl({ label, hint, values, field, onChange }: { label: string; hint: string; values: (number | null)[]; field: 'radiusScale' | 'spacingScale' | 'typeScale'; onChange: (field: 'radiusScale' | 'spacingScale' | 'typeScale', index: number, value: number | null) => void }) {
  return <section className="control-section scale-section"><div className="section-label"><span>{label}</span><span className="muted">{hint}</span></div><div className="scale-inputs">{values.map((value, index) => <label key={`${field}-${index}`} className={value === null ? 'empty-slot' : ''}><span>{index + 1}</span><input aria-label={`${label}${index + 1}`} type="number" min={field === 'typeScale' ? 10 : 0} max={field === 'typeScale' ? 72 : field === 'spacingScale' ? 64 : 40} value={value ?? ''} placeholder="—" onChange={(event) => onChange(field, index, event.target.value === '' ? null : Number(event.target.value))} /></label>)}</div></section>
}
