import { createRoot } from 'react-dom/client'
import { DigestPage } from '../../src/renderer/ResearchPages'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/scrollbars'
import type { ResearchRun, ResearchRequest } from '../../src/shared/research-explorer'
import appIcon from '../../build/icon-ui.png'
declare global { interface Window { researchFixture: { requests: ResearchRequest[]; imports: string[]; cancel: string[] } } }
const titles = ['Verifier-guided Multimodal Medical Reasoning', 'Reconstruction Models for Robust Anomaly Detection', 'Image–Report Alignment with Independent Evidence', 'Unified Understanding and Generation for Visual Diagnosis', 'Cross-domain Reasoning for Rare Anomalies']
const result: ResearchRun = { id: 'survey', createdAt: '2026-10-09T08:00:00Z', request: { mode: 'survey', topics: ['异常检测'], inspirations: ['LLM-based 异常检测'], publicationYears: 2, preprintMonths: 6, count: 5 }, status: 'complete', progress: '已完成 · 5 篇论文', overview: '验证用模拟数据：从重建误差到推理验证，比较模型机制与评估边界。跨领域的验证器设计可以提供方法思路，但需要通过独立划分、强基线和消融实验验证其迁移效果。', insights: ['推演：引入独立验证器，用相同数据划分对比直接预测与验证流程。', '推演：检查重建误差是否能够成为推理模型的可核验依据。'], warnings: [], sources: titles.map((title, i) => ({ id: `paper-${i}`, title, authors: 'Verification Fixture · Synthetic Authors', date: '2026-09-01', venue: i < 2 ? 'CVPR · 验证用模拟记录' : 'arXiv · 验证用模拟记录', url: `https://arxiv.org/abs/2609.1234${i}`, arxivId: `2609.1234${i}`, abstract: 'Synthetic source material for interaction verification.', group: i < 2 ? 'published' : 'preprint', roles: i === 4 ? ['inspiration'] : ['core'], topics: ['异常检测'], evidenceKind: i === 4 ? 'abstract' : 'full-text' })), items: titles.map((_title, i) => ({ sourceId: `paper-${i}`, summary: '模拟方法以独立证据验证模型预测，并通过可比较的基线分析异常识别与解释的一致性。', method: '将表征学习、独立验证器和可追溯的图像证据结合，避免直接依赖生成文本作为唯一判断依据。', datasets: '模拟记录：独立训练、验证与测试划分，具体数据规模须核查。', evaluation: '比较同一设置下的基线与验证方法，关注异常识别、解释忠实性以及跨域稳健性。', contribution: i === 0 ? 'substantive' : i === 4 ? 'uncertain' : 'incremental', contributionReason: '模拟记录，不代表真实论文评价。', risks: '需要检查患者级数据划分、模型预训练数据重叠，以及代码中是否包含完整评估配置。', transfer: '推演：将验证器作为异常解释的独立约束，并设计保持计算预算一致的对照实验。', evidence: [] })) }
let runs: ResearchRun[] = [{ ...result, id: 'recommend', request: { ...result.request, mode: 'recommend', topics: ['多模态医疗推理'], inspirations: [], count: 5 } }, result]
window.researchFixture = { requests: [], imports: [], cancel: [] }
Object.defineProperty(window, 'singularity', { value: { research: {
  list: async () => [], subscriptions: async () => [{ kind: 'papers', enabled: false, time: '09:00', topics: ['医学诊断'] }],
  discovery: async () => ({ week: '2026-W41', fetchedAt: new Date().toISOString(), papers: [], repositories: [], conferences: [], warnings: [] }),
  explorations: async () => structuredClone(runs),
  explore: async (request: ResearchRequest) => { window.researchFixture.requests.push(request); const run: ResearchRun = { ...result, id: `new-${runs.length}`, request, status: 'collecting', items: [], sources: [], overview: '', insights: [], progress: '正在检索 · 模拟验证' }; runs = [run, ...runs]; return structuredClone(run) },
  importExploration: async (id: string, sourceId: string) => { window.researchFixture.imports.push(`${id}:${sourceId}`); const item = runs.find(r => r.id === id)!.items.find(i => i.sourceId === sourceId)!; item.libraryId = 'local'; return { id: 'local' } },
  cancelExploration: async (id: string) => { window.researchFixture.cancel.push(id); const run = runs.find(r => r.id === id)!; run.status = 'cancelled'; run.progress = '已取消' }, openSource: async () => {},
} } })
createRoot(document.getElementById('root')!).render(<div className="app-shell sidebar-open"><aside className="app-sidebar"><div className="sidebar-brand"><div className="brand-mark"><img src={appIcon} alt=""/></div></div><nav className="sidebar-navigation"><button className="nav-button rail-button">⌂</button><button className="nav-button rail-button active">◇</button><button className="nav-button rail-button">▱</button></nav></aside><header className="titlebar"><span style={{color:'var(--muted)',fontSize:12}}>Singularity · 科研发现交互验证</span></header><main className="main-content" data-chat-theme="blue"><DigestPage kind="papers"/></main></div>)
