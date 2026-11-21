import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
const theme=vi.hoisted(()=>({prefersReducedTransparency:false,shouldUseHighContrastColors:false,on:vi.fn(),removeListener:vi.fn()}))
vi.mock('electron',()=>({nativeTheme:theme}))
import { keepWindowsBackdrop } from './window-backdrop'
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();theme.prefersReducedTransparency=false;theme.shouldUseHighContrastColors=false})
it('refreshes the existing acrylic after restore/focus, coalesces events and disposes timers/listeners',()=>{
 vi.useFakeTimers()
 const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,contentView:{setBackgroundColor:vi.fn()},setBackgroundColor:vi.fn(),setBackgroundMaterial:vi.fn()})
 const dispose=keepWindowsBackdrop(win as unknown as BrowserWindow,'win32')
 win.emit('restore');win.emit('focus');vi.advanceTimersByTime(20)
 expect(win.setBackgroundMaterial.mock.calls).toEqual([['none'],['acrylic']])
 expect(win.contentView.setBackgroundColor).toHaveBeenCalledWith('#00000000')
 win.emit('focus');win.emit('closed');vi.advanceTimersByTime(20)
 expect(win.setBackgroundMaterial).toHaveBeenCalledTimes(2)
 expect(win.listenerCount('focus')).toBe(0);expect(theme.removeListener).toHaveBeenCalledWith('updated',expect.any(Function));dispose()
})
it('respects reduced transparency and high contrast without changing system preferences',()=>{
 vi.useFakeTimers()
 const win=Object.assign(new EventEmitter(),{isDestroyed:()=>false,contentView:{setBackgroundColor:vi.fn()},setBackgroundColor:vi.fn(),setBackgroundMaterial:vi.fn()})
 const dispose=keepWindowsBackdrop(win as unknown as BrowserWindow,'win32')
 theme.prefersReducedTransparency=true;win.emit('show');vi.advanceTimersByTime(20)
 theme.prefersReducedTransparency=false;theme.shouldUseHighContrastColors=true;win.emit('focus');vi.advanceTimersByTime(20)
 expect(win.setBackgroundMaterial.mock.calls).toEqual([['none'],['none']])
 expect(win.setBackgroundColor).toHaveBeenLastCalledWith('#f3f3f3');dispose()
})
