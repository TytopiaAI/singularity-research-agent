import { useId, useMemo, useState } from 'react'
import { ChevronRight, ListTree, Minimize2, Network } from 'lucide-react'
import type { FieldKnowledge, FieldSection } from '../shared/field-knowledge'

const NODE_W = 226
const SECTION_H = 80
const PAPER_H = 80
const ROW_GAP = 12
const SECTION_GAP = 24
const COL_ROOT = 0
const COL_SECTION = 300
const COL_PAPER = 618
const BOARD_W = COL_PAPER + NODE_W

const kindLabels: Record<FieldSection['kind'], string> = { development: '发展脉络', evaluation: '数据与评估', insight: '研究推演' }

/** Mind-map view of the synthesised field review: area → section → cited papers. */
export function FieldMindMap({ field, selected, onSelect }: { field: FieldKnowledge; selected: string; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const marker = 'field-mind-' + useId().replace(/:/g, '')

  const toggle = (key: string) => setCollapsed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })

  const layout = useMemo(() => {
    let cursor = 0
    const sections = field.sections.map((section, index) => {
      const key = String(index)
      const open = !collapsed.has(key)
      const papers = open
        ? section.sourceIds.flatMap(id => { const paper = field.papers.find(p => p.id === id); return paper ? [paper] : [] })
        : []
      const children = papers.map((paper, i) => ({ paper, x: COL_PAPER, y: cursor + i * (PAPER_H + ROW_GAP) }))
      const blockHeight = Math.max(SECTION_H, children.length * (PAPER_H + ROW_GAP) - ROW_GAP)
      const y = cursor + blockHeight / 2 - SECTION_H / 2
      cursor += blockHeight + SECTION_GAP
      return { key, section, open, x: COL_SECTION, y, children }
    })
    const height = Math.max(240, cursor - SECTION_GAP)
    const rootY = sections.length ? (sections[0].y + sections[sections.length - 1].y) / 2 : height / 2 - SECTION_H / 2
    const edges: { from: { x: number; y: number }; to: { x: number; y: number }; key: string }[] = []
    for (const node of sections) {
      edges.push({ key: `root-${node.key}`, from: { x: COL_ROOT + NODE_W, y: rootY + SECTION_H / 2 }, to: { x: node.x, y: node.y + SECTION_H / 2 } })
      for (const [index, child] of node.children.entries()) edges.push({ key: `${node.key}-${index}`, from: { x: node.x + NODE_W, y: node.y + SECTION_H / 2 }, to: { x: child.x, y: child.y + PAPER_H / 2 } })
    }
    return { sections, height, rootY, edges, paperCount: sections.reduce((total, node) => total + node.children.length, 0) }
  }, [field.sections, field.papers, collapsed])

  if (!field.sections.length) return <div className="field-empty"><Network size={30}/><h3>思维导图还没有骨架</h3><p>综合综述生成后，这里会按“过去发展 → 当前主线 → 数据与评估 → 未来推演”铺开，每节引用的论文作为分支展开。</p></div>

  return <section className="field-mindmap" aria-label="领域综述思维导图">
    <div className="field-mindmap-toolbar"><span><ListTree size={14}/>{field.sections.length} 个分支 · 展开 {layout.paperCount} 篇引用</span><button type="button" onClick={() => setCollapsed(collapsed.size < field.sections.length ? new Set(field.sections.map((_, i) => String(i))) : new Set())}>{collapsed.size < field.sections.length ? <><Minimize2 size={13}/>全部收起</> : <><ListTree size={13}/>全部展开</>}</button></div>
    <div className="field-mindmap-scroll" tabIndex={0} aria-label="滚动浏览思维导图">
      <div className="field-mindmap-board" style={{ width: BOARD_W, height: layout.height }}>
        <svg className="field-mindmap-edges" width={BOARD_W} height={layout.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="currentColor"/></marker></defs>{layout.edges.map(edge => { const reach = Math.max(36, (edge.to.x - edge.from.x) / 2); return <path key={edge.key} d={`M${edge.from.x},${edge.from.y} C${edge.from.x + reach},${edge.from.y} ${edge.to.x - reach},${edge.to.y} ${edge.to.x},${edge.to.y}`} fill="none" markerEnd={`url(#${marker})`}/> })}</svg>
        <div className="field-mindmap-node field-mindmap-root" style={{ left: COL_ROOT, top: layout.rootY, height: SECTION_H }}><Network size={15}/><strong>{field.title}</strong><small>{field.paperCount} 篇 · v{field.documentVersion}</small></div>
        {layout.sections.map(node => <div key={node.key} className="field-mindmap-group">
          <button type="button" className={`field-mindmap-node field-mindmap-section kind-${node.section.kind}`} style={{ left: node.x, top: node.y, height: SECTION_H }} aria-expanded={node.open} aria-label={`${node.open ? '收起' : '展开'} ${node.section.title}`} onClick={() => toggle(node.key)}><span className="field-mindmap-kind">{kindLabels[node.section.kind]}</span><strong>{node.section.title}</strong><small>{node.section.sourceIds.length} 篇引用</small><ChevronRight size={14} className={node.open ? 'open' : ''}/></button>
          {node.children.map(child => <button type="button" key={child.paper.id} className={`field-mindmap-node field-mindmap-paper${selected === child.paper.id ? ' selected' : ''}`} style={{ left: child.x, top: child.y, height: PAPER_H }} onClick={() => onSelect(child.paper.id)} aria-pressed={selected === child.paper.id}><time>{child.paper.source.date.slice(0, 10) || '日期待核验'}</time><strong>{child.paper.source.title}</strong><span>{child.paper.directions.join(' · ')}{child.paper.source.evidenceKind === 'full-text' ? '' : ' · 仅摘要'}</span></button>)}
        </div>)}
      </div>
    </div>
    <p className="field-mindmap-note">分支标题来自综合综述的结构；点分支可折叠，点论文在关系图谱里定位。时间先后与分支位置不代表方法继承。</p>
  </section>
}
