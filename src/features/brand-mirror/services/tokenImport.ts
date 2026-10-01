import { SCALE_LENGTHS, type BrandTokens, type ColorField, type ImportFieldPreview, type ImportIssue, type ImportMergeEntry, type ImportMergeSummary, type ImportMode, type ScaleField, type TokenFieldKey, type TokenImportParse, type UnmappedEntry } from '../models/brandMirrorModels'

interface Leaf {
  /** 原始路径，用于提示，例如 color.brand.primary */
  path: string
  /** 仅小写字母数字词元，用于匹配 */
  words: string[]
  /** 所属对象父节点路径，用于把同级令牌归组为尺度序列 */
  parentPath: string
  /** 末尾键名（可能是 radius-md 这类含连字符的复合名） */
  lastKey: string
  raw: unknown
}

interface Series {
  /** 共享前缀路径，不含末尾序号，例如 scale.radius */
  prefix: string
  words: string[]
  members: Leaf[]
}

interface FieldSpec {
  key: TokenFieldKey
  label: string
  kind: 'color' | 'scale'
  /** 命中即加分的词元 */
  aliases: string[]
  /** 复合词别名，需要与去分隔后的完整路径比对 */
  phrases: string[]
  /** 命中即排除的词元，避免主色/辅助色、字重字号之类的串味 */
  excludes: string[]
}

const FIELD_SPECS: FieldSpec[] = [
  { key: 'primary', label: '主色', kind: 'color', aliases: ['primary', 'brand', 'accent', 'main', '主色'], phrases: ['品牌色', 'brandprimary'], excludes: ['secondary', 'surface', 'background', 'text', 'contrast', '辅助色', '辅色'] },
  { key: 'secondary', label: '辅助色', kind: 'color', aliases: ['secondary', 'support', 'supporting', 'second', '辅助色', '辅色'], phrases: ['brandsecondary'], excludes: ['primary', 'surface', 'text', 'contrast', '主色'] },
  { key: 'radiusScale', label: '圆角尺度', kind: 'scale', aliases: ['radius', 'radii', 'corner', 'rounding', '圆角'], phrases: ['borderradius'], excludes: ['spacing', 'space', 'gap', 'padding', 'margin', 'font', 'type', 'width', 'height'] },
  { key: 'spacingScale', label: '间距体系', kind: 'scale', aliases: ['spacing', 'space', 'gap', 'gutter', 'padding', 'margin', 'distance', '间距', '留白'], phrases: [], excludes: ['radius', 'corner', 'font', 'type', 'width', 'height'] },
  { key: 'typeScale', label: '字体比例', kind: 'scale', aliases: ['font', 'type', 'text', 'size', '字号', '字体'], phrases: ['fontsize', 'typescale', 'sizescale'], excludes: ['radius', 'corner', 'spacing', 'space', 'gap', 'weight', 'lineheight', 'family', 'letter'] },
]

const NOISE_WORDS = new Set(['value', 'values', 'token', 'tokens', 'design', 'system', 'theme', 'global', 'styles', 'style', 'variable', 'variables', 'var', 'color', 'colors', 'colour', 'colours', 'scale', 'scales', 'step', 'steps', 'level', 'levels', 'name', 'key', 'id', 'the', 'a', 'an', 'of', 'default'])

