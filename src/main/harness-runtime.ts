import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import type { AppPaths } from './paths'
import type { ProviderStore } from './provider-store'
import { redact } from './redaction'
import type { RuntimeStatus } from '../shared/types'
import { HARNESS_VERSION } from '../shared/harness-version'

export class HarnessRuntime extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private current: RuntimeStatus
  private readonly recentLogs: string[] = []
  private startPromise: Promise<void> | null = null
  // Harness 0.2+ prints `?token=` for its process launch token; it stays in the main process.
  private authenticatedUrl: string | null = null

  constructor(private readonly paths: AppPaths, private readonly providers: ProviderStore) {
    super()
    this.current = {
      phase: 'stopped', harnessVersion: HARNESS_VERSION, electronVersion: process.versions.electron,
      port: null, url: null, runningTasks: 0, pendingRestart: false,
    }
  }

  status(): RuntimeStatus {
    return { ...this.current }
  }

  /** The URL that exchanges this process's launch token for a session cookie; the plain URL on older Harness builds. */
  launchUrl(): string | null {
    return this.current.phase === 'ready' ? this.authenticatedUrl ?? this.current.url : null
  }

  logs(): string[] {
    return [...this.recentLogs]
  }

  markPendingRestart(value = true): void {
    this.update({ pendingRestart: value })
  }

  setViewReady(value: boolean): void {
    this.update({ viewReady: value })
  }

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    if (this.child) return
    this.startPromise = this.doStart().catch((error: unknown) => {
      if (this.current.phase !== 'error') this.update({ phase: 'error', port: null, url: null, error: redact(error) })
      throw error
    }).finally(() => { this.startPromise = null })
    return this.startPromise
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.update({ phase: 'stopped', port: null, url: null, runningTasks: 0 })
      return
    }
    this.update({ phase: 'stopping' })
    this.child = null
    this.authenticatedUrl = null
    await new Promise<void>((resolve) => {
      let completed = false
      const finish = (): void => {
        if (completed) return
        completed = true
        resolve()
      }
      child.once('exit', finish)
      child.kill('SIGTERM')
      setTimeout(() => {
        if (completed || child.pid === undefined) return
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          killer.once('exit', finish)
        } else {
          child.kill('SIGKILL')
        }
      }, 5_000).unref()
      setTimeout(finish, 8_000).unref()
    })
    this.update({ phase: 'stopped', port: null, url: null, runningTasks: 0 })
  }

  setRunningTasks(count: number): void {
    if (count !== this.current.runningTasks) this.update({ runningTasks: count })
  }

  private async doStart(): Promise<void> {
    const began = performance.now()
    const mark = (stage: string): void => this.log(`[startup] ${stage} +${Math.round(performance.now() - began)}ms`)
    await this.ensureProfile()
    mark('profile prepared')
    this.update({ phase: 'starting', port: null, url: null, error: undefined, viewReady: false })
    const binPath = path.join(this.paths.resources, 'dist-electron', 'harness-launcher.js')
    if (!fs.existsSync(binPath)) throw new Error('Agent 运行时未安装，请先运行 pnpm install。')
    const standaloneNode = path.join(this.paths.resources, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const nodeBinary = process.env.SINGULARITY_NODE_BINARY || (fs.existsSync(standaloneNode) ? standaloneNode : process.execPath)
    const usingPackagedElectronNode = nodeBinary === process.execPath && Boolean(process.versions.electron)
    const providerEnv = await this.providers.environment()
    mark('credentials prepared')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...providerEnv,
      DSH_HOME: this.paths.dshHome,
      SINGULARITY_RESOURCE_ROOT: this.paths.resources,
      PATH: `${path.dirname(nodeBinary)}${path.delimiter}${process.env.PATH ?? ''}`,
      DSH_PERMISSION_MODE: 'workspace-write',
      TEMP: this.paths.temp,
      TMP: this.paths.temp,
      XDG_CACHE_HOME: this.paths.cache,
      SINGULARITY_DATABASE_PATH: path.join(this.paths.database, 'singularity.sqlite'),
      SINGULARITY_ARTIFACTS_ROOT: this.paths.artifacts,
      NO_COLOR: '1',
    }
    if (usingPackagedElectronNode) env.ELECTRON_RUN_AS_NODE = '1'
    const nodeArgs = usingPackagedElectronNode ? ['--expose-internals'] : []
    const child = spawn(nodeBinary, [...nodeArgs, binPath, '--profile', 'singularity', '--no-open', '--port', '0'], {
      cwd: this.paths.workspace,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    mark('backend spawned')
    let startupSettled = false
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Harness 启动超时。')), 120_000)
      const processOutput = (chunk: Buffer): void => {
        const output = chunk.toString('utf8')
        this.log(output)
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/?(\?token=[^\s]+)?/)
        if (match && !startupSettled) {
          startupSettled = true
          mark('backend ready')
          clearTimeout(timeout)
          const port = Number(match[1])
          this.authenticatedUrl = match[2] ? `http://127.0.0.1:${port}/${match[2]}` : null
          this.update({ phase: 'ready', port, url: `http://127.0.0.1:${port}`, pendingRestart: false })
          resolve()
        }
      }
      child.stdout.on('data', processOutput)
      child.stderr.on('data', processOutput)
      child.once('error', (error) => {
        clearTimeout(timeout)
        if (!startupSettled) reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        const expected = this.current.phase === 'stopping' || this.child !== child
        if (this.child === child) this.child = null
        if (!startupSettled && !expected) reject(new Error(`Harness 在启动时退出（${code ?? 'unknown'}）。`))
        if (!expected) this.update({ phase: 'error', port: null, url: null, error: `Harness 意外退出（${code ?? 'unknown'}）` })
      })
    })
    try {
      await ready
    } catch (error) {
      if (this.child === child) this.child = null
      child.kill()
      this.update({ phase: 'error', port: null, url: null, error: redact(error) })
      throw error
    }
  }

  private async ensureProfile(): Promise<void> {
    const profile = path.join(this.paths.dshHome, 'profiles', 'singularity')
    fs.mkdirSync(profile, { recursive: true })
    const extensionTarget = path.join(this.paths.dshHome, 'profiles', 'node_modules', '@singularity', 'harness-extension')
    fs.mkdirSync(extensionTarget, { recursive: true })
    for (const file of ['package.json', 'index.js', 'review.js', 'answer-colors.js', 'client.js']) {
      const source = fs.readFileSync(path.join(this.paths.resources, 'packages', 'harness-extension', file))
      const target = path.join(extensionTarget, file)
      if (!fs.existsSync(target) || !source.equals(fs.readFileSync(target))) fs.writeFileSync(target, source)
    }
    const manifestFile = path.join(profile, 'package.json')
    const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    let previous: Record<string, unknown> = {}
    if (fs.existsSync(manifestFile)) {
      try { previous = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); if (!object(previous)) throw new Error('invalid manifest') }
      catch { throw new Error('插件清单 package.json 无法读取；原文件已保留，请先修复该文件。') }
    }
    if (previous.dsh !== undefined && !object(previous.dsh)) throw new Error('插件清单 dsh 字段无效，原文件已保留。')
    const dsh = (previous.dsh ?? {}) as Record<string, unknown>
    if (dsh.profile !== undefined && !object(dsh.profile)) throw new Error('插件清单 profile 字段无效，原文件已保留。')
    const options = (dsh.profile ?? {}) as Record<string, unknown>
    if (options.bundles !== undefined && (!Array.isArray(options.bundles) || options.bundles.some(item => typeof item !== 'string'))) throw new Error('插件启用列表无效，原文件已保留。')
    const core = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
    const savedBundles = options.bundles as string[] | undefined
    const bundles = savedBundles ? [...core.filter(item => !savedBundles.includes(item)), ...savedBundles] : core
    const manifest = { name: 'dsh-profile-singularity', private: true, dependencies: {}, ...previous, dsh: { ...dsh, profile: { ...options, bundles } } }
    if (!fs.existsSync(manifestFile) || JSON.stringify(previous) !== JSON.stringify(manifest)) {
      const temporary = `${manifestFile}.${process.pid}.tmp`
      fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'); fs.renameSync(temporary, manifestFile)
    }
    const rootConfig = '# Singularity profile root. The plugin tree is composed from locked bundles.\n[]\n'
    if (!fs.existsSync(path.join(profile, 'cordis.yml'))) fs.writeFileSync(path.join(profile, 'cordis.yml'), rootConfig, { encoding: 'utf8', flag: 'wx' })
    await this.writeProfilePatch(path.join(profile, 'cordis.patch.yml'))
  }

  /**
   * Compose the profile patch: Singularity owns the research-tool insert and the model entries,
   * and keeps any other entries Harness saved there (for example its own UI settings).
   */
  private async writeProfilePatch(file: string): Promise<void> {
    const payload = path.join(this.paths.resources, 'runtime', 'primary-runtime')
    const node = path.join(payload, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
    const desktopPlugins = fs.existsSync(path.join(payload, 'runtime.json')) ? [
      { id: 'singularity-office-skills', name: '@deepseek-ai/dsh-skill-office', config: {
        assetRoot: path.join(this.paths.resources, 'runtime', 'office-skills'), node,
      } },
      { id: 'singularity-workspace-dependencies', name: '@deepseek-ai/dsh-tool-workspace-dependencies', config: {
        source: payload, root: path.join(this.paths.dshHome, 'primary-runtime'),
      } },
    ] : []
    const managed = [
      { insert: [{ id: EXTENSION_ID, name: '@singularity/harness-extension', config: {
        databasePath: path.join(this.paths.database, 'singularity.sqlite'), artifactsRoot: this.paths.artifacts,
      } }, ...desktopPlugins] },
      ...await this.providers.harnessEntries(),
    ]
    const managedIds = new Set(managed.flatMap((entry) => 'id' in entry ? [entry.id] : []))
    let kept: unknown[] = []
    if (fs.existsSync(file)) {
      try {
        const prior = yaml.load(fs.readFileSync(file, 'utf8'))
        if (!Array.isArray(prior)) throw new Error('invalid patch')
        kept = prior.filter((entry) => !isManagedEntry(entry, managedIds))
      } catch {
        throw new Error('插件配置 cordis.patch.yml 无法读取；原文件已保留，请先修复后重启。')
      }
    }
    // Singularity skips the upstream product preview notice before the UI loads.
    // This copy version is shipped by the pinned Harness release.
    const welcomeIndex = kept.findIndex(entry => !!entry && typeof entry === 'object' && (entry as { id?: unknown }).id === 'ui-settings-general')
    const welcomeEntry = (welcomeIndex >= 0 ? kept[welcomeIndex] : {}) as Record<string, unknown>
    const welcomeConfig = welcomeEntry.config && typeof welcomeEntry.config === 'object' && !Array.isArray(welcomeEntry.config) ? welcomeEntry.config as Record<string, unknown> : {}
    const welcome = { ...welcomeEntry, id: 'ui-settings-general', config: { ...welcomeConfig, welcomeNoticeVersion: '2026-09-28.1' } }
    if (welcomeIndex >= 0) kept[welcomeIndex] = welcome
    else kept.push(welcome)
    // A default only: a user's explicit browser disable remains authoritative.
    if (!kept.some(entry => !!entry && typeof entry === 'object' && (entry as {id?: unknown}).id === 'ui-sidebar-browser')) {
      kept.push({ id: 'ui-sidebar-browser', disabled: false })
    }
    const header = '# Singularity profile patch. Research tools and model entries are regenerated on every start;\n# other entries are kept.\n'
    const content = header + yaml.dump([...managed, ...kept], { lineWidth: -1, noRefs: true })
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, content, 'utf8'); fs.renameSync(temporary, file)
  }

  private update(patch: Partial<RuntimeStatus>): void {
    this.current = { ...this.current, ...patch }
    this.emit('status', this.status())
  }

  private log(raw: string): void {
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      const safe = `[${new Date().toISOString()}] ${redact(line)}`
      this.recentLogs.push(safe)
      if (this.recentLogs.length > 300) this.recentLogs.shift()
      fs.appendFileSync(path.join(this.paths.logs, 'harness.log'), `${safe}\n`, 'utf8')
    }
  }
}

const EXTENSION_ID = 'singularity-research-tools'
const LEGACY_MANAGED_IDS = ['llm-deepseek', 'llm-pi-ai', 'agent-default-model']

function isManagedEntry(entry: unknown, managedIds: Set<string>): boolean {
  if (!entry || typeof entry !== 'object') return false
  const record = entry as { id?: unknown; insert?: unknown }
  if (typeof record.id === 'string' && (managedIds.has(record.id) || LEGACY_MANAGED_IDS.includes(record.id))) return true
  return Array.isArray(record.insert) && record.insert.some((item) => (item as { id?: unknown } | null)?.id === EXTENSION_ID)
}
