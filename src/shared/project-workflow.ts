export type ProjectStage = 'method' | 'experiment' | 'writing'
export const projectStageLabels: Record<ProjectStage, string> = { method: '方法确立', experiment: '实验', writing: '写作' }
export type ProjectEntryKind = 'method' | 'experiment' | 'discussion'
export type ExperimentStatus = 'planned' | 'running' | 'complete' | 'failed'
export const experimentStatusLabels: Record<ExperimentStatus, string> = { planned: '计划中', running: '运行中', complete: '已完成', failed: '未达预期 / 失败' }
export interface ProjectWorkflow {
  projectId: string; stage: ProjectStage; completed: boolean; activeMethodId: string | null
  history: { stage: ProjectStage; reason: string; at: string }[]
  writingIds: string[]
}
export interface ProjectEntry {
  id: string; projectId: string; kind: ProjectEntryKind; title: string; description: string
  methodId: string | null; version: number; status: ExperimentStatus
  dataset: string; setup: string; command: string; result: string; conclusion: string; nextStep: string
  sourceIds: string[]; origin: 'manual' | 'voice'; createdAt: string; updatedAt: string
}
export type ProjectEntryInput = Pick<ProjectEntry, 'projectId' | 'kind' | 'title' | 'description'> & Partial<Pick<ProjectEntry, 'id' | 'methodId' | 'status' | 'dataset' | 'setup' | 'command' | 'result' | 'conclusion' | 'nextStep' | 'sourceIds' | 'origin'>>