function tokenize(path: string): string[] {
  return path
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function displayValue(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (Array.isArray(raw)) return `[${raw.slice(0, 6).map((item) => displayValue(item)).join(', ')}${raw.length > 6 ? ', …' : ''}]`
  if (raw && typeof raw === 'object') return JSON.stringify(raw)
  return String(raw ?? '')
}

// ---------------------------------------------------------------------------
// 值解析
// ---------------------------------------------------------------------------

function clampHexChannel(value: number): string {
  return Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')
}

export function parseColor(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()

  let match = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value)
  if (match) return `#${match[1].toUpperCase()}`

  match = /^#([0-9a-f]{3})(?:[0-9a-f])?$/i.exec(value)
  if (match) return `#${match[1].split('').map((char) => char + char).join('').toUpperCase()}`

  const rgbMatch = /^rgba?\(\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)(%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i.exec(value)
  if (rgbMatch) {
    const channels = [rgbMatch[1], rgbMatch[3], rgbMatch[5]].map((channel) => Number(channel))
    const percents = [rgbMatch[2], rgbMatch[4], rgbMatch[6]]
    if (channels.some((channel) => !Number.isFinite(channel))) return null
    const scaled = channels.map((channel, index) => (percents[index] ? (channel / 100) * 255 : channel))
    return `#${scaled.map(clampHexChannel).join('').toUpperCase()}`
  }

  return null
}

function parseScaleEntry(raw: unknown): { value: number | null; note?: string } {
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { value: null }
  if (typeof raw !== 'string') return { value: null }
  const value = raw.trim()

  const pixel = /^(-?\d+(?:\.\d+)?)(?:px)?$/i.exec(value)
  if (pixel) return { value: Number(pixel[1]) }

  const rem = /^(-?\d+(?:\.\d+)?)rem$/i.exec(value)
  if (rem) return { value: Number(rem[1]) * 16, note: 'rem 已按 1rem = 16px 换算' }

  return { value: null, note: `无法识别的尺度值 “${value}”，该层已留空` }
}

// ---------------------------------------------------------------------------
// 层级补齐 / 裁剪
// ---------------------------------------------------------------------------

export function alignScale(field: ScaleField, incoming: (number | null)[]): { values: (number | null)[]; issues: ImportIssue[] } {
  const expected = SCALE_LENGTHS[field]
  const issues: ImportIssue[] = []
  if (incoming.length === expected) return { values: [...incoming], issues }

  if (incoming.length > expected) {
    issues.push({ level: 'warning', message: `源文件含 ${incoming.length} 层，已裁剪为标准 ${expected} 层（保留前 ${expected} 层）` })
    return { values: incoming.slice(0, expected), issues }
  }

  issues.push({ level: 'warning', message: `源文件仅 ${incoming.length} 层，不足标准 ${expected} 层，尾部 ${expected - incoming.length} 层已留空待补` })
  return { values: [...incoming, ...Array<null>(expected - incoming.length).fill(null)], issues }
}

// ---------------------------------------------------------------------------
// 文件读取：JSON（W3C DTCG / Style Dictionary / 嵌套结构）与 CSV/TSV
// ---------------------------------------------------------------------------

export function parseTokenImport(fileName: string, text: string): TokenImportParse {
  const trimmed = text.trim()
  if (!trimmed) return { error: '文件内容为空，请确认导出的令牌文件' }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (error) {
      return { error: `JSON 解析失败：${error instanceof Error ? error.message : '格式不正确'}` }
    }
    return buildReview(fileName, collectJsonLeaves(parsed))
  }
  return buildReview(fileName, collectDelimitedLeaves(trimmed))
}

function collectJsonLeaves(root: unknown): Leaf[] {
  const leaves: Leaf[] = []

  const pushLeaf = (raw: unknown, path: string, parentPath: string) => {
    const lastKey = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path
    leaves.push({ path: path || 'value', words: tokenize(path || 'value'), parentPath, lastKey, raw })
  }

  // 叶子是当前节点（path 为节点路径）时，其分组父级是节点名的上一级
  const leafParent = (path: string, parentPath: string) => {
    if (!path) return parentPath
    const dot = path.lastIndexOf('.')
    return dot >= 0 ? path.slice(0, dot) : ''
  }

  const visit = (node: unknown, path: string, parentPath: string) => {
    if (Array.isArray(node)) {
      // 纯数字/字符串数组视为一个尺度序列叶子
      if (node.length > 0 && node.every((item) => typeof item === 'number' || typeof item === 'string')) {
        pushLeaf(node, path || 'scale', parentPath)
        return
      }
      node.forEach((item, index) => visit(item, path ? `${path}.${index}` : String(index), path))
      return
    }
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>
      // W3C DTCG 令牌节点：{ $value, $type }；叶子归属到节点的父对象下
      if ('$value' in record) {
        pushLeaf(record.$value, path || 'token', leafParent(path, parentPath))
        return
      }
      // Style Dictionary 风格：{ value, type? }，value 为标量/数组即视为令牌节点
      if ('value' in record && isTokenValue(record.value)) {
        pushLeaf(record.value, path, leafParent(path, parentPath))
        return
      }
      const keys = Object.keys(record)
      if (keys.length === 0) return
      keys.forEach((key) => visit(record[key], path ? `${path}.${key}` : key, path))
      return
    }
    pushLeaf(node, path, parentPath)
  }

  visit(root, '', '')
  return leaves
}

function isTokenValue(value: unknown): boolean {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.every((item) => typeof item === 'string' || typeof item === 'number')
  return false
}

