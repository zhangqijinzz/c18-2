import type { BrandMirrorSnapshot } from '../models/brandMirrorModels'

export interface BrandGuidelinesExporter {
  export(snapshot: BrandMirrorSnapshot): void
}

const scaleLine = (value: number | null, index: number, name: string) => `- \`${name}.${index + 1}\`: ${value === null ? '待补齐' : `${value}px`}`

export function buildBrandGuidelinesMarkdown(snapshot: BrandMirrorSnapshot): string {
  const { tokens } = snapshot
  const versions = snapshot.versions.length === 0 ? '- 暂无保存版本' : snapshot.versions.map((version) => `- ${version.label} · ${version.createdAt.slice(0, 10)} · 主色 ${version.tokens.primary} · 辅助色 ${version.tokens.secondary}`).join('\n')
  return `# BrandMirror 品牌规范\n\n> 导出时间：${new Date().toISOString().slice(0, 10)}\n> 当前主题：${snapshot.theme}\n\n## 品牌色\n\n| 令牌 | 值 |\n| --- | --- |\n| 主色 \`primary\` | \`${tokens.primary ?? '待补齐'}\` |\n| 辅助色 \`secondary\` | \`${tokens.secondary ?? '待补齐'}\` |\n| 对比度 | ${snapshot.contrastRatio === null ? '待补齐颜色' : `${snapshot.contrastRatio.toFixed(1)}:1`} |\n\n## 圆角尺度\n\n${tokens.radiusScale.map((value, index) => scaleLine(value, index, 'radius')).join('\n')}\n\n## 间距体系\n\n${tokens.spacingScale.map((value, index) => scaleLine(value, index, 'spacing')).join('\n')}\n\n## 字体比例\n\n${tokens.typeScale.map((value, index) => scaleLine(value, index, 'type')).join('\n')}\n\n## 保存版本\n\n${versions}\n\n---\n由 BrandMirror 品牌视觉实验室生成。\n`
}

export class BrowserBrandGuidelinesExporter implements BrandGuidelinesExporter {
  export(snapshot: BrandMirrorSnapshot): void {
    const content = buildBrandGuidelinesMarkdown(snapshot)
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `BrandMirror-Brand-Guidelines-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
  }
}
