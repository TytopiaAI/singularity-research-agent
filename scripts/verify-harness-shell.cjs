/* Real native assistant + shell check for the in-pane DeepSeek history dock.
   Isolated data, no model calls, no installed-app data.
   The inner sidebar is vertical, subtly shaded and controlled by the existing
   top-left toggle, without changing the outer application navigation. */
const { app, BrowserWindow, dialog } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.local-data', 'harness-shell-verification', String(Date.now()))
fs.mkdirSync(output, { recursive: true })
process.env.SINGULARITY_PROJECT_ROOT = root
process.env.SINGULARITY_DATA_ROOT = path.join(output, 'data')
const report = { output, checks: [], errors: [], themes: {} }
dialog.showErrorBox = (title, message) => report.errors.push(`${title}: ${message}`)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, timeout = 90000) {
  const start = Date.now()
  while (Date.now() - start < timeout) { if (await fn()) return; await wait(100) }
  throw Error(`Timeout: ${label}`)
}

const RAIL_STATE = `(() => {
  const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }
  const st = e => e ? getComputedStyle(e) : null
  const frame = document.querySelector('.pI_x6G_frame')
  const rail = document.querySelector('.pI_x6G_sidebarCol')
  const center = document.querySelector('.pI_x6G_centerCol')
  const btn = document.querySelector('#singularity-rail-toggle')
  const ns = document.querySelector('.hHd-Xa_newSession')
  const root = document.querySelector('.hHd-Xa_root')
  const region = document.querySelector('.hHd-Xa_regionArea')
  return {
    collapsed: document.body.hasAttribute('data-singularity-rail-collapsed'),
    frame: frame ? { ...box(frame), display: st(frame).display, cols: st(frame).gridTemplateColumns } : null,
    rail: rail ? { ...box(rail), display: st(rail).display, bg: st(rail).backgroundColor,
      filter: st(rail).backdropFilter, position: st(rail).position,
      borderTop: st(rail).borderTopColor } : null,
    railRootBg: root ? st(root).backgroundColor : null,
    railRootFilter: root ? st(root).backdropFilter : null,
    dockDirection: root ? st(root).flexDirection : null,
    center: center ? { ...box(center), display: st(center).display, padBottom: st(center).paddingBottom } : null,
    button: btn ? { ...box(btn), aria: btn.getAttribute('aria-pressed'), label: btn.getAttribute('aria-label'), svgs: btn.querySelectorAll('svg').length, tips: Array.from(btn.querySelectorAll('.sg-rail-tip')).map(t => t.textContent) } : null,
    newSession: ns ? { ...box(ns) } : null,
    region: region ? { ...box(region), display: st(region).display } : null,
    htmlTheme: document.documentElement.dataset.singularityChatTheme,
    windowsTitlebar: document.documentElement.hasAttribute('data-windows-titlebar'),
  }
})()`

const BOTTOM_READ = `(() => {
  const seat = document.querySelector('.wSkVaW_composerSeat')
  const row = document.querySelector('.pI_x6G_bottomRow')
  const body = getComputedStyle(document.body)
  return {
    seatImg: seat ? getComputedStyle(seat).backgroundImage : null,
    seatBg: seat ? getComputedStyle(seat).backgroundColor : null,
    seatFilter: seat ? getComputedStyle(seat).backdropFilter : null,
    rowBg: row ? getComputedStyle(row).backgroundColor : null,
    rowFilter: row ? getComputedStyle(row).backdropFilter : null,
    surface: body.getPropertyValue('--sg-surface').trim(),
    acrylic: body.getPropertyValue('--sg-acrylic').trim(),
    rail: body.getPropertyValue('--sg-rail').trim(),
    phase: document.querySelector('.wSkVaW_root')?.getAttribute('data-phase') || null,
  }
})()`

const SET_ACTIVE = `(() => { const r = document.querySelector('.wSkVaW_root'); if (r) r.setAttribute('data-phase', 'active'); const e = document.querySelector('.wSkVaW_embeddedBody'); if (e) e.setAttribute('data-content-phase', 'active') })()`
const RESTORE_PHASE = `(() => { const r = document.querySelector('.wSkVaW_root'); if (r) r.setAttribute('data-phase', 'hero'); const e = document.querySelector('.wSkVaW_embeddedBody'); if (e) e.removeAttribute('data-content-phase') })()`