function collectDelimitedLeaves(text: string): Leaf[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('//'))
  if (lines.length === 0) return []

  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const splitLine = (line: string) => line.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ''))

  const header = splitLine(lines[0]).map((cell) => cell.toLowerCase())
  const hasHeader = header.some((cell) => ['path', 'name', 'token', 'key', 'value', '名称', '令牌'].includes(cell))
  const rows = hasHeader ? lines.slice(1) : lines

  const leaves: Leaf[] = []
  rows.forEach((line) => {
    const cells = line.includes(delimiter) ? splitLine(line) : line.split(/\s+/)
    if (cells.length < 2) return
    const raw = cells[cells.length - 1]
    const path = cells.slice(0, -1).join('.').replace(/[\\/]/g, '.')
    if (!path) return
    const parentPath = path.includes('.') ? path.slice(0, path.lastIndexOf('.')) : ''
    const lastKey = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : path
    leaves.push({ path, words: tokenize(path), parentPath, lastKey, raw })
  })
  return leaves
}

// ---------------------------------------------------------------------------
// 字段映射
// ---------------------------------------------------------------------------

/**
 * 尺度序列归组，两级策略：
 * 1. 同一父对象下的兄弟叶子（radius.sm/md/lg、spacing.1..5）；
 * 2. 父对象是混合集合（如 W3C/Figma 常见的扁平 global 组）时，按键名的语义
 *    前缀二次分组（radius-md / space-01 / font-size-01）。
 * 数字成员占多数的组才成立——Tailwind 风格 primary-500 这类 HEX 色阶不会被误吞。
 */
function buildScaleSeries(leaves: Leaf[]): { series: Series[]; seriesLeaves: Set<Leaf> } {
  const byParent = new Map<string, Leaf[]>()
  leaves.forEach((leaf) => {
    const key = leaf.parentPath
    const bucket = byParent.get(key)
    if (bucket) bucket.push(leaf)
    else byParent.set(key, [leaf])
  })

  // 根级无父对象的令牌（radius1/radius2）按“去掉结尾序号/阶梯名”归组
  const rootLeaves = byParent.get('') ?? []
  rootLeaves.forEach((leaf) => {
    const match = /^(.+?)(\d+|xs|sm|md|lg|xl|xxl|small|medium|large)$/i.exec(leaf.path)
    if (!match || match[1].length < 3) return
    byParent.delete('')
    const pseudo = `__root__.${match[1]}`
    const bucket = byParent.get(pseudo)
    if (bucket) bucket.push(leaf)
    else byParent.set(pseudo, [leaf])
  })

  const series: Series[] = []
  const seriesLeaves = new Set<Leaf>()

  const registerSeries = (prefix: string, members: Leaf[]) => {
    if (members.length < 2) return
    const parsed = members.map((member) => parseScaleEntry(member.raw))
    const numericCount = parsed.filter((entry) => entry.value !== null).length
    if (numericCount < Math.max(2, Math.ceil(members.length * 0.66))) return
    const sorted = sortSeriesMembers(members)
    sorted.forEach((member) => seriesLeaves.add(member))
    series.push({ prefix, words: tokenize(prefix), members: sorted })
  }

  byParent.forEach((members, parent) => {
    const parsed = members.map((member) => parseScaleEntry(member.raw))
    const numericCount = parsed.filter((entry) => entry.value !== null).length
    const looksUniform = numericCount >= Math.ceil(members.length * 0.66) && members.length >= 2

    // 父对象整体就是尺度序列（radius: {sm, md, lg}）
    if (looksUniform && !isMixedGroup(members)) {
      registerSeries(parent.startsWith('__root__.') ? parent.slice('__root__.'.length) : parent, members)
      return
    }

    // 混合组：按键名前缀（radius / space / font-size）二次分组
    const subGroups = new Map<string, Leaf[]>()
    members.forEach((leaf) => {
      const prefix = semanticKeyPrefix(leaf.lastKey)
      if (!prefix) return
      const bucket = subGroups.get(prefix)
      if (bucket) bucket.push(leaf)
      else subGroups.set(prefix, [leaf])
    })
    subGroups.forEach((group, prefix) => {
      const fullPrefix = parent ? `${parent}.${prefix}` : prefix
      registerSeries(fullPrefix, group)
    })
  })

  return { series, seriesLeaves }
}

/** 父对象下的键名是否来自多个语义前缀（混合集合） */
function isMixedGroup(members: Leaf[]): boolean {
  const prefixes = new Set(members.map((member) => semanticKeyPrefix(member.lastKey)).filter(Boolean))
  return prefixes.size >= 2
}

