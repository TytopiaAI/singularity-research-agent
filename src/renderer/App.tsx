import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot, Check, CircleAlert, Database,
  FileSearch, House, LibraryBig, Minus,
  Moon, Plus, RefreshCw, Settings, Sparkles, Square, Sun, Trash2, History,
  X, PanelLeftClose, PanelLeftOpen, FilePenLine, AudioLines, FlaskConical, Puzzle, CalendarDays,
  Image as ImageIcon,
} from 'lucide-react'
import appIconUrl from '../../build/icon-ui.png'
import { t } from './i18n'
import { StartupSplash } from './StartupSplash'
import { WelcomeGuide } from './WelcomeGuide'
import { useStartupSequence } from './startup-sequence'
import { isChatTheme, type ChatTheme } from '../shared/chat-theme'
import { HARNESS_VERSION } from '../shared/harness-version'
import type {
  DiagnosticInfo,
  ProviderConfig, ProviderConfigInput, RuntimeStatus,
} from '../shared/types'

// Load the larger research, PDF and voice modules when their page opens.
const DigestPage = lazy(() => import('./ResearchPages').then(m => ({ default: m.DigestPage })))
const LibraryWorkspace = lazy(() => import('./LibraryWorkspace').then(m => ({ default: m.LibraryWorkspace })))
const WritingWorkspace = lazy(() => import('./WritingStudio').then(m => ({ default: m.WritingStudio })))
const VoiceWorkspace = lazy(() => import('./VoiceWorkspace').then(m => ({ default: m.VoiceWorkspace })))
const ResearchProjects = lazy(() => import('./ResearchProjects').then(m => ({ default: m.ResearchProjects })))
const PlanningWorkspace = lazy(() => import('./PlanningWorkspace').then(m => ({ default: m.PlanningWorkspace })))
const PlanningGallery = lazy(() => import('./PlanningGallery').then(m => ({ default: m.PlanningGallery })))
const ImageWorkspace = lazy(() => import('./ImageWorkspace').then(m => ({ default: m.ImageWorkspace })))

type Route = 'plans' | 'plan-gallery' | 'assistant' | 'plugins' | 'papers' | 'settings' | 'status' | 'paper-digest' | 'news' | 'writing' | 'voice' | 'projects' | 'images'
type Theme = 'light' | 'dark'

const iconSize = 18