async function main() {
  await import(pathToFileURL(path.join(root, 'dist-electron/main.js')).href)
  let win
  await until(() => { win = BrowserWindow.getAllWindows()[0]; return !!win }, 'window')
  const js = code => win.webContents.executeJavaScript(code, true)
  await until(() => js('Boolean(window.singularity && document.querySelector(".main-content"))').catch(() => false), 'shell')
  await until(() => js('window.singularity.runtime.get().then(s => s.phase === "ready")'), 'runtime')
  const native = () => win.contentView.children.find(view => view.webContents && view.webContents !== win.webContents)
  await until(() => native() && !native().webContents.isLoading(), 'assistant')
  const njs = code => native().webContents.executeJavaScript(code, true)
  const contents = () => native().webContents
  const nativePoint = selector => njs(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  const mouseClickNative = async selector => {
    const point = await nativePoint(selector)
    assert(point, 'native element missing: ' + selector)
    contents().sendInputEvent({ type: 'mouseMove', ...point })
    contents().sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    await wait(60)
    contents().sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
  }
  const capture = async name => fs.writeFileSync(path.join(output, name), (await contents().capturePage()).toPNG())

  await until(() => njs('Boolean(document.querySelector(".pXSMma_headline"))'), 'assistant content')
  for (let i = 0; i < 8; i++) {
    const clicked = await njs(`(() => { const buttons = Array.from(document.querySelectorAll('[role="dialog"] button')); const button = buttons.find(b => ['稍后配置', 'Configure later'].includes(b.textContent.trim())) ?? buttons.find(b => ['添加 API Key', 'Add API key'].includes(b.textContent.trim())); if (!button) return false; button.click(); return true })()`)
    await wait(200)
    if (!clicked && i > 2) break
  }
  await until(() => njs('Boolean(document.querySelector("#singularity-chat-appearance"))'), 'native picker')
  await until(() => njs('Boolean(document.querySelector("#singularity-rail-toggle"))'), 'top-left rail control')
  contents().setBackgroundThrottling(false)

  // The main pane's colour is intentionally theme-dependent; only its geometry is fixed.
  const shellBaseline = () => js(`JSON.stringify(['.app-sidebar', '.titlebar', '.main-content'].map(s => { const e = document.querySelector(s), c = getComputedStyle(e), r = e.getBoundingClientRect(); return { bg: s === '.main-content' ? 'theme-dependent' : c.backgroundColor, rect: [r.x, r.y, r.width, r.height].map(Math.round) } }))`)
  const baseline = await shellBaseline()

  // 1. The history dock is a bottom strip INSIDE the tinted assistant pane and
  //    the conversation column is back at full width (no forced grid columns).
  const initial = await njs(RAIL_STATE)
  report.initial = initial
  assert.equal(initial.collapsed, false, 'history dock starts expanded')
  assert.equal(initial.frame.display, 'block', 'frame no longer forces a two-column grid, got ' + initial.frame.display)
  assert.equal(initial.rail.display, 'block', 'history dock is visible without opening a drawer')
  assert.equal(initial.rail.position, 'absolute', 'sidebar is positioned within the assistant frame')
  assert.equal(initial.rail.x, initial.frame.x, 'sidebar anchors to inner left')
  assert(initial.rail.w >= 180 && initial.rail.w <= 250, 'sidebar has a bounded width')
  assert.equal(initial.rail.h, initial.frame.h, 'sidebar fills the pane height')
  assert.equal(initial.center.w + initial.rail.w, initial.frame.w, 'sidebar and conversation fit without overlap')
  assert.equal(initial.center.x, initial.rail.x + initial.rail.w, 'conversation starts after sidebar')
  assert.equal(initial.dockDirection, 'column', 'history is arranged vertically')
  assert(initial.newSession.w > 0 && initial.newSession.h > 0, 'new-session button is visible in the dock')
  assert(initial.region && initial.region.w > 0, 'workspace / conversation region is visible in the dock')
  assert.equal(initial.button.svgs, 2, 'top-left control uses inline vector icons')
  assert.equal(initial.button.aria, 'true', 'control reports expanded state')
  assert(initial.button.tips.includes('隐藏会话列表') && initial.button.tips.includes('显示会话列表'), 'control has both hover labels')
  report.checks.push('History occupies the inner left sidebar; conversation fills remaining space and vector toggle is present')
  await wait(300)
  await capture('rail-expanded.png')

  // 2. The dock uses the SAME colour as the pane: no fill, no white, no blur.
  const railBgIsWhite = bg => /^rgb\(255,\s*255,\s*255\)$/.test(bg)
  const transparent = bg => /^rgba\([^)]*,\s*0\)$/.test(bg) || bg === 'transparent'
  assert.equal(initial.rail.bg, 'rgba(0, 0, 0, 0.03)', 'sidebar darkens the underlying theme by 3%')
  assert(transparent(initial.railRootBg), 'dock root paints no fill of its own, got ' + initial.railRootBg)
  assert(!railBgIsWhite(initial.rail.bg), 'dock is not opaque white')
  assert(!/blur/.test(initial.rail.filter || ''), 'dock adds no glass blur, got ' + initial.rail.filter)
  assert(!/blur/.test(initial.railRootFilter || ''), 'dock root adds no glass blur, got ' + initial.railRootFilter)
  report.checks.push('Sidebar adds only a 3% dark veil over the existing theme, with no opaque fill')

  // 3. Hover tooltip on the vector control.
  const tipPoint = await nativePoint('#singularity-rail-toggle')
  contents().sendInputEvent({ type: 'mouseMove', ...tipPoint })
  await wait(320)
  const tip = await njs(`({ open: getComputedStyle(document.querySelector('#singularity-rail-toggle .sg-tip-open')).opacity, text: document.querySelector('#singularity-rail-toggle .sg-tip-open').textContent })`)
  assert(Number(tip.open) > 0.9, 'hover tooltip becomes visible, got opacity ' + tip.open)
  assert.equal(tip.text, '隐藏会话列表')
  await capture('rail-hover.png')
  report.checks.push('Vector control shows an accessible text tooltip on hover')

  // 4. Real mouse click on the control collapses / restores the rail.
  await mouseClickNative('#singularity-rail-toggle')
  await until(() => njs('document.body.hasAttribute("data-singularity-rail-collapsed")'), 'rail collapsed by control')
  const collapsed = await njs(RAIL_STATE)
  assert.equal(collapsed.rail.display, 'none', 'dock hidden when collapsed')
  assert.equal(collapsed.center.x, collapsed.frame.x, 'conversation reclaims the full pane')
  assert.equal(collapsed.center.w, collapsed.frame.w, 'conversation keeps the full pane width')
  assert.equal(collapsed.center.padBottom, '0px', 'bottom padding is released when the dock is hidden, got ' + collapsed.center.padBottom)
  assert.equal(collapsed.button.aria, 'false', 'control reports collapsed state')
  assert.equal(await shellBaseline(), baseline, 'outer sidebar / titlebar / main pane unchanged by rail toggle')
  await wait(350) // let the compositor settle; capturePage can otherwise return the previous frame
  report.captureStates = { collapsed: await njs('document.body.hasAttribute("data-singularity-rail-collapsed")') }
  assert.equal(report.captureStates.collapsed, true, 'capture really shows the collapsed rail')
  await capture('rail-collapsed.png')
  await mouseClickNative('#singularity-rail-toggle')
  await until(() => njs('!document.body.hasAttribute("data-singularity-rail-collapsed")'), 'rail restored by control')
  report.checks.push('Top-left vector control hides and restores the in-pane rail; outer shell geometry is untouched')

  // 4b. Regression guard: no rule may force a sidebar column width on the
  //     frame. Harness owns its inline grid (rightbar + Windows titlebar
  //     clearance), and overriding it is what broke the hero layout before.
  const forcedColumns = await njs(`Array.from(document.styleSheets).flatMap(sheet => { try { return Array.from(sheet.cssRules || []) } catch { return [] } })
    .filter(rule => /pI_x6G_frame/.test(rule.selectorText || '') && /grid-template-columns\\s*:[^;]*(268px|224px|56px)/.test(rule.cssText || ''))
    .map(rule => rule.selectorText)`)
  assert.equal(forcedColumns.length, 0, 'no forced sidebar column remains, got ' + JSON.stringify(forcedColumns))
  assert.equal(initial.center.w + initial.rail.w, initial.frame.w, 'expanded sidebar does not clip the hero')
  report.checks.push('No forced grid columns: Harness keeps its own layout and the hero is never squeezed or clipped')

  // 5. The existing titlebar history button keeps working on the same state.
  await js(`document.querySelector('[aria-label="会话历史"]').click()`)
  await until(() => njs('document.body.hasAttribute("data-singularity-rail-collapsed")'), 'titlebar history collapses rail')
  assert.equal((await njs(RAIL_STATE)).rail.display, 'none')
  report.checks.push('Existing titlebar history button still toggles the history rail')

  // 6. Returning to the "new conversation" landing page works even with the rail collapsed.
  await njs(`window.__newSessionClicks = 0; window.__panelEvents = []; document.querySelector('.hHd-Xa_newSession')?.addEventListener('click', () => { window.__newSessionClicks++ }, true); window.addEventListener('singularity:select-panel', e => window.__panelEvents.push(e.detail))`)
  await js(`document.querySelector('[aria-label="新建会话"]').click()`)
  await until(() => njs('window.__newSessionClicks > 0'), 'new-session button receives the click')
  await until(() => njs('window.__panelEvents.includes("assistant")'), 'assistant panel reselected')
  assert.equal(await njs('Boolean(document.querySelector(".pXSMma_headline"))'), true, 'landing page headline is present')
  assert.equal(await njs('document.querySelector(".wSkVaW_root")?.getAttribute("data-phase")'), 'hero', 'landing page phase is hero')
  report.checks.push('After a conversation, the existing "新建会话" action returns to the hero landing page even with the rail collapsed')
  await mouseClickNative('#singularity-rail-toggle')
  await until(() => njs('!document.body.hasAttribute("data-singularity-rail-collapsed")'), 'rail expanded again')

  // 7. Bottom of the conversation view follows every theme, no white band.
  for (const theme of ['warm', 'blue', 'purple', 'green', 'transparent']) {
    await njs(`document.querySelector('[data-chat-theme="${theme}"]').click()`)
    await until(() => js(`document.querySelector('.main-content').dataset.chatTheme === ${JSON.stringify(theme)}`), `shell theme ${theme}`, 8000)
    await until(() => njs(`document.documentElement.dataset.singularityChatTheme === ${JSON.stringify(theme)}`), `native theme ${theme}`, 8000)
    await wait(250)
    const state = await njs(RAIL_STATE)
    assert(!railBgIsWhite(state.rail.bg), `${theme}: dock is not white, got ${state.rail.bg}`)
    assert.equal(state.rail.bg, 'rgba(0, 0, 0, 0.03)', `${theme}: sidebar darkens the same theme by 3%`)
    assert(transparent(state.railRootBg), `${theme}: dock root keeps the pane colour, got ${state.railRootBg}`)
    assert(!/blur/.test(state.rail.filter || ''), `${theme}: dock has no glass blur, got ${state.rail.filter}`)
    await njs(SET_ACTIVE)
    await wait(160)
    const bottom = await njs(BOTTOM_READ)
    await njs(RESTORE_PHASE)
    assert(!/rgb\(255,\s*255,\s*255\)/.test(bottom.seatImg || ''), `${theme}: composer seat still has a white gradient: ${bottom.seatImg}`)
    assert(/gradient\(/.test(bottom.seatImg || ''), `${theme}: composer seat keeps its fade, got ${bottom.seatImg}`)
    const stops = (bottom.seatImg.match(/rgba?\([^)]+\)/g) || [])
    // A near-white stop is only acceptable as a thin glass veil (the transparent
    // theme), never as an opaque block that would read as a white band.
    const whiteStops = stops.filter(c => /^rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(c))
    assert(!whiteStops.some(c => { const parts = c.match(/[\d.]+/g) || []; return Number(parts[3] ?? 1) >= 0.5 }),
      `${theme}: composer seat has an opaque white colour stop: ${bottom.seatImg}`)
    assert(!railBgIsWhite(bottom.rowBg || ''), `${theme}: bottom status row is not white, got ${bottom.rowBg}`)
    const rowRgb = (bottom.rowBg.match(/[\d.]+/g) || []).slice(0, 3).join(',')
    if (theme === 'transparent') {
      // This theme sits on real acrylic, so the seat mirrors the pane glass and
      // blurs what scrolls under it instead of laying down an opaque light fill.
      const acrylicRgb = (bottom.acrylic.match(/[\d.]+/g) || []).slice(0, 3).join(',')
      const acrylicAlpha = Number((bottom.acrylic.match(/[\d.]+/g) || [])[3] ?? 1)
      assert.equal(rowRgb, acrylicRgb, `${theme}: bottom row equals the pane glass (${bottom.acrylic}), got ${bottom.rowBg}`)
      assert(acrylicAlpha <= 0.34, `${theme}: pane glass stays translucent, got ${bottom.acrylic}`)
      assert(/blur/.test(bottom.seatFilter || ''), `${theme}: composer seat blurs its backdrop, got ${bottom.seatFilter}`)
      assert(/blur/.test(bottom.rowFilter || ''), `${theme}: status row blurs its backdrop, got ${bottom.rowFilter}`)
    } else {
      const surfaceRgb = (bottom.surface.match(/[\d.]+/g) || []).slice(0, 3).join(',')
      assert.equal(rowRgb, surfaceRgb, `${theme}: bottom row equals the theme surface (${bottom.surface}), got ${bottom.rowBg}`)
    }
    report.themes[theme] = { railBg: state.rail.bg, railRootBg: state.railRootBg, ...bottom }
    await capture(`theme-${theme}.png`)
  }
  const distinct = new Set(['warm', 'blue', 'purple', 'green', 'transparent'].map(t => report.themes[t].railBg))
  assert.equal(distinct.size, 1, 'the dock never introduces a second colour, got ' + JSON.stringify([...distinct]))
  const surfaces = new Set(['warm', 'blue', 'purple', 'green', 'transparent'].map(t => report.themes[t].surface))
  assert.equal(surfaces.size, 5, 'each chat theme gets its own bottom surface')
  report.checks.push('All five themes: sidebar retains the theme with a 3% shade and the bottom composer/status background follows the theme; no white band in active phase')

  // 8. Dark appearance.
  await js('window.singularity.runtime.setTheme("dark");document.documentElement.dataset.theme="dark"')
  await njs(`document.querySelector('[data-chat-theme="blue"]').click()`)
  await until(() => njs('document.body.hasAttribute("data-ds-dark-theme")'), 'dark theme propagated', 15000)
  await wait(300)
  const dark = await njs(RAIL_STATE)
  assert(!railBgIsWhite(dark.rail.bg), 'dark: dock is not white')
  assert.equal(dark.rail.bg, 'rgba(0, 0, 0, 0.03)', 'dark: sidebar retains the same subtle shade')
  assert(transparent(dark.railRootBg), 'dark: dock root keeps the pane colour, got ' + dark.railRootBg)
  await njs(SET_ACTIVE)
  await wait(160)
  const darkBottom = await njs(BOTTOM_READ)
  await njs(RESTORE_PHASE)
  assert(!/rgb\(255,\s*255,\s*255\)/.test(darkBottom.seatImg || ''), 'dark: composer seat is not white')
  assert(!railBgIsWhite(darkBottom.rowBg || ''), 'dark: bottom row is not white')
  report.themes['dark-blue'] = { railBg: dark.rail.bg, ...darkBottom }
  await capture('theme-dark-blue.png')
  report.checks.push('Dark appearance keeps the sidebar subtly shaded and the bottom surface dark')
  await js('window.singularity.runtime.setTheme("light");document.documentElement.dataset.theme="light"')

  // 9. Outer shell never changed through any of the above.
  assert.equal(await shellBaseline(), baseline, 'outer sidebar, titlebar and main pane are byte-identical after all interactions')
  assert.equal(await js('typeof window.singularity.runtime.assistantAction'), 'function', 'titlebar actions remain exposed')
  report.checks.push('Outer sidebar / titlebar structure, styles and interactions are unaffected')

  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
main().catch(error => {
  report.errors.push(String(error.stack || error))
  fs.writeFileSync(path.join(output, 'failed.json'), JSON.stringify(report, null, 2))
  console.error(error)
}).finally(() => { app.exit(report.errors.length ? 1 : 0) })