/**
 * 提取叶子键名的语义前缀：radius-md -> radius、space-01 -> space、
 * font-size-01 -> font-size、borderRadius-sm -> borderradius、1/2/sm 这类纯后缀 -> null
 */
function semanticKeyPrefix(key: string): string | null {
  const lower = key.toLowerCase()
  const patterns = [/^(border[._-]?radius)/, /^(font[._-]?size)/, /^(font)/, /^(radius|radii|corner|rounding)/, /^(spacing|space|sp|gap|gutter)/, /^(type|text)[._-]?size/, /^(type)/]
  for (const pattern of patterns) {
    const match = pattern.exec(lower)
    if (match) return match[1].replace(/[._-]/g, '')
  }
  return null
}

function sortSeriesMembers(members: Leaf[]): Leaf[] {
  const stepRank = (leaf: Leaf) => {
    const suffixMatch = /(?:^|[._-])(\d+|xs|sm|md|lg|xl|xxl|xxxl|small|medium|large|tiny|none)$/i.exec(leaf.lastKey)
    if (!suffixMatch) return null
    const suffix = suffixMatch[1].toLowerCase()
    if (/^\d+$/.test(suffix)) return Number(suffix)
    const steps = ['none', 'tiny', 'xs', 'sm', 'small', 'md', 'medium', 'lg', 'large', 'xl', 'xxl', 'xxxl']
    const rank = steps.indexOf(suffix)
    return rank >= 0 ? rank : null
  }
  return [...members].sort((a, b) => {
    const rankA = stepRank(a)
    const rankB = stepRank(b)
    if (rankA !== null && rankB !== null && rankA !== rankB) return rankA - rankB
    return a.path.localeCompare(b.path, undefined, { numeric: true })
  })
}

function scoreWords(words: string[], spec: FieldSpec): number {
  let score = 0
  const joined = words.join('')
  words.forEach((word) => {
    if (NOISE_WORDS.has(word) || /^\d+$/.test(word)) return
    if (spec.excludes.some((exclude) => word === exclude || (exclude.length >= 2 && word.includes(exclude)))) {
      score -= 6
      return
    }
    spec.aliases.forEach((alias) => {
      if (/[一-鿿]/.test(alias)) {
        if (word.includes(alias)) score += 12
      } else if (word === alias) {
        score += 10
      } else if (word.length >= 5 && alias.length >= 5 && (word.includes(alias) || alias.includes(word))) {
        score += 7
      }
    })
  })
  spec.phrases.forEach((phrase) => {
    if (joined.includes(phrase)) score += 8
  })
  return score
}

function rawColor(raw: unknown): string | null {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>
    if (typeof record.color === 'string') return parseColor(record.color)
    if (typeof record.hex === 'string') return parseColor(record.hex)
  }
  return parseColor(raw)
}

interface ColorCandidate { leaf: Leaf; value: string }
interface SeriesCandidate { series: Series; values: (number | null)[]; parseIssues: string[] }

/**
 * 同一语义下有多个色阶候选时（primary.100/500/900），优先取品牌主色档位：
 * 500/DEFAULT/base 最高，无序号的精确名次之，极端色阶（50/900）降权。
 */
function colorShadePreference(leaf: Leaf): number {
  const key = leaf.lastKey.toLowerCase()
  if (/^(500|base|default|DEFAULT)$/.test(key)) return 3
  if (/^(400|600)$/.test(key)) return 1
  if (/^\d+$/.test(key)) {
    const shade = Number(key)
    if (shade <= 100 || shade >= 800) return -2
    return -1
  }
  if (/(?:^|[.\-_])(base|default)$/.test(key)) return 3
  return 0
}

