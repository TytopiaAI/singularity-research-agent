import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, shell, WebContentsView,
  type IpcMainInvokeEvent,
} from 'electron'
import { createAppPaths, isPathInside, packagedDataRoot, projectRoot } from './paths'
import { HarnessRuntime } from './harness-runtime'
import { HarnessApi } from './harness-api'
import { DesktopBrowserGuests } from './harness-browser-guests'
import { PaperRepository } from './paper-repository'
import { DigestService } from './digest-service'
import { discoveryFeed } from './discovery-service'
import { ProviderStore } from './provider-store'
import { VoiceService } from './voice-service'
import { BreezeVoice } from './breeze-voice'
import { CloudVoice } from './cloud-voice'
import { ImageService } from './image-service'
import type { CloudVoiceProvider } from '../shared/voice'
import { KnowledgeStore } from './knowledge-store'
import { PlanningStore } from './planning-store'
import { LatexStore } from './latex-store'
import { LatexCompilerService } from './latex-compiler'
import { registerLatexIpc } from './latex-ipc'
import { WritingLatexService } from './writing-latex'
import { registerKnowledgeIpc } from './knowledge-ipc'
import { DocumentTranslationService } from './document-translation'
import type { TranslationScope } from '../shared/document-translation'
import { isTranslatableParagraph } from '../shared/academic-text'
import { redact } from './redaction'
import { ChatThemeStore } from './chat-theme-store'
import { applyWindowsBackdrop, keepWindowsBackdrop } from './window-backdrop'
import { keepDesktopBackdrop, readDesktopBackdrop } from './desktop-backdrop'
import { ResearchExplorer } from './research-explorer'
import { DesktopTray } from './desktop-tray'
import { chatAppearanceCss } from './chat-appearance-style'
import { validateQuestionContexts } from '../shared/reader-question-context'
import { fieldBriefText } from '../shared/project-chat'
import { mentionToken, type MentionItem } from '../shared/mentions'
import type { ArtifactKind, HarnessViewBounds, ProviderConfigInput, ReaderRect, ReaderSegment, WritingSectionKey, WritingReviewMode } from '../shared/types'

protocol.registerSchemesAsPrivileged(['singularity-paper','singularity-latex'].map(scheme=>({scheme,privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}})))

const resourceRoot = app.isPackaged ? app.getAppPath() : projectRoot()
if(app.isPackaged&&fs.existsSync(path.resolve(resourceRoot,'..','..','.singularity-update.lock'))){
  dialog.showErrorBox('Singularity 正在更新','请等待更新完成后再启动。如果更新意外中断，请运行日常更新或 update:recover 恢复，已有数据不会被删除。')
  app.exit(0)
}
const dataRoot = process.env.SINGULARITY_DATA_ROOT
  ?? (app.isPackaged ? packagedDataRoot(resourceRoot) : path.join(resourceRoot, '.local-data'))
const paths = createAppPaths({ resourceRoot, dataRoot })
process.env.TEMP = paths.temp
process.env.TMP = paths.temp
process.env.ELECTRON_CACHE = path.join(paths.cache, 'electron')
app.setName('Singularity')
app.setAppUserModelId('ai.singularity.desktop')
app.setPath('userData', paths.electron)
app.setPath('sessionData', path.join(paths.electron, 'session'))
app.setPath('cache', paths.cache)
app.setPath('logs', paths.logs)
app.setPath('crashDumps', path.join(paths.logs, 'crash-dumps'))

const providers = new ProviderStore(paths, (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init))
const chatAppearance = new ChatThemeStore(paths.config)
const breezeVoice = new BreezeVoice(paths.config, paths.cache, (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init))
const cloudVoice = new CloudVoice(breezeVoice, (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init))
const voice = new VoiceService(providers, breezeVoice, cloudVoice)
// Reuses the encrypted MiniMax credential already owned by voice settings.
const images = new ImageService(paths.config, paths.cache, breezeVoice, (url, init) => net.fetch(url instanceof URL ? url.toString() : url, init))
const repository = new PaperRepository(paths)
const documentTranslations = new DocumentTranslationService(paths.artifacts, (id) => repository.get(id), (system, input) => providers.researchReply(system, input))
const knowledge = new KnowledgeStore(paths, repository)
const planning = new PlanningStore(paths.database)
const latex = new LatexStore(paths.data)
const writingLatex = new WritingLatexService(repository,latex)
const latexCompiler = new LatexCompilerService(latex,paths.data,(url,init)=>net.fetch(url instanceof URL?url.toString():url,init))
const runtime = new HarnessRuntime(paths, providers)
const browserGuests = new DesktopBrowserGuests(() => runtime.status().url ?? undefined)
const harnessApi = new HarnessApi(() => runtime.status().url, () => runtime.launchUrl())
const digests = new DigestService(paths, harnessApi, repository, async () => runtime.status().phase === 'ready' && (await providers.list()).some((p) => p.active && p.hasCredential), planning)
const researchExplorer = new ResearchExplorer(paths, repository, (system, input, signal) => providers.researchReply(system, input, undefined, signal))
let mainWindow: BrowserWindow | null = null
let desktopTray: DesktopTray | null = null
let harnessView: WebContentsView | null = null
let requestedHarnessBounds: HarnessViewBounds | null = null
let harnessTheme: 'light' | 'dark' = 'light'
let harnessPanel: 'plugins' | 'assistant' = 'assistant'
let quitting = false

function restoreMainWindow(): void {
  if (quitting || !mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function logMain(message: string, error?: unknown): void {
  const suffix = error === undefined ? '' : ` ${redact(error)}`
  fs.appendFileSync(path.join(paths.logs, 'main.log'), `[${new Date().toISOString()}] ${message}${suffix}\n`, 'utf8')
}

logMain(`process started (packaged=${String(app.isPackaged)})`)
process.on('uncaughtException', (error) => logMain('uncaught exception', error))
process.on('unhandledRejection', (error) => logMain('unhandled rejection', error))

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window !== mainWindow) throw new Error('拒绝未知窗口的 IPC 请求。')
  return window
}

