const zh = {
  appName: 'Singularity', assistant: '助手', tasks: '任务', papers: '论文库', files: '文件',
  settings: '设置', status: '运行状态', newTask: '新任务', ready: '就绪', starting: '正在启动',
  stopped: '已停止', stopping: '正在停止', error: '异常', importPaper: '导入 PDF', searchPapers: '搜索标题、作者或全文',
  emptyPapers: '还没有论文', emptyPapersHint: '导入文字型 PDF，开始阅读、总结与翻译。', title: '标题',
  authors: '作者', year: '年份', pages: '页', indexed: '已索引', needsOcr: '需要 OCR', missing: '文件已失效',
  openReader: '阅读', remove: '移除', relocate: '重新定位', confirmRemovePaper: '只会移除索引和生成产物，不会删除原 PDF。确定继续？',
  previousPage: '上一页', nextPage: '下一页', zoomOut: '缩小', zoomIn: '放大', sourceText: '本页文本',
  summary: '结构化总结', fullTranslation: '全文翻译', selectionTranslation: '翻译选中内容', artifacts: '产物',
  selectHint: '在本页文本中选中一段内容，即可即时翻译。', noArtifacts: '还没有生成结果。',
  taskStarted: '任务已创建，可在“任务”中查看进度。', close: '关闭', addWorkspace: '添加工作区',
  emptyWorkspace: '尚未添加受管工作区', emptyWorkspaceHint: 'Singularity 只显示你明确添加的文件夹。',
  searchFiles: '搜索当前工作区', openInExplorer: '在资源管理器中显示', modelProvider: '模型服务',
  providerKind: '接口类型', deepseek: '官方接口', compatible: 'OpenAI 兼容', displayName: '显示名称',
  baseUrl: 'Base URL', modelId: '模型 ID', apiKey: 'API Key', apiKeySaved: '密钥已加密保存；留空表示不修改。',
  maxOutput: '最大输出 Token', save: '保存', testConnection: '测试连接', makeActive: '设为当前', active: '当前',
  confirmRemoveProvider: '确定移除这个模型配置及其加密密钥吗？',
  appearance: '外观', light: '冷白', dark: '深色', permissions: '权限', permissionCopy: '新任务默认 workspace-write + ask。完全访问必须在 Agent 中显式开启并确认风险。',
  dataLocation: '数据位置', restartHarness: '重启 Agent', pendingRestart: '模型配置等待重启',
  runtime: 'Agent', modelConnection: '模型配置', runningTasks: '运行任务', port: '回环端口', versions: '版本',
  diagnostics: '诊断', logs: '脱敏日志', noLogs: '暂无日志', configured: '已配置', unconfigured: '未配置',
  dataRoot: '数据目录', database: '数据库', loading: '正在加载…', connecting: '正在连接...', importFailed: '导入失败', operationFailed: '连接失败',
  retry: '重试', searchResults: '检索结果', noSearchResults: '没有匹配内容', taskViewHint: 'Agent 会话即任务；在这里搜索、切换和管理任务。',
  chatViewHint: '正在连接本地 Agent…', providerSaved: '模型配置已保存。', connectionOk: '连接正常',
} as const

export type I18nKey = keyof typeof zh
export const t = (key: I18nKey): string => zh[key]