function buildReview(fileName: string, leaves: Leaf[]): TokenImportParse {
  if (leaves.length === 0) return { error: '没有在文件中找到任何可导入的令牌' }

  const { series, seriesLeaves } = buildScaleSeries(leaves)

  const colorCandidates: ColorCandidate[] = []
  leaves.forEach((leaf) => {
    if (seriesLeaves.has(leaf)) return
    const value = rawColor(leaf.raw)
    if (value) colorCandidates.push({ leaf, value })
  })

  const seriesCandidates: SeriesCandidate[] = []
  series.forEach((item) => {
    const parseIssues: string[] = []
    const values = item.members.map((member) => {
      const parsed = parseScaleEntry(member.raw)
      if (parsed.note) parseIssues.push(`${member.path}：${parsed.note}`)
      return parsed.value
    })
    seriesCandidates.push({ series: item, values, parseIssues })
  })

  // 数组型尺度叶子，例如 "radius": [4, 8, 12, 18]
  const arrayCandidates: SeriesCandidate[] = []
  leaves.forEach((leaf) => {
    if (!Array.isArray(leaf.raw) || seriesLeaves.has(leaf)) return
    const entries = leaf.raw.map((item) => parseScaleEntry(item))
    if (entries.every((entry) => entry.value === null)) return
    arrayCandidates.push({
      series: { prefix: leaf.path, words: leaf.words, members: [] },
      values: entries.map((entry) => entry.value),
      parseIssues: entries.flatMap((entry, index) => (entry.note ? [`${leaf.path}[${index + 1}]：${entry.note}`] : [])),
    })
  })

  const chosenLeaves = new Set<Leaf>()
  const chosenSeries = new Set<Series>()
  const fields: ImportFieldPreview[] = []

  // 颜色优先选择，保证主色/辅助色不会被同一候选占用
  FIELD_SPECS.filter((spec) => spec.kind === 'color').forEach((spec) => {
    const scored = colorCandidates
      .filter((candidate) => !chosenLeaves.has(candidate.leaf))
      .map((candidate) => ({ candidate, score: scoreWords(candidate.leaf.words, spec) + colorShadePreference(candidate.leaf) }))
      .filter((item) => item.score >= 6)
    scored.sort((a, b) => b.score - a.score || a.candidate.leaf.path.localeCompare(b.candidate.leaf.path))
    const best = scored[0] ?? null
    if (best) {
      chosenLeaves.add(best.candidate.leaf)
      fields.push({ key: spec.key, label: spec.label, matched: true, sourcePath: best.candidate.leaf.path, values: [best.candidate.value], issues: [] })
    } else {
      fields.push({ key: spec.key, label: spec.label, matched: false, sourcePath: null, values: [null], issues: [{ level: 'warning', message: '未在文件中找到对应字段，导入后将保留本地值或留空' }] })
    }
  })

  // 尺度字段：编号序列候选 + 数组候选
  FIELD_SPECS.filter((spec) => spec.kind === 'scale').forEach((spec) => {
    const scored: { candidate: SeriesCandidate; score: number }[] = []
    const consider = (candidate: SeriesCandidate) => {
      if (chosenSeries.has(candidate.series)) return
      const score = scoreWords(candidate.series.words, spec)
      if (score >= 5) scored.push({ candidate, score })
    }
    seriesCandidates.forEach(consider)
    arrayCandidates.forEach(consider)
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0] ?? null

    if (best) {
      const candidate = best.candidate
      chosenSeries.add(candidate.series)
      const aligned = alignScale(spec.key as ScaleField, candidate.values)
      fields.push({
        key: spec.key,
        label: spec.label,
        matched: true,
        sourcePath: candidate.series.prefix,
        values: aligned.values,
        issues: [...aligned.issues, ...candidate.parseIssues.slice(0, 3).map((message) => ({ level: 'warning' as const, message }))],
      })
    } else {
      const expected = SCALE_LENGTHS[spec.key as ScaleField]
      fields.push({
        key: spec.key,
        label: spec.label,
        matched: false,
        sourcePath: null,
        values: Array<null>(expected).fill(null),
        issues: [{ level: 'warning', message: '未在文件中找到对应尺度，导入后将保留本地值或留空' }],
      })
    }
  })

  // 未映射字段提示：被选中序列的成员不再逐个展示，按序列归组提示
  const unmapped: UnmappedEntry[] = []
  leaves.forEach((leaf) => {
    if (chosenLeaves.has(leaf) || seriesLeaves.has(leaf)) return
    if (Array.isArray(leaf.raw)) {
      // 未被选中的数组整体提示
      if (![...arrayCandidates].some((candidate) => candidate.series.prefix === leaf.path && chosenSeries.has(candidate.series))) {
        unmapped.push({ path: leaf.path, value: displayValue(leaf.raw) })
      }
      return
    }
    unmapped.push({ path: leaf.path, value: displayValue(leaf.raw) })
  })
  series.forEach((item) => {
    if (chosenSeries.has(item)) return
    unmapped.push({ path: `${item.prefix}.*`, value: `${item.members.length} 个层级未识别（示例：${displayValue(item.members[0].raw)}）` })
  })

  const issues: ImportIssue[] = []
  if (unmapped.length > 0) issues.push({ level: 'info', message: `${unmapped.length} 个字段未映射到 BrandMirror 令牌，导入时将被忽略` })

  return { error: null, fileName, fields: orderFields(fields), unmapped, issues }
}