function registerIpc(): void {
  const browserSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== harnessView?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('拒绝未知浏览器请求')
    const origin = runtime.status().url
    if (!origin || new URL(event.senderFrame.url).origin !== new URL(origin).origin) throw new Error('拒绝未知浏览器来源')
  }
  ipcMain.handle('mentions:catalog', async (event) => {
    browserSender(event)
    const fields: MentionItem[] = researchExplorer.fields.list().map((field) => ({ kind: 'field', id: field.id, title: field.title, detail: `${field.paperCount} 篇`, mention: mentionToken('field', field.title, field.id) }))
    const papers: MentionItem[] = (await repository.list()).filter((paper) => !paper.deletedAt).map((paper) => ({ kind: 'paper', id: paper.id, title: paper.title, detail: [paper.year, paper.authors?.[0]].filter(Boolean).join(' · '), mention: mentionToken('paper', paper.title, paper.id) }))
    return { fields, papers }
  })
  ipcMain.handle('harness-browser:acquire', (event, workspace: unknown) => { browserSender(event); return browserGuests.acquire(event.sender, workspace) })
  ipcMain.handle('harness-browser:release', (event, lease: unknown) => { browserSender(event); return browserGuests.release(event.sender, lease) })
  const appearanceSender = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow?.webContents && event.sender !== harnessView?.webContents) throw new Error('拒绝未知视图的外观请求')
  }
  ipcMain.handle('appearance:get-chat-theme', event => { appearanceSender(event); return chatAppearance.get() })
  ipcMain.handle('appearance:set-chat-theme', (event, value: unknown) => {
    appearanceSender(event)
    const saved = chatAppearance.set(value)
    for (const contents of [mainWindow?.webContents, harnessView?.webContents]) {
      if (contents && !contents.isDestroyed()) contents.send('appearance:chat-theme-changed', saved)
    }
    return saved
  })
  // Only the trusted shell may invoke desktop APIs, never the agent web view.
  const secureHandle = (name: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown): void => { ipcMain.handle(name, (event,...args) => { senderWindow(event); return listener(event,...args) }) }
  registerLatexIpc(secureHandle,latex,latexCompiler,()=>mainWindow)
  secureHandle('planning:get', () => planning.get())
  secureHandle('planning:save-plan', (_event, input) => planning.savePlan(input))
  secureHandle('planning:remove-plan', (_event, id, date) => planning.removePlan(id, date))
  secureHandle('planning:complete', (_event, id, date, done) => planning.complete(id, date, done))
  secureHandle('planning:save-category', (_event, input) => planning.saveCategory(input))
  secureHandle('planning:remove-category', (_event, id) => planning.removeCategory(id))
  secureHandle('planning:save-bookmark', (_event, input) => planning.saveBookmark(input))
  secureHandle('planning:remove-bookmark', (_event, id) => planning.removeBookmark(id))
  secureHandle('planning:open-bookmark', (_event, id) => confirmOpenExternal(planning.bookmarkTarget(id)))
  secureHandle('planning:save-gallery', (_event, layout) => planning.saveGallery(layout))
  secureHandle('planning:save-todos', (_event, todos) => planning.saveTodos(todos))
  secureHandle('planning:save-schedule-overrides', (_event, day, overrides) => planning.saveScheduleOverrides(day, overrides))
  secureHandle('planning:save-task', (_event, input) => planning.saveTask(input))
  secureHandle('planning:remove-task', (_event, id) => planning.removeTask(id))
  secureHandle('planning:complete-task', (_event, id, done) => planning.completeTask(id, done))
  registerKnowledgeIpc((name, listener) => secureHandle(name, name === 'knowledge:context-reply'
    ? async (event, ...args) => { try { return await listener(event, ...args) } catch (error) { if (!/已停止|已结束/.test(String(error))) logMain('voice context reply failed', error); throw error } }
    : listener), knowledge, providers, repository, voice, {
    harness: harnessApi,
    workspace: paths.workspace,
    confirmAiUse: () => confirmAiUse(),
    ensureRuntime: async () => { if (runtime.status().phase !== 'ready') await runtime.start() },
    fieldBrief: (id, excludeTitles) => {
      try { return fieldBriefText(researchExplorer.fields.get(id), { excludeTitles }) } catch { return null }
    },
  })
  secureHandle('research:explorations', () => researchExplorer.list())
  secureHandle('research:delete-exploration', (_event, id) => researchExplorer.remove(id))
  secureHandle('research:update-exploration', async (_event, id, options) => { await confirmAiUse(); if (!(await providers.list()).some(p => p.active && p.hasCredential)) throw new Error('请先在设置中配置并启用模型'); return researchExplorer.update(id, options) })
  secureHandle('research:fields', () => researchExplorer.fields.list())
  secureHandle('research:field', (_event, id) => researchExplorer.fields.get(id))
  secureHandle('research:create-field', (_event, title, parentId) => researchExplorer.fields.create(title, parentId))
  secureHandle('research:field-monthly', async (_event,id,enabled)=> { researchExplorer.fields.get(id); if(enabled) await confirmAiUse(true); return researchExplorer.fields.setMonthly(id,enabled) })
  secureHandle('research:field-star', async (_event,id,paperId,starred)=> {
    const entry=researchExplorer.fields.get(id).papers.find(p=>p.id===paperId)
    if(!entry) throw new Error('领域论文不存在')
    if(starred && !entry.analysis.libraryId) { const origin=entry.origins.at(-1)!; await researchExplorer.import(origin.runId,origin.sourceId) }
    return researchExplorer.fields.star(id,paperId,starred)
  })
  secureHandle('research:field-notes', (_event, id, notes, previous) => researchExplorer.fields.saveNotes(id, notes, previous))
  secureHandle('research:field-directions', (_event, id, paperId, directions) => researchExplorer.fields.setDirections(id, paperId, directions))
  secureHandle('research:field-relation', (_event, id, input) => researchExplorer.fields.addRelation(id, input))
  secureHandle('research:remove-field-relation', (_event, id, relationId) => researchExplorer.fields.removeRelation(id, relationId))
  secureHandle('research:update-field-document', async (_event, id) => { researchExplorer.fields.get(id); await confirmAiUse(); if (!(await providers.list()).some(p => p.active && p.hasCredential)) throw new Error('请先在设置中配置并启用模型'); return researchExplorer.fields.refresh(id) })
  secureHandle('research:import-field-paper', async (_event, id, paperId, projectId) => {
    const field = researchExplorer.fields.get(id), entry = field.papers.find(p => p.id === paperId)
    if (!entry) throw new Error('领域论文不存在。')
    if (projectId) knowledge.project(projectId)
    const origin = entry.origins.at(-1)!
    const paper = await researchExplorer.import(origin.runId, origin.sourceId)
    if (projectId) knowledge.setProjectPaper(projectId, paper.id, true)
    return paper
  })
  secureHandle('research:explore', async (_event, request) => { const projectContext = request?.projectId ? knowledge.projectContext(request.projectId) : undefined; await confirmAiUse(); if (!(await providers.list()).some(p => p.active && p.hasCredential)) throw new Error('请先在设置中配置并启用模型'); return researchExplorer.start({ ...request, projectContext }) })
  secureHandle('research:cancel-exploration', (_event, id) => researchExplorer.cancel(id))
  secureHandle('research:import-exploration', async (_event, id, sourceId) => { const run = researchExplorer.list().find(run => run.id === id); if (run?.request.projectId) knowledge.project(run.request.projectId); const paper = await researchExplorer.import(id, sourceId); if (run?.request.projectId) knowledge.setProjectPaper(run.request.projectId, paper.id, true); return paper })
  secureHandle('voice:capabilities', () => voice.capabilities())
  secureHandle('voice:settings', () => breezeVoice.settings())
  secureHandle('voice:save-settings', (_event, input) => breezeVoice.save(input))
  secureHandle('voice:verify-settings', async () => {
    const settings = await breezeVoice.settings()
    const checks: Promise<{ ok: boolean; message: string }>[] = []
    if (settings.provider === 'breezeblue') checks.push(breezeVoice.verify())
    const clouds = [...new Set([settings.provider, settings.asrProvider].filter((value): value is CloudVoiceProvider => value === 'deepseek' || value === 'minimax'))]
    for (const provider of clouds) checks.push(cloudVoice.verify(provider))
    if (!checks.length) return { ok: true, message: '当前使用 Windows 本地声音，无需连接检查。' }
    const results = await Promise.all(checks)
    return { ok: results.every(result => result.ok), message: results.map(result => result.message).join(' ') }
  })
  secureHandle('voice:start', () => voice.start())
  secureHandle('voice:stop', (_event, id) => { if (typeof id === 'string') voice.stop(id) })
  // Voice failures are logged (message only, never the spoken or typed text) so they can be diagnosed.
  const voiceLogged = <T>(step: string, task: () => Promise<T>): Promise<T> => task().catch((error: unknown) => {
    if (!/已停止|已结束/.test(String(error))) logMain(`voice ${step} failed`, error)
    throw error
  })
  secureHandle('voice:listen', (_event, id, audio) => voiceLogged('listen', async () => {
    const result = await voice.listen(id, audio)
    if (!result.text.trim()) logMain(`voice recognition returned no text (audioBytes=${typeof audio === 'string' ? Buffer.byteLength(audio, 'base64') : 0})`)
    return result
  }))
  secureHandle('voice:reply', (_event, id, messages) => voiceLogged('reply', () => voice.reply(id, messages)))
  secureHandle('voice:speak', (_event, id, text) => voiceLogged('speak', async () => voice.speak(id, text)))
  secureHandle('voice:play', (_event, id, audio) => voiceLogged('play', () => voice.play(id, audio)))
  secureHandle('images:settings', () => images.settings())
  secureHandle('images:save-settings', (_event, input) => images.saveSettings(input))
  secureHandle('images:list', () => images.list())
  secureHandle('images:generate', (_event, taskId, input) => images.generateTask(taskId, input))
  secureHandle('images:cancel', (_event, taskId) => { images.cancel(taskId) })
  secureHandle('images:read', (_event, id) => images.readAsset(id))
  secureHandle('images:remove', (_event, id) => images.remove(id))
  secureHandle('images:reveal', async (_event, id) => { shell.showItemInFolder(await images.assetPath(id)) })
  secureHandle('research:list', (_event,kind) => digests.list(kind))
  secureHandle('research:discovery', (_event,refresh) => discoveryFeed(refresh === true))
  secureHandle('research:generate', async (_event,kind,subscriptionId) => { await confirmAiUse(); return digests.generate(kind,subscriptionId) })
  secureHandle('research:subscriptions', () => digests.subscriptions())
  secureHandle('research:subscribe', async (_event,input) => { if(input.enabled) await confirmAiUse(true); digests.subscribe(input) })
  secureHandle('research:remove-subscription', (_event,id) => digests.removeSubscription(id))
  secureHandle('research:read', (_event,id,item) => digests.read(id,item))
  secureHandle('research:star', (_event,id,item,starred) => digests.star(id,item,starred))
  secureHandle('research:import', (_event,id,item) => digests.importPaper(id,item))
  secureHandle('research:open', async (_event,url) => { const target=new URL(url); if(!['http:','https:'].includes(target.protocol)) throw new Error('不支持的链接'); await confirmOpenExternal(target.href) })
  secureHandle('papers:import-batch', async (_event,files) => {
    if(!Array.isArray(files) || files.length > 100 || files.some((f)=>typeof f !== 'string')) throw new Error('导入列表无效')
    const result: {papers: Awaited<ReturnType<PaperRepository['import']>>[]; errors:string[]} = {papers:[],errors:[]}
    for(const file of files) try { result.papers.push(await repository.import(file)) } catch(e) { result.errors.push(`${path.basename(file)}：${redact(e)}`) }
    return result
  })
  secureHandle('papers:update', (_event,id,patch) => repository.update(id,patch))
  secureHandle('papers:thumbnail', async (_event,id,png) => {
    if(!repository.get(id) || typeof png !== 'string' || png.length > 2_000_000 || !png.startsWith('data:image/png;base64,')) throw new Error('缩略图无效')
    const bytes=Buffer.from(png.slice('data:image/png;base64,'.length),'base64')
    if(bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG 无效')
    await fs.promises.mkdir(path.join(paths.cache,'pipeline-thumbnails'),{recursive:true})
    await fs.promises.writeFile(path.join(paths.cache,'pipeline-thumbnails',`${repository.get(id)!.id}.png`),bytes)
  })
  secureHandle('papers:trash', () => repository.trash())
  secureHandle('papers:restore', (_event,id) => repository.restore(id))
  secureHandle('papers:highlights', (_event,id) => repository.highlights(id))
  secureHandle('papers:highlight', (_event,input) => repository.highlight(input))
  secureHandle('papers:remove-highlight', (_event,id) => repository.removeHighlight(id))
  ipcMain.handle('window:minimize', (event) => senderWindow(event).minimize())
  ipcMain.handle('window:backdrop', (event) => readDesktopBackdrop(senderWindow(event)))
  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = senderWindow(event)
    window.isMaximized() ? window.unmaximize() : window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('window:close', (event) => senderWindow(event).close())
  ipcMain.handle('dialog:pdfs', async (event) => {
    const result = await dialog.showOpenDialog(senderWindow(event), { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('dialog:workspace', async (event) => {
    const result = await dialog.showOpenDialog(senderWindow(event), { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('runtime:get', () => runtime.status())
  ipcMain.handle('runtime:diagnostics', () => ({ runtime: runtime.status(), dataRoot: paths.data, databasePath: repository.databasePath, logs: runtime.logs() }))
  ipcMain.handle('runtime:restart', async () => { await runtime.restart(); await loadHarnessView() })
  secureHandle('runtime:assistant-action', async (_event, action) => {
    if (!['new', 'history', 'plugins', 'assistant'].includes(action)) throw new Error('未知的页面操作')
    if (action === 'plugins' || action === 'assistant') {
      harnessPanel = action
      if (harnessView && !harnessView.webContents.isDestroyed()) await selectHarnessPanel(harnessView)
      return
    }
    if (!harnessView || harnessView.webContents.isDestroyed()) return
    await harnessView.webContents.executeJavaScript(`(() => {
      if (${JSON.stringify(action)} === 'history') {
        document.body.toggleAttribute('data-singularity-rail-collapsed')
      } else {
        const button = document.querySelector('.hHd-Xa_newSession')
        if (button instanceof HTMLElement) button.click()
        if (document.documentElement.dataset.singularityNavigationReady === 'true') {
          window.dispatchEvent(new CustomEvent('singularity:select-panel', { detail: 'assistant' }))
        }
      }
    })()`)
  })
  ipcMain.handle('runtime:set-view', (_event, bounds: HarnessViewBounds) => {
    requestedHarnessBounds = bounds
    applyHarnessBounds()
  })
  ipcMain.handle('runtime:set-theme', async (event, theme: 'light' | 'dark') => {
    senderWindow(event)
    harnessTheme = theme === 'dark' ? 'dark' : 'light'
    nativeTheme.themeSource = harnessTheme
    await applyHarnessTheme()
  })
  ipcMain.handle('providers:list', () => providers.list())
  ipcMain.handle('providers:save', async (_event, input: ProviderConfigInput) => {
    const saved = await providers.save(input)
    await applyProviderChange()
    return saved
  })
  ipcMain.handle('providers:remove', async (_event, id: string) => { await providers.remove(id); await applyProviderChange() })
  ipcMain.handle('providers:activate', async (_event, id: string) => { await providers.activate(id); await applyProviderChange() })
  ipcMain.handle('providers:test', (_event, input: ProviderConfigInput) => providers.test(input))
  ipcMain.handle('papers:import', async (_event, filePaths: string[]) => Promise.all(filePaths.map((file) => repository.import(file))))
  ipcMain.handle('papers:list', () => repository.list())
  ipcMain.handle('papers:get', (_event, id: string) => repository.get(id))
  ipcMain.handle('papers:pages', (_event, id: string, from: number, to: number) => repository.pages(id, from, to))
  ipcMain.handle('papers:search', (_event, query: string, paperId?: string) => repository.search(query, paperId))
  ipcMain.handle('papers:remove', (_event, id: string) => repository.remove(id))
  ipcMain.handle('papers:relocate', (_event, id: string, filePath: string) => repository.relocate(id, filePath))
  ipcMain.handle('papers:artifacts', (_event, id: string) => repository.artifacts(id))
  ipcMain.handle('papers:read-artifact', (_event, id: string) => repository.readArtifact(id))
  secureHandle('papers:note', (_event,id) => repository.note(id))
  secureHandle('papers:save-note', (_event,id,personalText,summaryArtifactId,includedSections) => repository.saveNote(id,personalText,summaryArtifactId,includedSections))
  secureHandle('papers:note-versions', (_event,id) => repository.noteVersions(id))
  secureHandle('papers:finalize-note', (_event,id) => repository.finalizeNote(id, knowledge.annotations(id), knowledge.insights(id)))
  secureHandle('papers:reader-cards', (_event,id) => repository.readerCards(id))
  secureHandle('papers:save-reader-note', (_event,input) => repository.saveReaderNote(input))
  secureHandle('papers:set-reader-card-state', (_event,id,hidden,included) => repository.setReaderCardState(id,hidden,included))
  secureHandle('papers:document-translation', (_event, id: string) => documentTranslations.get(id))
  secureHandle('papers:translate-document', async (_event, id: string, scope: TranslationScope) => {
    const document = await documentTranslations.get(id)
    if (!document.blocks.some((block) => block.scope === scope && block.kind !== 'formula' && !document.translations[block.id])) return document
    await confirmAiUse()
    return documentTranslations.start(id, scope)
  })
  ipcMain.handle('papers:start-artifact', async (event, id: string, kind: ArtifactKind, selection?: string, pageNumber?: number, rects?: ReaderRect[], segments?: ReaderSegment[], contextInput?: unknown) => {
    senderWindow(event)
    if (!['summary','translation','selection-translation','question-answer'].includes(kind)) throw new Error('未知任务')
    if (kind === 'selection-translation' && (!selection?.trim() || selection.length > 20000)) throw new Error('请选择不超过 20,000 字符的文字。')
    if (kind === 'selection-translation' && !isTranslatableParagraph(selection ?? '')) throw new Error('请选择一段正文再翻译，不要翻译单个词或字母。')
    if (kind === 'question-answer' && (!selection?.trim() || selection.length > 4000)) throw new Error('请填写简短的论文问题。')
    const paper = repository.get(id)
    if (!paper) throw new Error('论文不存在。')
    const questionContexts = validateQuestionContexts(contextInput, paper.pageCount)
    if (kind !== 'question-answer' && questionContexts.length) throw new Error('只有论文问答可以添加提问上下文。')
    const sourcePage = questionContexts[0]?.page ?? pageNumber ?? 1
    await confirmAiUse()
    if (runtime.status().phase !== 'ready') await runtime.start()
    const artifact = repository.createArtifact(id, kind)
    repository.annotateArtifact(artifact.id, selection, sourcePage, questionContexts)
    if (kind === 'selection-translation' || kind === 'question-answer') repository.registerArtifactCard(artifact,selection ?? '',sourcePage,rects,segments)
    try {
      const labels = { summary: '总结', translation: '全文翻译', 'selection-translation': '段落翻译', 'question-answer': '论文问答' }
      const sessionId = await harnessApi.createPaperTask({
        cwd: paths.workspace,
        title: `${labels[kind]} · ${paper.title}`,
        paperId: paper.id,
        paperTitle: paper.title,
        sourceMarkdown: path.join(paths.extracted, `${id}.md`),
        artifactPath: artifact.markdownPath,
        artifactId: artifact.id,
        kind,
        questionContexts,
        selection: selection ? kind === 'question-answer' ? selection.slice(0,4000) : `[p.${Math.max(1,Math.min(paper.pageCount,pageNumber ?? 1))}]\n${selection.slice(0,20000)}` : undefined,
      })
      repository.attachArtifactSession(artifact.id, sessionId)
      runtime.setRunningTasks(await harnessApi.runningTaskCount().catch(() => 1))
      return repository.getArtifact(artifact.id)
    } catch (error) {
      repository.failArtifact(artifact.id, redact(error))
      throw error
    }
  })
  secureHandle('writing:projects', () => repository.writingProjects())
  secureHandle('writing:paragraphs', (_event,projectId,section) => repository.writingParagraphs(projectId,section))
  secureHandle('writing:add-paragraph', (_event,projectId,section,groupId) => repository.createWritingParagraph(projectId,section,groupId??null))
  secureHandle('writing:groups',(_e,projectId,section)=>repository.writingGroups(projectId,section))
  secureHandle('writing:create-group',(_e,projectId,section,title,parentId)=>repository.createWritingGroup(projectId,section,title,parentId??null))
  secureHandle('writing:update-group',(_e,id,title)=>repository.updateWritingGroup(id,title))
  secureHandle('writing:remove-group',(_e,id)=>repository.removeWritingGroup(id))
  secureHandle('writing:move-paragraph',(_e,id,groupId,position)=>repository.moveWritingParagraph(id,groupId,position))
  secureHandle('writing:finalize-paragraph',(_e,id,finalized)=>repository.finalizeWritingParagraph(id,finalized))
  secureHandle('writing:template',(_e,id)=>writingLatex.info(id))
  secureHandle('writing:bind-template',(_e,id,latexId,language,mappings)=>writingLatex.bind(id,latexId,language,mappings))
  secureHandle('writing:preview-latex',(_e,id)=>writingLatex.preview(id))
  secureHandle('writing:apply-latex',(_e,id)=>writingLatex.apply(id))
  secureHandle('writing:update-paragraph', (_event,id,title,draftText) => repository.updateWritingParagraph(id,title,draftText))
  secureHandle('writing:accept-paragraph', (_event,id) => repository.acceptWritingParagraphVersion(id))
  secureHandle('writing:generate-paragraph', async (_event,id:string,request?:import('../shared/writing').ParagraphRequest) => {
    const paragraph = repository.writingParagraph(id)
    if (!paragraph) throw new Error('段落不存在。')
    const project = repository.writingProjects().find((item) => item.id === paragraph.projectId)
    if (!project) throw new Error('写作项目不存在。')
    await confirmParagraphTransfer(paragraph.title)
    if (runtime.status().phase !== 'ready') await runtime.start()
    const version = repository.createWritingParagraphVersion(id,request)
    try {
      const groups=repository.writingGroups(project.id,paragraph.section),outline=groups.map(g=>({id:g.id,parentId:g.parentId,title:g.title,position:g.position,current:g.id===paragraph.groupId}))
      const skill=fs.readFileSync(path.join(paths.resources,'skills','bilingual-academic-paragraph','SKILL.md'),'utf8')
      const sessionId = await harnessApi.createWritingParagraphTask({ cwd:paths.workspace, project, paragraph:repository.writingParagraph(id)!, version, skill,outline:JSON.stringify(outline),argumentContext: knowledge.argumentContext(id) })
      repository.attachWritingParagraphSession(version.id,sessionId)
      runtime.setRunningTasks(await harnessApi.runningTaskCount().catch(() => 1))
      return repository.writingParagraphVersion(version.id)
    } catch (error) { repository.failWritingParagraphVersion(version.id,redact(error)); throw error }
  })
  secureHandle('writing:create', (_event,title,field,journal) => repository.createWritingProject(title,field,journal))
  secureHandle('writing:update', (_event,id,title,field,journal) => repository.updateWritingProject(id,title,field,journal))
  secureHandle('writing:draft', (_event,projectId,section) => repository.writingDraft(projectId,section))
  secureHandle('writing:save-draft', (_event,projectId,section,text,checkpoint) => repository.saveWritingDraft(projectId,section,text,Boolean(checkpoint)))
  secureHandle('writing:history', (_event,projectId,section) => repository.writingDraftHistory(projectId,section))
  secureHandle('writing:revisions', (_event,projectId,section) => repository.writingRevisions(projectId,section))
  secureHandle('writing:accept', (_event,id) => repository.acceptWritingRevision(id))
  secureHandle('writing:review', async (_event,projectId:string,section:WritingSectionKey,mode:WritingReviewMode) => {
    await confirmAiUse()
    if (runtime.status().phase !== 'ready') await runtime.start()
    const project = repository.writingProjects().find((item) => item.id === projectId)
    if (!project) throw new Error('写作项目不存在。')
    const revision = repository.createWritingRevision(projectId,section,mode)
    try {
      const sessionId = await harnessApi.createWritingTask({ cwd:paths.workspace, project, revision })
      repository.attachWritingSession(revision.id,sessionId)
      runtime.setRunningTasks(await harnessApi.runningTaskCount().catch(() => 1))
      return repository.writingRevision(revision.id)
    } catch (error) { repository.failWritingRevision(revision.id,redact(error)); throw error }
  })
  ipcMain.handle('workspaces:list', () => repository.listWorkspaces())
  ipcMain.handle('workspaces:add', (_event, folder: string) => repository.addWorkspace(folder))
  ipcMain.handle('workspaces:remove', (_event, id: string) => repository.removeWorkspace(id))
  ipcMain.handle('workspaces:tree', (_event, id: string, relativePath?: string, query?: string) => repository.workspaceTree(id, relativePath, query))
  ipcMain.handle('files:show', async (_event, filePath: string) => {
    const absolute = path.resolve(filePath)
    const paperAllowed = (await repository.list()).some((paper) => paper.sourcePath === absolute)
    if (!paperAllowed && !repository.isManagedPath(absolute) && !isPathInside(absolute, paths.data)) throw new Error('只能打开论文、受管工作区或 Singularity 数据目录中的路径。')
    shell.showItemInFolder(absolute)
  })
}

async function confirmAiUse(schedule = false): Promise<void> {
  const file = path.join(paths.config, 'ai-consent.json')
  if (!schedule && fs.existsSync(file)) return
  if (!mainWindow) throw new Error('窗口尚未就绪')
  const result=await dialog.showMessageBox(mainWindow,{ type:'question',title:'模型服务使用确认',message:schedule ? '启用应用内自动更新？' : '允许使用配置的模型服务？',detail:'论文选段、论文正文或公开新闻资料将发送到当前配置的模型 API，可能产生费用。文件仍保存在本机。自动更新仅在应用打开时执行，可随时关闭。',buttons:['取消','同意'],defaultId:0,cancelId:0 })
  if(result.response !== 1) throw new Error('已取消')
  fs.writeFileSync(file,JSON.stringify({acceptedAt:new Date().toISOString()}))
}

async function confirmParagraphTransfer(paragraphTitle: string): Promise<void> {
  if (!mainWindow) throw new Error('窗口尚未就绪')
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question', title: '段落改写确认',
    message: '发送这张段落卡片到当前配置的模型服务？',
    detail: `段落“${paragraphTitle.slice(0,80)}”的输入、修改要求、章节分组、选定基准版本及关联的论证材料将发送至模型 API，用于生成中英对照。可能产生 API 费用；本地版本不会被自动覆盖。`,
    buttons: ['取消', '发送并生成'], defaultId: 0, cancelId: 0,
  })
  if (result.response !== 1) throw new Error('已取消段落改写')
}

async function applyProviderChange(): Promise<void> {
  const running = await harnessApi.runningTaskCount().catch(() => runtime.status().runningTasks)
  runtime.setRunningTasks(running)
  if (running > 0) {
    runtime.markPendingRestart()
  } else {
    await runtime.restart()
    await loadHarnessView()
  }
}

function createWindow(): BrowserWindow {
  logMain('creating main window')
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 760, show: false,
    title: 'Singularity', frame: false, roundedCorners: true, transparent: false, backgroundColor: '#00000000',
    // DWM blurs the desktop backdrop. Keep foreground opacity at 1 so text stays
    // crisp; DWM retains native rounded corners and accessibility fallback colors.
    ...(process.platform === 'win32' ? { backgroundMaterial: 'acrylic' as const } : {}),
    icon: path.join(paths.resources, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(paths.resources, 'dist-electron', 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
    },
  })
  logMain('main window created')
  window.contentView.setBackgroundColor('#00000000')
  applyWindowsBackdrop(window)
  keepWindowsBackdrop(window)
  keepDesktopBackdrop(window)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('did-fail-load', (_event, code, description, url) => logMain(`renderer load failed (${code}) ${description} ${url}`))
  window.webContents.on('render-process-gone', (_event, details) => logMain(`renderer process gone (${details.reason}) exit=${details.exitCode}`))
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.SINGULARITY_DEV_SERVER_URL || pathToFileURL(path.join(paths.resources, 'dist', 'index.html')).toString()
    if (!url.startsWith(allowed)) event.preventDefault()
  })
  window.once('ready-to-show', () => { logMain('main window ready to show'); window.show() })
  window.webContents.on('render-process-gone', () => voice.stop())
  window.webContents.on('did-start-loading', () => voice.stop())
  let closePromptOpen = false
  window.on('close', event => {
    if (quitting) return
    event.preventDefault()
    if (closePromptOpen) return
    closePromptOpen = true
    void dialog.showMessageBox(window, {
      type: 'question', title: '关闭 Singularity',
      message: '完全退出应用，还是最小化到任务栏？',
      detail: '最小化后应用会继续运行，可以从任务栏恢复。',
      buttons: ['最小化到任务栏', '完全退出应用', '取消'],
      defaultId: 0, cancelId: 2, noLink: true,
    }).then(({ response }) => {
      if (quitting || window.isDestroyed()) return
      if (response === 0) window.minimize()
      else if (response === 1) app.quit()
    }).catch(error => logMain('close prompt failed', error)).finally(() => { closePromptOpen = false })
  })
  window.on('closed', () => { voice.stop(); mainWindow = null; harnessView = null })
  // Minimizing or hiding to the tray ends a voice conversation; being covered by another window does not.
  for (const event of ['minimize', 'hide'] as const) window.on(event as 'minimize', () => { if (!window.isDestroyed()) window.webContents.send('window:concealed') })
  const devUrl = process.env.SINGULARITY_DEV_SERVER_URL
  void (devUrl ? window.loadURL(devUrl) : window.loadFile(path.join(paths.resources, 'dist', 'index.html')))
  return window
}

async function loadHarnessView(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  runtime.setViewReady(false)
  if (harnessView) {
    mainWindow.contentView.removeChildView(harnessView)
    harnessView.webContents.close()
  }
  const url = runtime.status().url
  if (!url) return
  const view = new WebContentsView({ webPreferences: { preload: path.join(paths.resources, 'dist-electron', 'chat-appearance.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: true } })
  browserGuests.bind(view.webContents, () => () => {})
  // Every launch binds a new local port and writes a fresh `dsh-auth-*` cookie.
  // Cookies are scoped to the host, not the port, so leftovers from earlier
  // ports pile up until the Cookie header exceeds the backend's 16 KiB limit:
  // the assistant then answers HTTP 431 and renders as an empty glass pane.
  // Drop the stale ones before loading; the URL token re-authenticates anyway.
  try {
    const jar = view.webContents.session.cookies
    const cookies = await jar.get({})
    for (const cookie of cookies) {
      if (!cookie.name.startsWith('dsh-auth-')) continue
      await jar.remove(`http://127.0.0.1${cookie.path || '/'}`, cookie.name)
    }
  } catch (error) {
    logMain('harness cookie cleanup skipped', error)
  }
  view.setBackgroundColor('#00000000')
  harnessView = view
  view.setBorderRadius(12)
  view.setVisible(false)
  mainWindow.contentView.addChildView(view)
  view.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//i.test(target)) void confirmOpenExternal(target)
    return { action: 'deny' }
  })
  view.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) event.preventDefault()
  })
  await view.webContents.loadURL(runtime.launchUrl() ?? url)
  await applySingularityBranding(view)
  await selectHarnessPanel(view)
  runtime.setViewReady(true)
  applyHarnessBounds()
}

async function selectHarnessPanel(view: WebContentsView): Promise<void> {
  await view.webContents.executeJavaScript(`(() => {
    const panel = ${JSON.stringify(harnessPanel)}
    if (document.documentElement.dataset.singularityNavigationReady === 'true') {
      window.dispatchEvent(new CustomEvent('singularity:select-panel', {detail: panel}))
    } else {
      const observer = new MutationObserver(() => {
        if (document.documentElement.dataset.singularityNavigationReady !== 'true') return
        observer.disconnect()
        window.dispatchEvent(new CustomEvent('singularity:select-panel', {detail: panel}))
      })
      observer.observe(document.documentElement, {attributes:true, attributeFilter:['data-singularity-navigation-ready']})
      setTimeout(() => observer.disconnect(), 15000)
    }
  })()`)
}

const singularityHarnessCss = String.raw`
  /* Chat-theme aware surfaces. The renderer paints the tinted pane and this page
     is transparent, so every layer below only adds a slightly deeper shade of the
     SAME hue. Nothing here is allowed to fall back to opaque white. */
  :root {
    --sg-rail: rgba(205, 170, 82, .13);
    --sg-rail-line: rgba(120, 100, 55, .10);
    --sg-surface: rgba(250, 247, 238, .98);
    --sg-acrylic: rgba(255, 255, 255, .30);
    --sg-ink: #4b4636;
  }
  html[data-singularity-chat-theme="blue"] { --sg-rail: rgba(83, 179, 239, .15); --sg-rail-line: rgba(60, 110, 170, .12); --sg-surface: rgba(239, 246, 255, .94); --sg-ink: #2f4a68; }
  html[data-singularity-chat-theme="purple"] { --sg-rail: rgba(160, 130, 225, .14); --sg-rail-line: rgba(105, 85, 165, .12); --sg-surface: rgba(247, 242, 255, .94); --sg-ink: #4b3d68; }
  html[data-singularity-chat-theme="green"] { --sg-rail: rgba(105, 185, 135, .14); --sg-rail-line: rgba(60, 125, 85, .12); --sg-surface: rgba(240, 249, 243, .94); --sg-ink: #33573d; }
  html[data-singularity-chat-theme="transparent"] { --sg-rail: rgba(72, 82, 96, .10); --sg-rail-line: rgba(72, 82, 96, .10); --sg-surface: rgba(244, 246, 249, .88); --sg-ink: #424a57; }
  /* Dark tokens must also land on <html>: the page background lives there, and a
     body-only override would leave the canvas light while the text turns white. */
  body[data-ds-dark-theme],
  html:has(body[data-ds-dark-theme]) { --sg-rail: rgba(0, 0, 0, .22); --sg-rail-line: rgba(255, 255, 255, .07); --sg-surface: rgba(28, 30, 35, .96); --sg-acrylic: rgba(255, 255, 255, .045); --sg-ink: #d6dae2; }
  /* Upstream defines this on body (not :root), which is why a :root override
     never reached the composer seat and the bottom status row. */
  body { --dsw-alias-bg-base: var(--sg-surface) !important; }

  :root {
    color-scheme: light !important;
    --dsw-alias-bg-base: var(--sg-surface) !important;
    --dsw-specific-sidebar-fill: transparent !important;
    --dsw-specific-input-major: #ffffff !important;
    --dsw-alias-button-elevated-fill: #ffffff !important;
    --dsw-alias-button-floating-fill: #ffffff !important;
    --dsw-alias-border-l1: rgba(15, 23, 42, 0.07) !important;
    --dsw-alias-border-l2: rgba(15, 23, 42, 0.10) !important;
    --dsw-alias-border-l3: rgba(15, 23, 42, 0.14) !important;
    --dsw-alias-state-business-primary: #FF7E5F !important;
    --dsh-chat-content-width: 780px !important;
    --dsh-composer-card-max-width: 812px !important;
  }

  html, body, #root {
    background: transparent !important;
    color-scheme: light !important;
    font-family: "Segoe UI Variable Text", "Segoe UI", "Singularity Han", "Microsoft YaHei UI", sans-serif !important;
  }

  /* The pane behind this transparent view owns the theme colour, so nothing in
     here may paint a canvas of its own — only the rail and the bottom seat add
     a deeper shade of the same hue. */
  .pI_x6G_frame,
  .pI_x6G_centerCol,
  .wSkVaW_root {
    background: transparent !important;
  }

  html:has(body[data-ds-dark-theme]),
  html:has(body[data-ds-dark-theme]) body { color-scheme: dark !important; }

  /* The history dock must read as the SAME colour as the pane, so neither the
     column nor its root paints a fill or a blur of its own. */
  .pI_x6G_sidebarCol,
  .hHd-Xa_root {
    background: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }

  .pI_x6G_sidebarCol {
    border: 0 !important;
  }

  .pI_x6G_handle[data-side="sidebar"] {
    display: none !important;
  }

  .hHd-Xa_root {
    --dsh-sidebar-inline-padding: 16px !important;
    padding-top: 12px !important;
    padding-bottom: 12px !important;
  }

  .hHd-Xa_root.hHd-Xa_collapsed {
    padding: 16px 10px 12px !important;
  }

  .hHd-Xa_logoRow {
    height: 54px !important;
    margin-bottom: 14px !important;
    padding: 6px 2px !important;
  }

  .hHd-Xa_brandIdentity {
    gap: 10px !important;
    height: 28px !important;
  }

  .hHd-Xa_brandName {
    height: 28px !important;
    font-size: 17px !important;
    font-weight: 650 !important;
    letter-spacing: -0.02em !important;
    line-height: 28px !important;
  }

  .singularity-brand-mark-slot,
  .singularity-hero-mark-slot {
    background-image: url("__SINGULARITY_ICON__") !important;
    background-position: center !important;
    background-repeat: no-repeat !important;
    background-size: contain !important;
  }

  .singularity-brand-mark-slot > *,
  .singularity-hero-mark-slot > * {
    visibility: hidden !important;
  }

  .singularity-brand-name-slot > * {
    display: none !important;
  }

  .singularity-brand-name-slot::after {
    content: "Singularity";
    display: inline-flex;
    align-items: center;
    height: 28px;
    white-space: nowrap;
  }

  .hHd-Xa_iconButton,
  .hHd-Xa_newSession,
  .pXSMma_workspace,
  .uV2eYG_add,
  .uV2eYG_primary {
    transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease !important;
  }

  .hHd-Xa_iconButton {
    border-radius: 14px !important;
  }

  .hHd-Xa_newSession {
    height: 44px !important;
    margin: 0 0 18px !important;
    border-color: rgba(15, 23, 42, 0.08) !important;
    border-radius: 15px !important;
    box-shadow: none !important;
  }

  .hHd-Xa_collapsed .hHd-Xa_newSession,
  .hHd-Xa_collapsed .hHd-Xa_iconButton {
    width: 36px !important;
    height: 36px !important;
    border-radius: 14px !important;
  }

  .wSkVaW_header {
    padding: 16px 32px 0 28px !important;
  }

  .wSkVaW_header::after {
    background: rgba(15, 23, 42, 0.07) !important;
  }

  .wSkVaW_root[data-phase="hero"] .wSkVaW_scrollBody {
    justify-content: center !important;
  }

  .wSkVaW_composerHero {
    gap: 18px !important;
    padding-bottom: 64px !important;
  }

  .wSkVaW_heroGlow {
    opacity: 0.22 !important;
    filter: saturate(0.65) !important;
  }

  .pXSMma_stack {
    gap: 20px !important;
  }

  .pXSMma_headline {
    grid-template-columns: 68px auto !important;
    column-gap: 16px !important;
    gap: 12px 16px !important;
    font-size: 42px !important;
    line-height: 54px !important;
  }

  /* Harness 0.1 named the wordmark headlineText; 0.2 renders it inside titleGroup. */
  .pXSMma_headlineText,
  .pXSMma_titleGroup {
    font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif !important;
    font-size: 42px !important;
    font-style: italic !important;
    font-weight: 600 !important;
    letter-spacing: -0.045em !important;
    line-height: 54px !important;
  }

  .pXSMma_previewBadge {
    display: none !important;
  }

  .pXSMma_fishHitbox {
    width: 64px !important;
    height: 64px !important;
  }

  .pXSMma_body {
    gap: 14px !important;
  }

  .pXSMma_workspaceRow,
  .wSkVaW_heroWorkspaceRow {
    min-height: 32px !important;
    padding-left: 10px !important;
  }

  .pXSMma_workspace {
    min-height: 32px !important;
    border-radius: 14px !important;
    padding: 0 10px !important;
  }

  .uV2eYG_card {
    border: 1px solid rgba(15, 23, 42, 0.09) !important;
    border-radius: 16px !important;
    box-shadow: 0 18px 55px rgba(30, 41, 59, 0.075) !important;
    gap: 14px !important;
    padding-top: 12px !important;
  }

  .uV2eYG_cardWorkspaceTrigger::after {
    border-radius: 16px !important;
    -webkit-mask: none !important;
    mask: none !important;
    background: transparent !important;
    border: 1px solid rgba(92, 99, 108, 0.12) !important;
  }

  .uV2eYG_input,
  .uV2eYG_mirror,
  .uV2eYG_backdrop {
    padding-left: 18px !important;
    padding-right: 18px !important;
  }

  .uV2eYG_row {
    padding: 4px 10px 10px !important;
  }

  .uV2eYG_primary {
    width: 36px !important;
    height: 36px !important;
    transform: none !important;
    background: #FF7E5F !important;
    color: #30231E !important;
  }

  .uV2eYG_primary:is(:disabled, [aria-disabled="true"]) {
    opacity: .48 !important;
  }

  .uV2eYG_primary:not(:disabled):not([aria-disabled="true"]):hover {
    background: #F36D4D !important;
  }

  .Md3f7G_scroll {
    padding-top: 30px !important;
    padding-bottom: 30px !important;
  }

  button, input, textarea, select {
    font-family: inherit !important;
  }

  body[data-ds-dark-theme] {
      color-scheme: dark !important;
      --dsw-alias-state-business-primary: #FF7E5F !important;
      --dsw-alias-bg-base: var(--sg-surface) !important;
      --dsw-specific-sidebar-fill: transparent !important;
      --dsw-specific-input-major: #222225 !important;
      --dsw-alias-button-elevated-fill: #222225 !important;
      --dsw-alias-button-floating-fill: #262629 !important;
      --dsw-alias-border-l1: rgba(255, 255, 255, 0.07) !important;
      --dsw-alias-border-l2: rgba(255, 255, 255, 0.11) !important;
  }

  /* Let the Windows backdrop and the tinted pane show through the assistant
     view. The history dock adds no fill of its own in any theme. */
  html, body, #root, .pI_x6G_frame, .pI_x6G_centerCol, .wSkVaW_root {
    background: transparent !important;
  }
  .pI_x6G_sidebarCol, .hHd-Xa_root {
    background: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  .hHd-Xa_newSession, .uV2eYG_card {
    background: rgba(255, 255, 255, .86) !important;
    border-color: rgba(72, 77, 85, .09) !important;
    box-shadow: 0 8px 26px rgba(35, 39, 46, .06) !important;
    backdrop-filter: blur(18px) saturate(115%) !important;
  }
  .uV2eYG_card { border-radius: 18px !important; }
  body[data-ds-dark-theme],
  body[data-ds-dark-theme] #root,
  body[data-ds-dark-theme] .pI_x6G_frame,
  body[data-ds-dark-theme] .pI_x6G_centerCol,
  body[data-ds-dark-theme] .wSkVaW_root,
  body[data-ds-dark-theme] .pI_x6G_sidebarCol,
  body[data-ds-dark-theme] .hHd-Xa_root { background: transparent !important; }
  body[data-ds-dark-theme] .hHd-Xa_newSession,
  body[data-ds-dark-theme] .uV2eYG_card {
    background: rgba(39, 40, 43, .86) !important;
    border-color: rgba(230, 233, 240, .12) !important;
  }

  /* Inner Harness history sidebar. Keep its geometry independent of upstream's
     inline grid (which also reserves right-panel / Windows titlebar columns). */
  :root { --sg-sidebar-width: 248px; --sg-sidebar-shade: rgba(0, 0, 0, .03); }
  .pI_x6G_frame {
    display: block !important;
    height: 100% !important;
    min-width: 0 !important;
    position: relative !important;
    overflow: hidden !important;
  }
  .pI_x6G_centerCol {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    min-width: 0 !important;
    height: 100% !important;
    box-sizing: border-box !important;
    padding-bottom: 0 !important;
  }
  body:not([data-singularity-rail-collapsed]) .pI_x6G_centerCol {
    margin-left: var(--sg-sidebar-width) !important;
    width: calc(100% - var(--sg-sidebar-width)) !important;
  }
  .pI_x6G_bottomRow { grid-column: auto !important; background: var(--sg-surface) !important; }
  .wSkVaW_root { width: 100% !important; min-width: 0 !important; height: 100% !important; }

  .pI_x6G_sidebarCol {
    display: block !important;
    position: absolute !important;
    inset: 0 auto 0 0 !important;
    width: var(--sg-sidebar-width) !important;
    min-width: 0 !important;
    height: 100% !important;
    z-index: 30 !important;
    border: 0 !important;
    border-right: 1px solid var(--sg-rail-line) !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
    box-shadow: none !important;
    overflow: hidden !important;
    background: var(--sg-sidebar-shade) !important;
  }
  .hHd-Xa_root,
  .hHd-Xa_root.hHd-Xa_collapsed {
    display: flex !important;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 12px !important;
    width: 100% !important;
    height: 100% !important;
    padding: 60px 14px 14px !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    background: transparent !important;
  }
  /* Singularity already provides the brand and global navigation outside this
     pane. Retain the actual workspace/history region and new-session action. */
  .hHd-Xa_logoRow, .hHd-Xa_topStrip, .hHd-Xa_panelList,
  .hHd-Xa_moreAnchor, .hHd-Xa_footArea, .hHd-Xa_footerActions,
  .hHd-Xa_settingsArea, .bhn1Oq_fade { display: none !important; }
  .hHd-Xa_newSession,
  .hHd-Xa_collapsed .hHd-Xa_newSession {
    flex: 0 0 44px !important;
    width: 100% !important;
    height: 44px !important;
    min-height: 44px !important;
    margin: 0 !important;
    border-radius: 14px !important;
    align-self: stretch !important;
    justify-content: flex-start !important;
    gap: 8px !important;
    padding: 0 12px !important;
  }
  /* Upstream shows the keyboard hint beside the label and only fades the label
     on hover; inside this narrower rail the two collide. Drop the hint and keep
     the label on one ellipsised line. */
  .hHd-Xa_newSessionShortcut { display: none !important; }
  .hHd-Xa_newSessionLabelMask {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    mask-image: none !important;
  }
  .hHd-Xa_regionArea {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 12px !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    scrollbar-width: thin;
  }
  .hHd-Xa_regionArea > * { min-width: 0 !important; flex-shrink: 0; }
  body[data-ds-dark-theme] .pI_x6G_sidebarCol { background: var(--sg-sidebar-shade) !important; }

  body[data-singularity-rail-collapsed] .pI_x6G_sidebarCol { display: none !important; }
  body[data-singularity-rail-collapsed] .pI_x6G_centerCol { margin-left: 0 !important; width: 100% !important; }
  @media (max-width: 900px) { :root { --sg-sidebar-width: 216px; } }
  @media (max-width: 600px) { :root { --sg-sidebar-width: 184px; } }

  button { transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, scale 100ms ease !important; }
  button:not(:disabled):not([aria-disabled="true"]):active { scale: .97; }
  button:focus-visible { outline: 2px solid rgba(255,126,95,.48) !important; outline-offset: 2px !important; }
  .hHd-Xa_iconButton, .pXSMma_workspace, .uV2eYG_add { border-radius: 10px !important; box-shadow: none !important; }
  .hHd-Xa_iconButton:hover, .pXSMma_workspace:hover, .uV2eYG_add:hover { background: rgba(110,115,125,.08) !important; }
  .uV2eYG_primary { box-shadow: none !important; }
  .uV2eYG_primary:is(:disabled, [aria-disabled="true"]) { background: rgba(110,115,125,.12) !important; color: #91969f !important; opacity: 1 !important; }
  .uV2eYG_card:focus-within { border-color: rgba(255,126,95,.3) !important; }
  @media (prefers-reduced-motion: reduce) { button { transition: none !important; } button:active { scale: 1 !important; } }

  /* Shared type and action styling with the desktop shell. */
  @font-face { font-family: "Singularity Han"; src: local("Noto Sans SC"), local("NotoSansSC-Regular"), local("Microsoft YaHei UI"); font-weight: 100 450; unicode-range: U+2E80-2FFF, U+3000-30FF, U+3100-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F; }
  @font-face { font-family: "Singularity Han"; src: local("Noto Sans SC Medium"), local("NotoSansSC-Medium"), local("Microsoft YaHei UI"); font-weight: 451 550; unicode-range: U+2E80-2FFF, U+3000-30FF, U+3100-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F; }
  @font-face { font-family: "Singularity Han"; src: local("Noto Sans SC Medium"), local("NotoSansSC-Medium"), local("Microsoft YaHei UI Bold"); font-weight: 551 650; unicode-range: U+2E80-2FFF, U+3000-30FF, U+3100-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F; }
  @font-face { font-family: "Singularity Han"; src: local("Noto Sans SC Bold"), local("NotoSansSC-Bold"), local("Microsoft YaHei UI Bold"); font-weight: 651 900; unicode-range: U+2E80-2FFF, U+3000-30FF, U+3100-31FF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F; }
  body { -webkit-font-smoothing: antialiased; }
  .uV2eYG_primary { border-radius: 50% !important; background: #F0694A !important; color: #fff !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 1px 2px rgba(196,72,42,.28) !important; }
  .uV2eYG_primary:not(:disabled):not([aria-disabled="true"]):hover { background: #E45D3E !important; }
  .uV2eYG_primary:is(:disabled, [aria-disabled="true"]) { background: rgba(118,118,128,.12) !important; color: #8e8e93 !important; box-shadow: none !important; }
  .uV2eYG_card { border-radius: 20px !important; border-color: rgba(0,0,0,.06) !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.65), 0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.06) !important; }
  .uV2eYG_card:focus-within { border-color: rgba(255,126,95,.45) !important; box-shadow: 0 0 0 3px rgba(255,126,95,.18), 0 10px 30px rgba(0,0,0,.06) !important; }
  body[data-ds-dark-theme] .uV2eYG_card { border-color: rgba(255,255,255,.08) !important; box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.3) !important; }
  /* Bottom of the conversation view: upstream hard-codes a white 36px gradient
     and paints the status row with the white bg token. Both now follow the theme. */
  .wSkVaW_root[data-phase="active"] .wSkVaW_composerSeat,
  .wSkVaW_embeddedBody[data-content-phase="active"] .wSkVaW_composerSeat {
    background: linear-gradient(180deg, transparent 0, var(--sg-surface) 36px, var(--sg-surface) 100%) !important;
  }
  .pI_x6G_bottomRow { background: var(--sg-surface) !important; }
  /* The transparent theme sits on true acrylic: the pane is only 30% white over
     the desktop, so an opaque light seat would read as a bright strip. Mirror the
     pane's own glass and blur what scrolls under it instead. */
  html[data-singularity-chat-theme="transparent"] .wSkVaW_root[data-phase="active"] .wSkVaW_composerSeat,
  html[data-singularity-chat-theme="transparent"] .wSkVaW_embeddedBody[data-content-phase="active"] .wSkVaW_composerSeat {
    background: linear-gradient(180deg, transparent 0, var(--sg-acrylic) 36px, var(--sg-acrylic) 100%) !important;
    backdrop-filter: blur(26px) saturate(130%) !important;
  }
  html[data-singularity-chat-theme="transparent"] .pI_x6G_bottomRow {
    background: var(--sg-acrylic) !important;
    backdrop-filter: blur(26px) saturate(130%) !important;
  }
  .bhn1Oq_fade { background: linear-gradient(to bottom, transparent, var(--sg-rail)) !important; }
  .wSkVaW_heroGlow, [class*="heroGlow"] {
    background: radial-gradient(ellipse at center, var(--sg-rail), transparent 68%) !important;
  }

  /* Vector control pinned to the top-left corner of the tinted assistant pane. */
  #singularity-rail-toggle {
    position: fixed; left: 14px; top: 14px; z-index: 200;
    display: grid; place-items: center; width: 34px; height: 34px; padding: 0;
    border: 1px solid var(--sg-rail-line); border-radius: 11px;
    background: color-mix(in srgb, var(--sg-surface) 82%, white);
    color: var(--sg-ink); cursor: pointer;
    box-shadow: 0 1px 3px rgba(20, 26, 38, .07);
    backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    font: inherit;
  }
  #singularity-rail-toggle:hover { background: color-mix(in srgb, var(--sg-surface) 62%, white); }
  #singularity-rail-toggle:focus-visible { outline: 2px solid rgba(255,126,95,.55) !important; outline-offset: 2px; }
  #singularity-rail-toggle svg { width: 18px; height: 18px; display: block; }
  #singularity-rail-toggle .sg-rail-close, #singularity-rail-toggle .sg-tip-close { display: none; }
  body[data-singularity-rail-collapsed] #singularity-rail-toggle .sg-rail-open,
  body[data-singularity-rail-collapsed] #singularity-rail-toggle .sg-tip-open { display: none; }
  body[data-singularity-rail-collapsed] #singularity-rail-toggle .sg-rail-close,
  body[data-singularity-rail-collapsed] #singularity-rail-toggle .sg-tip-close { display: block; }
  .sg-rail-tip {
    position: absolute; left: 0; top: 40px; white-space: nowrap;
    padding: 5px 9px; border-radius: 8px; font-size: 11px; line-height: 1.3;
    background: var(--sg-ink); color: var(--sg-surface);
    opacity: 0; pointer-events: none; transition: opacity 120ms ease;
    box-shadow: 0 6px 18px rgba(20, 26, 38, .16);
  }
  #singularity-rail-toggle:hover .sg-rail-tip,
  #singularity-rail-toggle:focus-visible .sg-rail-tip { opacity: 1; }
  body[data-ds-dark-theme] #singularity-rail-toggle {
    background: rgba(46, 48, 54, .92); color: #e6e8ec; border-color: rgba(255, 255, 255, .10);
  }
  body[data-ds-dark-theme] #singularity-rail-toggle:hover { background: rgba(58, 60, 68, .95); }
  @media (prefers-reduced-motion: reduce) { .sg-rail-tip { transition: none !important; } }
`

async function applySingularityBranding(view: WebContentsView): Promise<void> {
  const iconPath = path.join(paths.resources, 'build', 'icon-ui.png')
  const iconDataUrl = `data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}`
  const iconLiteral = JSON.stringify(iconDataUrl)
  const cssLiteral = JSON.stringify(singularityHarnessCss.replaceAll('__SINGULARITY_ICON__', iconDataUrl) + chatAppearanceCss)
  const themeLiteral = JSON.stringify(harnessTheme)
  await view.webContents.executeJavaScript(`(() => {
    const icon = ${iconLiteral}
    const css = ${cssLiteral}
    window.__singularityTheme = ${themeLiteral}
    const matcher = /deepseek(?:\\s+harness)?|探索未至之境|探索未来之境|into the unknown/i
    const replacement = /deepseek(?:\\s+harness)?/gi
    const landingReplacement = /探索未至之境|探索未来之境|into the unknown/gi
    const protectedAncestor = /message|conversation|markdown|prose|prompt|response|chat-content|user-content|assistant-content/i
    const brandingAncestor = /brand|logo|header|sidebar|navigation|title|hero/i
    // Model identifiers are factual labels, not brand copy: never rebrand them.
    const modelReplacement = /Singularity[ -]*V ?4[0-9.]*[ -]*(Flash|Pro)/gi
    const brandText = (value) => value
      .replace(replacement, 'Singularity')
      .replace(landingReplacement, 'Singularity')
      .replace(modelReplacement, (_match, tier) => /pro/i.test(tier) ? 'deepseek-v4-pro' : 'deepseek-v4.1-flash')

    document.title = 'Singularity'
    let style = document.getElementById('singularity-harness-theme')
    if (!style) {
      style = document.createElement('style')
      style.id = 'singularity-harness-theme'
      document.head.appendChild(style)
    }
    style.textContent = css
    for (const link of document.querySelectorAll('link[rel*="icon"], link[rel="manifest"]')) {
      if (link.getAttribute('rel')?.includes('icon')) link.setAttribute('href', icon)
    }

    const updateBrandSlots = () => {
      for (const identity of document.querySelectorAll('.hHd-Xa_brandIdentity, [class*="_brandIdentity"]')) {
        const mark = identity.querySelector('.hHd-Xa_brandMark, [class*="_brandMark"]')
        const name = identity.querySelector('.hHd-Xa_brandName, [class*="_brandName"]')
        if (mark) {
          mark.classList.add('singularity-brand-mark-slot')
          mark.setAttribute('aria-label', 'Singularity')
        }
        if (name) {
          name.classList.add('singularity-brand-name-slot')
          name.setAttribute('aria-label', 'Singularity')
        }
      }

      for (const railMark of document.querySelectorAll('.hHd-Xa_railMark, [class*="_railMark"]')) {
        railMark.classList.add('singularity-brand-mark-slot')
        railMark.setAttribute('aria-label', 'Singularity')
      }

      for (const headline of document.querySelectorAll('.pXSMma_headline')) {
        const mark = headline.querySelector('.pXSMma_fishHitbox')
        const text = headline.querySelector('.pXSMma_headlineText')
        if (mark) {
          mark.classList.add('singularity-hero-mark-slot')
          mark.setAttribute('aria-label', 'Singularity')
        }
        if (text && text.textContent?.trim() !== 'Singularity') text.textContent = 'Singularity'
      }
    }

    const syncTheme = () => {
      const dark = window.__singularityTheme === 'dark'
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      document.body?.toggleAttribute('data-ds-dark-theme', dark)
    }

    const syncHarnessFrame = () => {
      window.__singularityFrameObserver?.disconnect()
    }

    const update = () => {
      syncTheme()
      syncHarnessFrame()
      updateBrandSlots()
      const nodes = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const textNodes = []
      while (nodes.nextNode()) textNodes.push(nodes.currentNode)
      for (const node of textNodes) {
        if (!matcher.test(node.nodeValue || '')) continue
        const element = node.parentElement
        if (!element) continue
        const ancestors = []
        let current = element
        while (current && ancestors.length < 6) {
          ancestors.push(current)
          current = current.parentElement
        }
        const context = ancestors.map((item) => String(item.className || '') + ' ' + String(item.id || '')).join(' ')
        if (protectedAncestor.test(context) && !brandingAncestor.test(context)) continue
        const before = node.nodeValue || ''
        const after = brandText(before)
        if (before === after) continue
        node.nodeValue = after
      }
      for (const element of document.querySelectorAll('img')) {
        const context = [element.getAttribute('alt') || '', element.getAttribute('src') || '', String(element.className || '')].join(' ')
        if (/deepseek|favicon/i.test(context)) {
          element.src = icon
          element.alt = 'Singularity'
        }
      }
      for (const element of document.querySelectorAll('[aria-label], [title]')) {
        for (const attribute of ['aria-label', 'title']) {
          const value = element.getAttribute(attribute)
          if (value && matcher.test(value)) {
            const branded = brandText(value)
            if (branded !== value) element.setAttribute(attribute, branded)
          }
        }
      }
    }
    // The assistant is a native WebContentsView layered above the renderer, so its
    // top-left control has to live in this document, not in the React shell.
    const railButtonHtml =
      '<svg class="sg-rail-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg>' +
      '<svg class="sg-rail-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m13 9 3 3-3 3"/></svg>' +
      '<span class="sg-rail-tip sg-tip-open" aria-hidden="true">隐藏会话列表</span>' +
      '<span class="sg-rail-tip sg-tip-close" aria-hidden="true">显示会话列表</span>'
    const railControl = () => document.getElementById('singularity-rail-toggle')
    const mountRailControl = () => {
      let button = railControl()
      if (button) return button
      const rail = document.querySelector('.pI_x6G_sidebarCol')
      if (rail && !rail.id) rail.id = 'singularity-history-rail'
      button = document.createElement('button')
      button.id = 'singularity-rail-toggle'
      button.type = 'button'
      button.setAttribute('aria-label', '显示或隐藏会话列表')
      button.setAttribute('aria-controls', 'singularity-history-rail')
      button.innerHTML = railButtonHtml
      button.addEventListener('click', () => {
        document.body.toggleAttribute('data-singularity-rail-collapsed')
      })
      document.body.appendChild(button)
      return button
    }
    const syncRail = () => {
      const button = railControl()
      if (button) button.setAttribute('aria-pressed', String(!document.body.hasAttribute('data-singularity-rail-collapsed')))
    }
    update()
    if (document.body) {
      mountRailControl()
      syncRail()
      if (!window.__singularityRailObserver) {
        window.__singularityRailObserver = new MutationObserver(() => { mountRailControl(); syncRail() })
        window.__singularityRailObserver.observe(document.body, {
          attributes: true, attributeFilter: ['data-singularity-rail-collapsed'], childList: true,
        })
      }
    }
    if (!window.__singularityBrandObserver) {
      window.__singularityBrandObserver = new MutationObserver(update)
      window.__singularityBrandObserver.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-ds-dark-theme'],
      })
    }
  })()`)
}

async function applyHarnessTheme(): Promise<void> {
  if (!harnessView || harnessView.webContents.isDestroyed()) return
  const themeLiteral = JSON.stringify(harnessTheme)
  await harnessView.webContents.executeJavaScript(`(() => {
    window.__singularityTheme = ${themeLiteral}
    const dark = window.__singularityTheme === 'dark'
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    document.body?.toggleAttribute('data-ds-dark-theme', dark)
  })()`)
}

async function confirmOpenExternal(target: string): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question', buttons: ['取消', '在浏览器中打开'], defaultId: 0, cancelId: 0,
    title: '打开外部链接', message: '是否在系统浏览器中打开这个链接？', detail: target,
  })
  if (result.response === 1) await shell.openExternal(target)
}

