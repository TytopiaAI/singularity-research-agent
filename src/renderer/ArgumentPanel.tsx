import { useCallback, useEffect, useRef, useState } from 'react'
import { paragraphJobs, natureLabels, type ArgumentPlan, type ProjectMaterial } from '../shared/knowledge'
import './knowledge.css'

export function ArgumentPanel({ paragraphId, materials, register }: { paragraphId: string; materials: ProjectMaterial[]; register: (save: () => Promise<void>) => void }) {
  const [plan, setPlan] = useState<ArgumentPlan | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('')
  const latest = useRef<ArgumentPlan | null>(null), saved = useRef(''), queue = useRef<Promise<unknown>>(Promise.resolve())
  const save = useCallback(async () => {
    const input = latest.current
    if (!input || JSON.stringify(input) === saved.current) { await queue.current; return }
    const result = queue.current.then(() => window.singularity.knowledge.saveArgument(input))
    queue.current = result.catch(() => {})
    await result
    saved.current = JSON.stringify(input); setMessage('论证已保存')
  }, [paragraphId])
  useEffect(() => { register(save) }, [save, register])
  useEffect(() => { let live = true; void window.singularity.knowledge.argument(paragraphId).then((value) => { if (live) { latest.current = value; saved.current = JSON.stringify(value); setPlan(value) } }).catch((e) => { if (live) setError(String(e)) }); return () => { live = false; const input = latest.current; if (input && JSON.stringify(input) !== saved.current) void queue.current.then(() => window.singularity.knowledge.saveArgument(input)).catch(() => {}) } }, [paragraphId])
  useEffect(() => { if (!plan || JSON.stringify(plan) === saved.current) return; const timer = setTimeout(() => void save().catch((e) => setError(String(e))), 600); return () => clearTimeout(timer) }, [plan, save])
  const patch = (change: Partial<ArgumentPlan>) => { if (!latest.current) return; const updated = { ...latest.current, ...change }; latest.current = updated; setPlan(updated); setMessage('正在编辑论证') }
  if (!plan) return <p className="muted">{error || '加载论证骨架…'}</p>
  return <details className="argument-panel"><summary>论证骨架 <small role="status">{message}</small></summary><div className="argument-fields"><label>本段职责<select aria-label="本段职责" value={plan.job} onChange={(event) => patch({ job: event.target.value as ArgumentPlan['job'] })}>{Object.entries(paragraphJobs).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>核心主张<textarea aria-label="核心主张" value={plan.claim} onChange={(event) => patch({ claim: event.target.value })} placeholder="这一段要让读者相信什么？" maxLength={6000} /></label><label>证据与论证路径<textarea aria-label="证据与论证路径" value={plan.evidence} onChange={(event) => patch({ evidence: event.target.value })} placeholder="用哪些结果支持主张？如何从依据得出结论？" maxLength={12000} /></label><label>适用边界与待验证部分<textarea aria-label="适用边界与待验证部分" value={plan.boundary} onChange={(event) => patch({ boundary: event.target.value })} placeholder="哪些是论文事实，哪些只是你的假设？还缺少什么？" maxLength={6000} /></label></div>
    {materials.length ? <div className="argument-evidence-list"><strong>选择项目材料</strong>{materials.map((material) => <label key={material.id}><input type="checkbox" checked={plan.materialIds.includes(material.id)} onChange={(event) => patch({ materialIds: event.target.checked ? [...plan.materialIds, material.id] : plan.materialIds.filter((id) => id !== material.id) })} /><span>{material.title} · {natureLabels[material.nature]} · {material.sourceIds.length} 处原文</span></label>)}</div> : <p className="muted">关联研究项目后，可选择多篇论文的证据材料；也可以先记录自己的论证。</p>}
    <p className="muted">生成时会带上已选择的材料及固定原文编号。引用论文的结果不会被要求改写成你自己的实验结果。</p>{error && <p role="alert" className="inline-error">{error}</p>}<button onClick={() => void save().catch((e) => setError(String(e)))}>保存论证</button>
  </details>
}