function orderFields(fields: ImportFieldPreview[]): ImportFieldPreview[] {
  const order: TokenFieldKey[] = ['primary', 'secondary', 'radiusScale', 'spacingScale', 'typeScale']
  return [...fields].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

// ---------------------------------------------------------------------------
// 三种导入策略合并
// ---------------------------------------------------------------------------

type MergeAction = ImportMergeEntry['action']

function fieldHasLocalValue(tokens: BrandTokens, key: TokenFieldKey): boolean {
  if (key === 'primary' || key === 'secondary') return tokens[key] !== null
  return tokens[key].some((value) => value !== null)
}

function decideAction(mode: ImportMode, local: string | number | null, incoming: string | number | null, localFieldOccupied: boolean, matched: boolean): MergeAction {
  // 字段在源文件中缺失：任何策略下都保留本地
  if (!matched) return 'keep'
  if (mode === 'overwrite') {
    if (local === incoming) return 'keep'
    // 已匹配但源值为 null（无效值或补齐产生的空槽）：覆盖即为清空本地
    return incoming === null ? (local === null ? 'keep' : 'overwrite') : 'overwrite'
  }
  if (mode === 'keepLocal' && localFieldOccupied) return 'keep'
  return local === null ? (incoming === null ? 'keep' : 'fill') : 'keep'
}

export function previewImportMerge(tokens: BrandTokens, fields: ImportFieldPreview[], mode: ImportMode): ImportMergeSummary {
  const entries: ImportMergeEntry[] = []
  let changeCount = 0
  let fillCount = 0
  let keepCount = 0
  let warningCount = 0

  const pushEntry = (entry: ImportMergeEntry, issue: string | null) => {
    if (entry.action === 'overwrite') changeCount += 1
    if (entry.action === 'fill') fillCount += 1
    if (entry.action === 'keep') keepCount += 1
    if (issue) warningCount += 1
    entries.push({ ...entry, issue })
  }

  fields.forEach((field) => {
    const occupied = fieldHasLocalValue(tokens, field.key)

    if (field.key === 'primary' || field.key === 'secondary') {
      const key = field.key as ColorField
      const local = tokens[key]
      const incoming = field.matched ? (field.values[0] ?? null) : null
      const action = decideAction(mode, local, incoming, occupied, field.matched)
      const result = action === 'keep' ? local : incoming
      const issue = !field.matched ? '字段缺失，保留本地' : incoming === null ? '源值无法识别，该槽位将清空' : null
      pushEntry({ key, label: field.label, slot: undefined, local, incoming, result, action, issue: null }, issue)
      return
    }

    const key = field.key as ScaleField
    const expected = SCALE_LENGTHS[key]
    for (let index = 0; index < expected; index += 1) {
      const local = tokens[key][index] ?? null
      const incoming = field.values[index] ?? null
      const action = decideAction(mode, local, incoming, occupied, field.matched)
      const result = action === 'keep' ? local : incoming
      let issue: string | null = null
      if (!field.matched) issue = '字段缺失，保留本地'
      else if (incoming === null) issue = mode === 'overwrite' && local !== null ? '源值无效，该槽位将清空待补' : '该层源值无效，保留本地/留空'
      pushEntry({ key, label: `${field.label} ${index + 1}`, slot: index, local, incoming, result, action, issue: null }, issue)
    }
  })

  return { entries, changeCount, fillCount, keepCount, warningCount }
}

export function mergeImportedTokens(tokens: BrandTokens, fields: ImportFieldPreview[], mode: ImportMode): BrandTokens {
  const summary = previewImportMerge(tokens, fields, mode)
  const next: BrandTokens = {
    primary: tokens.primary,
    secondary: tokens.secondary,
    radiusScale: [...tokens.radiusScale],
    spacingScale: [...tokens.spacingScale],
    typeScale: [...tokens.typeScale],
  }
  summary.entries.forEach((entry) => {
    if (entry.key === 'primary' || entry.key === 'secondary') {
      next[entry.key] = entry.result as string | null
      return
    }
    const key = entry.key as ScaleField
    if (entry.slot === undefined) return
    next[key][entry.slot] = entry.result as number | null
  })
  return next
}