function applyHarnessBounds(): void {
  if (!harnessView || !requestedHarnessBounds) return
  const bounds = requestedHarnessBounds
  if (![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isFinite)) return
  harnessView.setVisible(bounds.visible && bounds.width > 0 && bounds.height > 0)
  const zoom = mainWindow?.webContents.getZoomFactor() ?? 1
  harnessView.setBorderRadius(Math.round(12 * zoom))
  if(harnessView.webContents.getZoomFactor() !== zoom) harnessView.webContents.setZoomFactor(zoom)
  if (bounds.visible) harnessView.setBounds({
    x: Math.max(0, Math.round(bounds.x * zoom)), y: Math.max(0, Math.round(bounds.y * zoom)),
    width: Math.max(1, Math.round(bounds.width * zoom)), height: Math.max(1, Math.round(bounds.height * zoom)),
  })
}

async function bootstrap(): Promise<void> {
  logMain('bootstrap started')
  registerIpc()
  protocol.handle('singularity-latex',request=>{
    try{const url=new URL(request.url),parts=url.pathname.slice(1).split('/');if(url.hostname!=='pdf'||parts.length!==2)return new Response('Not found',{status:404});return net.fetch(pathToFileURL(latexCompiler.pdf(parts[0],parts[1])).toString())}catch{return new Response('Not found',{status:404})}
  })
  // File migration may copy/hash many legacy PDFs. Show the window and start
  // the independent backend while it runs, then finish loading the assistant.
  const libraryMigration = repository.migrateManagedFiles()
  protocol.handle('singularity-paper', (request) => {
    const url = new URL(request.url)
    const id = url.pathname.replace(/^\//, '')
    const paper = repository.get(id)
    if (!paper || paper.deletedAt) return new Response('Paper not found', { status: 404 })
    if (url.hostname === 'pipeline-thumbnail') { const thumbnail=path.join(paths.cache,'pipeline-thumbnails',`${paper.id}.png`); return fs.existsSync(thumbnail) ? net.fetch(pathToFileURL(thumbnail).toString()) : new Response('Not found',{status:404}) }
    if (url.hostname !== 'paper' || paper.missing) return new Response('Paper not found', { status: 404 })
    return net.fetch(pathToFileURL(paper.sourcePath).toString())
  })
  mainWindow = createWindow()
  desktopTray = new DesktopTray(paths.resources, {
    restore: restoreMainWindow,
    minimize: () => { if (!quitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize() },
    quit: () => app.quit(),
  })
  runtime.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('runtime:status', status)
  })
  try {
    logMain('starting Agent runtime')
    await Promise.all([runtime.start(), libraryMigration])
    logMain(`Agent runtime ready on port ${String(runtime.status().port)}`)
    await loadHarnessView()
    logMain('Harness view loaded')
  } catch (error) {
    logMain('Agent runtime failed', error)
    dialog.showErrorBox('Singularity', `Agent 后端启动失败：${redact(error)}`)
  }
  setInterval(async () => {
    if(quitting)return
    await digests.tick().catch((e) => logMain('digest scheduler', e))
    try { if(!quitting && (await providers.list()).some(p=>p.active&&p.hasCredential)) researchExplorer.tickMonthly() } catch(e) { logMain('field monthly scheduler',e) }
    if(quitting)return
    if (runtime.status().phase !== 'ready') return
    for(const artifact of repository.pendingArtifacts()) {
      if(!artifact.sessionId || Date.now()-Date.parse(artifact.createdAt)<10_000)continue
      if(artifact.kind==='summary' && artifact.progress>=10 && Date.now()-Date.parse(artifact.updatedAt)<30_000)continue
      const task=await harnessApi.taskEndState(artifact.sessionId).catch(()=>({ended:false,reason:null}))
      if(quitting)return
      if(!task.ended || repository.getArtifact(artifact.id)?.status!=='running')continue
      if(artifact.kind==='summary' && task.reason==='max-tokens' && artifact.progress<10 && repository.markSummaryContinuation(artifact.id)) {
        try { await harnessApi.continuePaperSummary(artifact.sessionId,artifact.paperId,artifact.id) }
        catch(error) { repository.failArtifact(artifact.id,redact(error)) }
      } else repository.failArtifact(artifact.id,task.reason==='max-tokens'
        ? '论文总结超过模型输出预算，续写后仍未保存结果。请重试或改用更高输出预算的模型。'
        : '模型会话已结束，但尚未保存完整结果。请重试，或在助手中查看任务详情。')
    }
    for(const revision of repository.pendingWritingRevisions()) {
      if(!revision.sessionId || Date.now()-Date.parse(revision.createdAt)<10_000)continue
      const ended=await harnessApi.taskEnded(revision.sessionId).catch(()=>false)
      if(quitting)return
      if(ended && repository.writingRevision(revision.id)?.status==='running') repository.failWritingRevision(revision.id,'模型会话已结束，但尚未保存修改意见。请重试。')
    }
    for (const version of repository.pendingWritingParagraphVersions()) {
      if (!version.sessionId) continue
      const ended = await harnessApi.taskEnded(version.sessionId).catch(() => false)
      if (ended && repository.writingParagraphVersion(version.id)?.status === 'running') repository.failWritingParagraphVersion(version.id,'模型会话已结束，但没有保存双语段落。请重试。')
    }
    const count = await harnessApi.runningTaskCount().catch(() => runtime.status().runningTasks)
    runtime.setRunningTasks(count)
  }, 5_000).unref()
}

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  voice.stop()
  void Promise.allSettled([digests.close(),researchExplorer.close(),runtime.stop(),latexCompiler.close()]).finally(() => {
    repository.close()
    knowledge.close()
    planning.close()
    app.quit()
  })
})

app.on('window-all-closed', () => app.quit())
app.on('activate', restoreMainWindow)
app.on('will-quit', () => { desktopTray?.destroy(); desktopTray = null })
app.whenReady().then(() => {
  logMain('Electron ready')
  return bootstrap()
}).catch((error) => {
  logMain('bootstrap failed', error)
  dialog.showErrorBox('Singularity', redact(error))
})
