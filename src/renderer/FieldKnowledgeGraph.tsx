import { useId, useMemo, useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { fieldRelationLabels, layoutFieldGraph, type FieldKnowledge } from '../shared/field-knowledge'

export function FieldKnowledgeGraph({ field, selected, onSelect }: { field: FieldKnowledge; selected: string; onSelect: (id: string) => void }) {
  const [direction, setDirection] = useState(''), [unit, setUnit] = useState<'month' | 'year'>('month'), [zoom, setZoom] = useState(1), [similar, setSimilar] = useState(false)
  const marker = 'field-arrow-' + useId().replace(/:/g, '')
  const graph = useMemo(() => layoutFieldGraph(field.papers, [...field.relations, ...(similar ? field.papers.slice(0,100).flatMap((p,i,all)=>all.slice(i+1).filter(q=>p.directions.some(d=>d!=='待归类'&&q.directions.includes(d))).slice(0,2).map(q=>({id:`similar-${p.id}-${q.id}`,from:p.id,to:q.id,kind:'similar' as const,reason:'共享方法方向标签，属于相似候选，并非已验证的方法继承'}))) : [])], direction, unit), [field.papers, field.relations, direction, unit, similar])
  const directions = [...new Set(field.papers.flatMap(p => p.directions))].sort()
  return <section className="field-graph" aria-label="领域方向时间图谱">
    <div className="field-graph-controls"><label><input type="checkbox" checked={similar} onChange={e=>setSimilar(e.target.checked)}/>显示相似候选</label><label>方向<select aria-label="图谱方向" value={direction} onChange={e => setDirection(e.target.value)}><option value="">全部方向</option>{directions.map(d => <option key={d}>{d}</option>)}</select></label><label>时间粒度<select aria-label="图谱时间粒度" value={unit} onChange={e => setUnit(e.target.value as 'month' | 'year')}><option value="month">按月</option><option value="year">按年</option></select></label><div><button aria-label="缩小图谱" disabled={zoom <= .65} onClick={() => setZoom(v => Math.max(.65,v-.1))}><Minus size={14}/></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大图谱" disabled={zoom >= 1.4} onClick={() => setZoom(v => Math.min(1.4,v+.1))}><Plus size={14}/></button><button aria-label="重置图谱" onClick={() => { setZoom(1); setDirection('') }}><RotateCcw size={14}/></button></div></div>
    <p className="field-graph-legend"><span>╌╌ 同方向的发表时间顺序</span><span>━ 手动关系 · 紫色为相似候选</span><span>时间先后不代表继承或性能更优</span></p>
    {!field.papers.length ? <div className="field-empty">先检索这个领域的论文，完成分析后会自动出现在这里。</div> : <div className="field-graph-scroll" tabIndex={0} aria-label="滚动浏览图谱"><div style={{ width: graph.width * zoom, height: graph.height * zoom }}><div className="field-graph-board" style={{ width: graph.width, height: graph.height, transform: `scale(${zoom})` }}>
      <span className="field-graph-axis">方向 / 发表日期 →</span>
      {graph.dates.map((date,i) => <div className="field-date-column" key={date} style={{ left: 170+i*254, height: graph.height }}><strong>{date}</strong></div>)}
      {graph.lanes.map(lane => <div className="field-graph-lane" key={lane.title} style={{ top: lane.y, height: lane.height, width: graph.width }}><strong>{lane.title}</strong><small>{field.papers.filter(p => p.directions.includes(lane.title)).length} 篇</small></div>)}
      <svg className="field-graph-edges" width={graph.width} height={graph.height} aria-label="图谱连线"><defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8" fill="currentColor"/></marker></defs>{graph.edges.map((edge,i) => {
        const a = graph.nodes.find(n => n.key === edge.from)!, b = graph.nodes.find(n => n.key === edge.to)!
        const sameColumn = a.x === b.x
        const x1 = sameColumn ? a.x+112 : a.x+226, y1 = sameColumn ? a.y+108 : a.y+54
        const x2 = sameColumn ? b.x+112 : b.x, y2 = sameColumn ? b.y : b.y+54
        return <path key={i} className={edge.relation ? 'field-mechanism-edge' : 'field-time-edge'} data-relation={edge.relation?.kind ?? 'chronology'} d={sameColumn ? `M${x1},${y1} C${x1+24},${y1+10} ${x2+24},${y2-10} ${x2},${y2}` : `M${x1},${y1} C${x1+24},${y1} ${x2-24},${y2} ${x2},${y2}`} fill="none" markerEnd={`url(#${marker})`}><title>{edge.relation ? `${fieldRelationLabels[edge.relation.kind]}：${edge.relation.reason}` : '发表日期先后；不代表继承关系'}</title></path>
      })}</svg>
      {graph.nodes.map(node => <button type="button" key={node.key} className={`field-paper-node ${selected === node.paper.id ? 'selected' : ''}`} aria-label={`查看论文 ${node.paper.source.title}（${node.direction}）`} aria-pressed={selected === node.paper.id} onClick={() => onSelect(node.paper.id)} style={{ left: node.x, top: node.y }}><time>{node.paper.source.date.slice(0,10) || '日期待核验'}</time><strong>{node.paper.source.title}</strong><span>{node.paper.source.evidenceKind === 'full-text' ? '已采集原文' : '仅摘要 · 待核验'} · {node.paper.curated ? '手动归类' : '自动归类'}</span></button>)}
    </div></div></div>}
    {field.papers.length > graph.shown && <p className="muted">当前图谱显示 {graph.shown} 篇；可按方向缩小范围。文档保留全部已收录论文。</p>}
  </section>
}
