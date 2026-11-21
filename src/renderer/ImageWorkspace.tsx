import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Download, FolderOpen, Image as ImageIcon, ImagePlus, LoaderCircle, Plus,
  RefreshCw, Settings, Square, Trash2, X,
} from 'lucide-react'
import './image-workspace.css'
import {
  IMAGE_AREAS, IMAGE_ASPECT_RATIOS, IMAGE_DEFAULTS, IMAGE_FORMATS, IMAGE_MODELS,
  type ImageArea, type ImageAsset, type ImageFormat, type ImageGenerateInput,
  type ImageModel, type ImageSettings,
} from '../shared/image'

type Params = Omit<ImageGenerateInput, 'prompt'>

const defaultParams: Params = {
  model: IMAGE_DEFAULTS.model, aspectRatio: IMAGE_DEFAULTS.aspectRatio,
  area: IMAGE_DEFAULTS.area, count: IMAGE_DEFAULTS.count, format: IMAGE_DEFAULTS.format,
}
const newTaskId = (): string => `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
const short = (value: string, length = 46): string => value.length > length ? `${value.slice(0, length)}…` : value
const extensionOf = (dataUrl: string): string => dataUrl.startsWith('data:image/png') ? 'png'
  : dataUrl.startsWith('data:image/webp') ? 'webp' : 'jpg'

export function ImageWorkspace(): ReactNode {
  const [settings, setSettings] = useState<ImageSettings | null>(null)
  const [assets, setAssets] = useState<ImageAsset[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [params, setParams] = useState<Params>(defaultParams)
  const [prompt, setPrompt] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.minimax.cn')
  const [settingsBusy, setSettingsBusy] = useState(false)
  const taskId = useRef<string | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const initialized = useRef(false)

  const loadAssets = useCallback(async () => {
    const list = await window.singularity.images.list()
    setAssets(list)
    return list
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [value, list] = await Promise.all([window.singularity.images.settings(), window.singularity.images.list()])
        if (!live) return
        setSettings(value)
        setBaseUrl(value.minimaxBaseUrl)
        if (!initialized.current) {
          initialized.current = true
          setParams({ model: value.model, aspectRatio: value.aspectRatio, area: value.area, count: value.count, format: value.format })
        }
        setAssets(list)
        // A small bounded preview set keeps the gallery usable without loading every large image.
        const previews: Record<string, string> = {}
        await Promise.all(list.slice(0, 6).map(async item => {
          try { previews[item.id] = await window.singularity.images.read(item.id) } catch { /* a missing file is skipped */ }
        }))
        if (live) setThumbs(previews)
      } catch (cause) { if (live) setError(cause instanceof Error ? cause.message : '无法读取图片生成设置。') }
    })()
    return () => { live = false }
  }, [])

  const openAsset = async (asset: ImageAsset): Promise<void> => {
    setSelected(asset.id)
    setError('')
    try {
      const cached = thumbs[asset.id] ?? await window.singularity.images.read(asset.id)
      setThumbs(previous => ({ ...previous, [asset.id]: cached }))
      setImages([cached])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开这张图片。') }
  }

  const startNew = (): void => {
    setPrompt(''); setImages([]); setSelected(null); setNotice(''); setError('')
    textarea.current?.focus()
  }

  const generate = async (): Promise<void> => {
    const text = prompt.trim()
    if (!text || busy) return
    if (!settings?.hasMiniMaxCredential) {
      setSettingsOpen(true); setError('请先在设置中保存 MiniMax API Key。'); return
    }
    const id = newTaskId()
    taskId.current = id
    setBusy(true); setError(''); setNotice('正在生成图片…')
    try {
      const result = await window.singularity.images.generate(id, { prompt: text, ...params })
      setImages(result.images)
      setSelected(result.assets[0]?.id ?? null)
      const next: Record<string, string> = {}
      result.assets.forEach((asset, index) => { next[asset.id] = result.images[index] })
      setThumbs(previous => ({ ...previous, ...next }))
      setNotice(result.failures.length
        ? `已生成 ${result.assets.length} 张，另有 ${result.failures.length} 张未完成：${short(result.failures[0], 80)}`
        : `已生成 ${result.assets.length} 张，保存在本机。`)
      await loadAssets()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '图片生成失败。'); setNotice('') }
    finally { taskId.current = null; setBusy(false) }
  }

  const cancel = async (): Promise<void> => {
    if (!taskId.current) return
    try { await window.singularity.images.cancel(taskId.current); setNotice('已停止本次生成。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法停止生成。') }
  }

  const removeSelected = async (): Promise<void> => {
    if (!selected || busy) return
    try {
      await window.singularity.images.remove(selected)
      setAssets(previous => previous.filter(item => item.id !== selected))
      setThumbs(previous => { const next = { ...previous }; delete next[selected]; return next })
      setImages([]); setSelected(null); setNotice('已删除这张图片。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败。') }
  }

  const saveSettings = async (): Promise<void> => {
    if (settingsBusy) return
    setSettingsBusy(true); setError('')
    try {
      const value = await window.singularity.images.saveSettings({
        minimaxKey: keyInput.trim() || undefined, minimaxBaseUrl: baseUrl, ...params,
      })
      setSettings(value); setBaseUrl(value.minimaxBaseUrl); setKeyInput('')
      setSettingsOpen(false); setNotice('设置已保存；保存与连接检查都不会调用云端接口。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存设置失败。') }
    finally { setSettingsBusy(false) }
  }

  const current = assets.find(item => item.id === selected) ?? null
  const firstImage = images[0] ?? null

  return <section className="image-workspace" aria-label="图片生成">
    {/* Left rail — assets, mirroring the MiniMax Design workspace. */}
    <aside className="image-assets">
      <button className="image-new-button" onClick={startNew}><Plus size={15} />开始创作</button>
      <div className="image-recent-label">最近创作<span className="image-count">{assets.length}</span></div>
      <div className="image-recent-list">
        {assets.length === 0 && <p className="image-empty-hint">还没有生成记录。</p>}
        {assets.map(asset => <button key={asset.id} className={`image-recent-item ${selected === asset.id ? 'active' : ''}`} onClick={() => void openAsset(asset)} title={asset.prompt}>
          <span className="image-recent-thumb">{thumbs[asset.id]
            ? <img src={thumbs[asset.id]} alt="" loading="lazy" />
            : <ImageIcon size={14} />}</span>
          <span className="image-recent-text"><strong>{short(asset.prompt, 18)}</strong><small>{asset.area} · {new Date(asset.createdAt).toLocaleDateString('zh-CN')}</small></span>
        </button>)}
      </div>
      <footer className="image-assets-foot">只存在这台电脑上</footer>
    </aside>

    {/* Centre canvas — generated results. */}
    <div className="image-canvas">
      <div className="image-canvas-toolbar">
        <span className="image-canvas-title">{current ? short(current.prompt, 40) : '未命名创作'}</span>
        <div className="image-tool-buttons">
          {firstImage && <a className="image-tool-button" href={firstImage} download={`singularity-${selected ?? 'image'}.${extensionOf(firstImage)}`} aria-label="下载图片" title="下载图片"><Download size={16} /></a>}
          <button className="image-tool-button" disabled={!selected} onClick={() => void window.singularity.images.reveal(selected!)} aria-label="在文件夹中显示" title="在文件夹中显示"><FolderOpen size={16} /></button>
          <button className="image-tool-button" disabled={!selected || busy} onClick={() => void removeSelected()} aria-label="删除图片" title="删除图片"><Trash2 size={16} /></button>
          <button className="image-tool-button" disabled={busy} onClick={() => void loadAssets()} aria-label="刷新资产" title="刷新资产"><RefreshCw size={16} /></button>
        </div>
      </div>
      <div className="image-canvas-body">
        {images.length > 0
          ? <div className={`image-result-grid ${images.length > 1 ? 'multiple' : ''}`}>
              {images.map((src, index) => <figure key={`${selected ?? 'new'}-${index}`} className="image-result"><img src={src} alt={index === 0 ? prompt : `${prompt} ${index + 1}`} /></figure>)}
            </div>
          : <div className="image-canvas-empty"><ImagePlus size={28} strokeWidth={1.25} /><h2>写一句描述，生成第一张图</h2></div>}
        {busy && <div className="image-canvas-busy"><LoaderCircle size={22} className="spin" /><strong>正在生成…</strong><span>4K 图片可能需要十几秒，请勿关闭页面。</span><button onClick={() => void cancel()}><Square size={12} />停止生成</button></div>}
      </div>
      <div className="image-canvas-meta">
        {current ? <>
          <span>{current.model.replace('MiniMax-', '')}</span><span>{current.area} · {current.aspectRatio}</span>
          <span>{current.size || current.format.toUpperCase()}</span><span>{(current.bytes / 1024 / 1024).toFixed(2)} MB</span>
          <span className="image-meta-prompt">{short(current.prompt, 70)}</span>
        </> : <span>没有选中图片</span>}
      </div>
    </div>

    {/* Right rail — prompt, parameters and generation history. */}
    <aside className="image-composer">
      <header className="image-composer-head"><h2>画面</h2>
        <button className="image-tool-button" onClick={() => setSettingsOpen(true)} aria-label="图片生成设置" title="图片生成设置"><Settings size={16} /></button></header>
      <div className="image-composer-form">
        <label className="image-prompt-label" htmlFor="image-prompt">描述</label>
        <textarea id="image-prompt" ref={textarea} value={prompt} maxLength={8000} placeholder="例如：深色背景下的发光水母，胶片质感，柔和侧光" onChange={event => setPrompt(event.target.value)} />
        <div className="image-param-grid">
          <label>模型<select value={params.model} onChange={event => setParams({ ...params, model: event.target.value as ImageModel })}>
            {IMAGE_MODELS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select></label>
          <label>清晰度<select value={params.area} onChange={event => setParams({ ...params, area: event.target.value as ImageArea })}>
            {IMAGE_AREAS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select></label>
          <label>画幅<select value={params.aspectRatio} onChange={event => setParams({ ...params, aspectRatio: event.target.value })}>
            {IMAGE_ASPECT_RATIOS.map(value => <option key={value} value={value}>{value === 'auto' ? '自动' : value}</option>)}
          </select></label>
          <label>格式<select value={params.format} onChange={event => setParams({ ...params, format: event.target.value as ImageFormat })}>
            {IMAGE_FORMATS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select></label>
          <label className="image-param-wide">数量<select value={params.count} onChange={event => setParams({ ...params, count: Number(event.target.value) })}>
            {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value} 张</option>)}
          </select></label>
        </div>
        {notice && <p className="image-notice" role="status">{notice}</p>}
        {error && <p className="image-error" role="alert">{error}</p>}
        <div className="image-composer-actions">
          {busy
            ? <button className="image-stop-button" onClick={() => void cancel()}><Square size={12} />停止生成</button>
            : <button className="image-generate-button" disabled={!prompt.trim() || !settings} onClick={() => void generate()}><ImagePlus size={15} />生成图片</button>}
        </div>
        <p className="image-billing-note">按成功出图计费，4K 更贵。不会自动重试。</p>
      </div>
    </aside>

    {settingsOpen && <div className="image-settings-scrim" onClick={() => !settingsBusy && setSettingsOpen(false)}>
      <section className="image-settings-panel" role="dialog" aria-label="图片生成设置" onClick={event => event.stopPropagation()}>
        <header><div><h3>MiniMax API</h3><p>图片与语音共用同一份加密保存的 Key</p></div><button aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={17} /></button></header>
        <label>API Key<input type="password" autoComplete="new-password" value={keyInput} placeholder={settings?.hasMiniMaxCredential ? '已加密保存，留空沿用' : '粘贴 MiniMax API Key'} onChange={event => setKeyInput(event.target.value)} /></label>
        <label>服务区<select value={baseUrl} onChange={event => setBaseUrl(event.target.value)}><option value="https://api.minimax.cn">国内 · api.minimax.cn</option><option value="https://api.minimax.io">国际 · api.minimax.io</option></select></label>
        <p className="image-settings-note">国内 Key 请用国内服务区，两站 Key 不通用。右下角的模型、清晰度、画幅、数量与格式会一起保存为默认值。保存和连接检查都不会调用云端接口，也不会产生费用。</p>
        <footer><button className="image-settings-save" disabled={settingsBusy} onClick={() => void saveSettings()}>{settingsBusy ? '保存中…' : '保存设置'}</button></footer>
      </section>
    </div>}
  </section>
}
