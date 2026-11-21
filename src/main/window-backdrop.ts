import { nativeTheme, type BrowserWindow } from 'electron'

/** Every chat theme, transparent included, sits on Acrylic so the desktop reads as frosted glass. */
export function applyWindowsBackdrop(window: BrowserWindow, platform = process.platform): void {
  if(platform!=='win32'||window.isDestroyed())return
  const reduced=nativeTheme.prefersReducedTransparency||nativeTheme.shouldUseHighContrastColors
  const color=reduced?(nativeTheme.shouldUseDarkColors?'#202020':'#f3f3f3'):'#00000000'
  window.setBackgroundMaterial('none')
  if(!reduced)window.setBackgroundMaterial('acrylic')
  // Material changes recreate native views; clear their fallback color afterwards.
  window.setBackgroundColor(color)
  window.contentView.setBackgroundColor(color)
}

export function keepWindowsBackdrop(window: BrowserWindow, platform = process.platform): () => void {
  if(platform!=='win32')return()=>{}
  let timer:ReturnType<typeof setTimeout>|null=null
  const refresh=()=>{
    if(timer)clearTimeout(timer)
    timer=setTimeout(()=>{
      timer=null
      applyWindowsBackdrop(window,platform)
    },16)
  }
  const dispose=()=>{
    if(timer)clearTimeout(timer)
    timer=null
    window.removeListener('show',refresh);window.removeListener('restore',refresh);window.removeListener('focus',refresh)
    nativeTheme.removeListener('updated',refresh)
    window.removeListener('closed',dispose)
  }
  window.on('show',refresh);window.on('restore',refresh);window.on('focus',refresh)
  nativeTheme.on('updated',refresh)
  window.once('closed',dispose)
  return dispose
}