export function App(): ReactNode {
  const [route, setRoute] = useState<Route>('assistant')
  const [chatTheme, setChatTheme] = useState<ChatTheme>('warm')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('singularity-theme') as Theme) || 'light')
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('singularity-sidebar') !== 'closed')
  const [runtime, setRuntime] = useState<RuntimeStatus>({ phase: 'starting', harnessVersion: HARNESS_VERSION, electronVersion: '', port: null, url: null, runningTasks: 0, pendingRestart: false })
  const { complete: startupComplete, leaving: startupLeaving, skip: skipStartup } = useStartupSequence(runtime.phase)
  const [welcomeOpen, setWelcomeOpen] = useState(() => localStorage.getItem('singularity-welcome-complete') !== 'done')
  const closeWelcome = () => { localStorage.setItem('singularity-welcome-complete', 'done'); setWelcomeOpen(false) }
  const harnessHost = useRef<HTMLDivElement>(null)
  const [currentPaperId, setCurrentPaperId] = useState<string | null>(null)
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => localStorage.getItem('singularity-current-project'))
  const [readerRequest, setReaderRequest] = useState<{ paperId: string; sourceId?: string; nonce: number } | null>(null)
  const [voiceMode, setVoiceMode] = useState<'paper' | 'project' | undefined>()
  const [writingRequest, setWritingRequest] = useState<string | null>(null)
  const openSource = useCallback((paperId: string, sourceId?: string) => { setCurrentPaperId(paperId); setReaderRequest({ paperId, sourceId, nonce: Date.now() }); setRoute('papers') }, [])
  useEffect(() => { if (currentProjectId) localStorage.setItem('singularity-current-project', currentProjectId); else localStorage.removeItem('singularity-current-project') }, [currentProjectId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('singularity-theme', theme)
    void window.singularity.runtime.setTheme(theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('singularity-sidebar', sidebarOpen ? 'open' : 'closed')
  }, [sidebarOpen])

  useEffect(() => {
    let active = true
    let changed = false
    const update = (value: ChatTheme): void => { if (active && isChatTheme(value)) setChatTheme(value) }
    const unsubscribe = window.singularity.runtime.onChatTheme(value => { changed = true; update(value) })
    void window.singularity.runtime.getChatTheme().then(value => { if (!changed) update(value) })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    void window.singularity.runtime.get().then(setRuntime)
    return window.singularity.runtime.onStatus(setRuntime)
  }, [])

  useEffect(() => {
    const host = harnessHost.current
    const visible = (route === 'assistant' || route === 'plugins') && startupComplete && !welcomeOpen && runtime.phase === 'ready' && runtime.viewReady !== false
    const sendBounds = (): void => {
      const bounds = host?.getBoundingClientRect()
      void window.singularity.runtime.setHarnessView(bounds ? {
        x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, visible,
      } : { x: 0, y: 0, width: 1, height: 1, visible: false })
    }
    sendBounds()
    if (visible) void window.singularity.runtime.assistantAction(route === 'plugins' ? 'plugins' : 'assistant')
    const observer = host ? new ResizeObserver(sendBounds) : null
    if (host) observer?.observe(host)
    window.addEventListener('resize', sendBounds)
    return () => { observer?.disconnect(); window.removeEventListener('resize', sendBounds); void window.singularity.runtime.setHarnessView({ x: 0, y: 0, width: 1, height: 1, visible: false }) }
  }, [route, sidebarOpen, startupComplete, welcomeOpen, runtime.phase, runtime.viewReady])

  const sidebarItems: Array<{ id: Route; label: string; icon: ReactNode }> = [
    { id: 'assistant', label: '首页', icon: <House size={22} strokeWidth={1.9} /> },
    { id: 'voice', label: '语音对话', icon: <AudioLines size={iconSize} /> },
    { id: 'paper-digest', label: '科研发现', icon: <FileSearch size={iconSize} /> },
    { id: 'news', label: '消息订阅', icon: <Sparkles size={iconSize} /> },
    { id: 'papers', label: t('papers'), icon: <LibraryBig size={iconSize} /> },
    { id: 'projects', label: '研究项目', icon: <FlaskConical size={iconSize} /> },
    { id: 'writing', label: '论文写作', icon: <FilePenLine size={iconSize} /> },
    { id: 'images', label: '图片生成', icon: <ImageIcon size={iconSize} /> },
    { id: 'plugins', label: '插件管理', icon: <Puzzle size={iconSize} /> },
    { id: 'plans', label: '计划', icon: <CalendarDays size={iconSize} /> },
  ]

  return <div className={`app-shell ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${startupComplete ? '' : 'startup-active'}`}>
    {startupComplete && welcomeOpen && <WelcomeGuide onClose={closeWelcome} saveModel={input => window.singularity.providers.save(input).then(saved => window.singularity.providers.activate(saved.id).then(() => {}))} saveVoice={input => window.singularity.voice.saveSettings(input).then(() => {})} />}
    <aside className="app-sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
      <div className="sidebar-brand" aria-label="Singularity"><div className="brand-mark"><img src={appIconUrl} alt="" /></div></div>
      <nav className="sidebar-navigation" aria-label="Singularity">
        {sidebarItems.map((item) => <NavButton key={item.id} {...item} rail active={route === item.id || item.id === 'plans' && route === 'plan-gallery'} onClick={() => { if(item.id==='voice')setVoiceMode(undefined);setRoute(item.id) }} />)}
      </nav>
    </aside>
    <header className="titlebar">
      <button className="sidebar-toggle" aria-label={sidebarOpen ? '隐藏侧边栏' : '显示侧边栏'} onClick={() => setSidebarOpen((open) => !open)}>
        {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </button>
      <nav className="top-navigation" aria-label="Singularity">
        {route === 'plugins' && <span className="plugin-profile-note">Singularity 插件 · 与官方版独立配置</span>}
        {route === 'assistant' && <>
          <TopIconButton label="新建会话" icon={<Plus size={19} />} onClick={() => void window.singularity.runtime.assistantAction('new')} />
          <TopIconButton label="会话历史" tooltip="会话" icon={<History size={19} />} onClick={() => void window.singularity.runtime.assistantAction('history')} />
        </>}
        <TopIconButton label={t('settings')} icon={<Settings size={19} />} active={route === 'settings'} onClick={() => setRoute('settings')} />
      </nav>
      <button className={`runtime-pill ${route === 'status' ? 'active' : ''}`} aria-label={`运行状态：${runtime.phase === 'ready' ? t('ready') : t(runtime.phase as 'starting')}`} title="运行状态" onClick={() => setRoute('status')}>
        <StatusDot phase={runtime.phase} />
        {runtime.runningTasks > 0 && <span className="count-pill">{runtime.runningTasks}</span>}
      </button>
      <div className="window-actions">
        <button aria-label="minimize" onClick={() => void window.singularity.windowControls.minimize()}><Minus size={15} /></button>
        <button aria-label="maximize" onClick={() => void window.singularity.windowControls.toggleMaximize()}><Square size={12} /></button>
        <button className="window-close" aria-label="close" onClick={() => void window.singularity.windowControls.close()}><X size={15} /></button>
      </div>
    </header>
    <main className="main-content" data-chat-theme={chatTheme}>
      <Suspense fallback={<div className="connection-state" role="status">正在打开…</div>}>
      {(route === 'assistant' || route === 'plugins') && <div ref={harnessHost} className="harness-host">
        {(runtime.phase === 'starting' || runtime.phase === 'ready' && runtime.viewReady === false) && <div className="connection-state" role="status"><div><p>{runtime.phase === 'ready' ? '正在打开助手…' : '正在启动研究引擎…'}</p><p>可以先使用论文库、计划等本地功能。</p></div></div>}
        {runtime.phase === 'error' && <div className="connection-state error">{t('operationFailed')}</div>}
      </div>}
      {route === 'papers' && <LibraryWorkspace request={readerRequest} onCurrentPaper={setCurrentPaperId} />}
      {route === 'writing' && <WritingWorkspace initialProjectId={writingRequest} onResearchProject={id => { setCurrentProjectId(id); setRoute('projects') }} />}
      {route === 'images' && <ImageWorkspace />}
      {route === 'voice' && <VoiceWorkspace currentPaperId={currentPaperId} currentProjectId={currentProjectId} initialMode={voiceMode} onOpenSource={openSource} />}
      {route === 'projects' && <ResearchProjects currentId={currentProjectId} onSelect={setCurrentProjectId} onOpen={openSource} onVoice={() => { setVoiceMode('project'); setRoute('voice') }} onDiscover={() => setRoute('paper-digest')} onWriting={id => { setWritingRequest(id); setRoute('writing') }} onAssistant={() => setRoute('assistant')} />}
      {route === 'paper-digest' && <DigestPage key="papers" kind="papers" currentProjectId={currentProjectId} onProject={id => { setCurrentProjectId(id); setRoute('projects') }} />}
      {route === 'news' && <DigestPage key="news" kind="news" />}
      {route === 'plans' && <PlanningWorkspace theme={chatTheme} onGallery={() => setRoute('plan-gallery')} />}
      {route === 'plan-gallery' && <PlanningGallery onBack={() => setRoute('plans')} />}
      {route === 'settings' && <SettingsPage theme={theme} setTheme={setTheme} runtime={runtime} />}
      {route === 'status' && <StatusPage runtime={runtime} />}
      </Suspense>
    </main>
    {!startupComplete && <StartupSplash ready={runtime.phase === 'ready'} leaving={startupLeaving} onSkip={skipStartup} />}
  </div>
}

function TopIconButton({ label, tooltip = label, icon, active = false, onClick }: { label: string; tooltip?: string; icon: ReactNode; active?: boolean; onClick: () => void }): ReactNode {
  return <button className={`top-icon-button ${active ? 'active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} title={tooltip} onClick={onClick}>{icon}<span className="top-icon-tooltip" aria-hidden="true">{tooltip}</span></button>
}

function NavButton({ label, icon, active, onClick, rail = false }: { label: string; icon: ReactNode; active: boolean; onClick: () => void; rail?: boolean }): ReactNode {
  return <button className={`nav-button ${rail ? 'rail-button' : ''} ${active ? 'active' : ''}`} aria-label={label} aria-current={active ? 'page' : undefined} title={rail ? label : undefined} onClick={onClick}>{icon}<span className={rail ? 'nav-tooltip' : undefined} aria-hidden={rail}>{label}</span></button>
}

function StatusDot({ phase }: { phase: RuntimeStatus['phase'] }): ReactNode {
  return <span className={`status-dot ${phase}`} />
}

function PageHeader({ eyebrow, title, actions }: { eyebrow?: string; title: string; actions?: ReactNode }): ReactNode {
  return <div className="page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1></div><div className="header-actions">{actions}</div></div>
}

function SettingsPage({ theme, setTheme, runtime }: { theme: Theme; setTheme: (theme: Theme) => void; runtime: RuntimeStatus }): ReactNode {
  const blank: ProviderConfigInput = { kind: 'deepseek', displayName: 'Singularity', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-chat', maxOutputTokens: 8192 }
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [form, setForm] = useState<ProviderConfigInput>(blank)
  const [message, setMessage] = useState('')
  const [dataRoot, setDataRoot] = useState('')
  const refresh = useCallback(() => window.singularity.providers.list().then(setProviders), [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void window.singularity.runtime.diagnostics().then((info) => setDataRoot(info.dataRoot)) }, [])
  const select = (provider: ProviderConfig): void => setForm({ id: provider.id, kind: provider.kind, displayName: provider.displayName, baseUrl: provider.baseUrl, modelId: provider.modelId, maxOutputTokens: provider.maxOutputTokens })
  const save = async (): Promise<void> => { try { await window.singularity.providers.save(form); setMessage(t('providerSaved')); await refresh() } catch (error) { setMessage(String(error)) } }
  const test = async (): Promise<void> => { const result = await window.singularity.providers.test(form); setMessage(`${result.ok ? '✓' : '×'} ${result.message} · ${result.latencyMs}ms${result.status ? ` · HTTP ${result.status}` : ''}`) }
  const activate = async (): Promise<void> => { if (!form.id) return; await window.singularity.providers.activate(form.id); await refresh() }
  const remove = async (): Promise<void> => { if (!form.id || !confirm(t('confirmRemoveProvider'))) return; await window.singularity.providers.remove(form.id); setForm(blank); await refresh() }
  return <section className="page settings-page"><PageHeader eyebrow="CONFIGURATION" title={t('settings')} />
    <div className="settings-grid"><section className="settings-card provider-card"><div className="card-heading"><Bot size={18} /><div><h2>{t('modelProvider')}</h2><p>官方接口 / OpenAI Chat Completions</p></div></div>
      {providers.length > 0 && <div className="provider-chips">{providers.map((provider) => <button key={provider.id} className={provider.active ? 'active' : ''} onClick={() => select(provider)}>{provider.displayName}{provider.active && <Check size={13} />}</button>)}<button onClick={() => setForm(blank)}><Plus size={13} /></button></div>}
      <div className="form-grid"><label>{t('providerKind')}<select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as ProviderConfigInput['kind'] })}><option value="deepseek">{t('deepseek')}</option><option value="openai-compatible">{t('compatible')}</option></select></label>
        <label>{t('displayName')}<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
        <label className="full">{t('baseUrl')}<input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></label>
        <label>{t('modelId')}<input value={form.modelId} onChange={(event) => setForm({ ...form, modelId: event.target.value })} /></label>
        <label>{t('maxOutput')}<input type="number" value={form.maxOutputTokens} onChange={(event) => setForm({ ...form, maxOutputTokens: Number(event.target.value) })} /></label>
        <label className="full">{t('apiKey')}<input type="password" value={form.apiKey ?? ''} placeholder={form.id ? t('apiKeySaved') : 'sk-…'} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></label></div>
      {message && <div className="form-message">{message}</div>}<div className="card-actions">{form.id && <button className="danger-text" onClick={() => void remove()}><Trash2 size={14} />{t('remove')}</button>}{form.id && !providers.find((item) => item.id === form.id)?.active && <button onClick={() => void activate()}>{t('makeActive')}</button>}<button onClick={() => void test()}>{t('testConnection')}</button><button className="primary" onClick={() => void save()}>{t('save')}</button></div>
    </section>
    <section className="settings-card"><div className="card-heading"><Sun size={18} /><div><h2>{t('appearance')}</h2><p>Local interface theme</p></div></div><div className="segmented"><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><Sun size={15} />{t('light')}</button><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><Moon size={15} />{t('dark')}</button></div></section>
    <section className="settings-card"><div className="card-heading"><CircleAlert size={18} /><div><h2>{t('permissions')}</h2><p>{t('permissionCopy')}</p></div></div></section>
    <section className="settings-card"><div className="card-heading"><Database size={18} /><div><h2>{t('dataLocation')}</h2><p>{dataRoot || '—'}</p></div></div><button disabled={!dataRoot} onClick={() => void window.singularity.nativeFiles.show(dataRoot)}>{t('openInExplorer')}</button></section>
    </div>{runtime.pendingRestart && <div className="pending-banner"><CircleAlert size={16} />{t('pendingRestart')}<button onClick={() => void window.singularity.runtime.restart()}>{t('restartHarness')}</button></div>}
  </section>
}

function StatusPage({ runtime }: { runtime: RuntimeStatus }): ReactNode {
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null)
  const [providerCount, setProviderCount] = useState(0)
  const refresh = useCallback(() => {
    void window.singularity.runtime.diagnostics().then(setDiagnostics)
    void window.singularity.providers.list().then((items) => setProviderCount(items.length))
  }, [])
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3_000); return () => clearInterval(timer) }, [refresh])
  return <section className="page"><PageHeader eyebrow="LOCAL RUNTIME" title={t('status')} actions={<button onClick={() => void window.singularity.runtime.restart()}><RefreshCw size={15} />{t('restartHarness')}</button>} />
    <div className="metric-grid"><Metric label={t('runtime')} value={runtime.phase === 'ready' ? t('ready') : runtime.phase} tone={runtime.phase === 'ready' ? 'good' : 'neutral'} /><Metric label={t('modelConnection')} value={providerCount ? t('configured') : t('unconfigured')} /><Metric label={t('runningTasks')} value={String(runtime.runningTasks)} /><Metric label={t('port')} value={runtime.port ? `127.0.0.1:${runtime.port}` : '—'} /></div>
    <div className="diagnostic-grid"><section className="settings-card"><div className="section-label">{t('versions')}</div><dl><dt>Singularity</dt><dd>0.1.0</dd><dt>Electron</dt><dd>{runtime.electronVersion || '44.2.0'}</dd><dt>Agent Runtime</dt><dd>{runtime.harnessVersion}</dd></dl></section><section className="settings-card"><div className="section-label">{t('dataLocation')}</div><dl><dt>{t('dataRoot')}</dt><dd>{diagnostics?.dataRoot}</dd><dt>{t('database')}</dt><dd>{diagnostics?.databasePath}</dd></dl></section></div>
    <section className="log-panel"><div className="section-label">{t('logs')}</div><pre>{diagnostics?.logs.slice(-80).join('\n') || t('noLogs')}</pre></section>
  </section>
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }): ReactNode { return <div className="metric"><span>{label}</span><strong className={tone}>{value}</strong></div> }
