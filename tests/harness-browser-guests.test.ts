import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const sessions = vi.hoisted(() => new Map<string, any>())
vi.mock('electron', () => ({ app: {isPackaged: false}, session: {fromPartition: (partition: string) => {
  const value = { on: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(), setDisplayMediaRequestHandler: vi.fn(), webRequest: {onBeforeRequest: vi.fn()} }
  sessions.set(partition, value)
  return value
}} }))
import { DesktopBrowserGuests } from '../src/main/harness-browser-guests'

describe('upstream desktop browser isolation', () => {
  it('uses memory-only workspace partitions, authenticates leases, and replaces unsafe guest preferences', async () => {
    const manager = new DesktopBrowserGuests(() => 'http://127.0.0.1:12345')
    const owner = new EventEmitter() as any, other = new EventEmitter() as any
    const a = manager.acquire(owner, 'workspace-a'), b = manager.acquire(owner, 'workspace-a'), c = manager.acquire(owner, 'workspace-b')
    expect(a.partition).toBe(b.partition); expect(c.partition).not.toBe(a.partition)
    expect(a.partition.startsWith('persist:')).toBe(false)
    await expect(manager.release(other, a.lease)).rejects.toThrow('another window')
    manager.bind(owner, () => () => {})
    const blocked = {preventDefault: vi.fn()}
    owner.emit('will-attach-webview', blocked, {}, {src:`about:blank#${a.lease}`, partition:c.partition})
    expect(blocked.preventDefault).toHaveBeenCalled()
    const preferences = {preload:'unsafe.js',nodeIntegration:true} as any
    const approved = {preventDefault:vi.fn()}
    owner.emit('will-attach-webview', approved, preferences, {src:`about:blank#${a.lease}`,partition:a.partition})
    expect(approved.preventDefault).not.toHaveBeenCalled()
    expect(preferences.preload).toBeUndefined()
    expect(preferences).toMatchObject({nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false})
    const duplicate = {preventDefault:vi.fn()}
    owner.emit('will-attach-webview',duplicate,{}, {src:`about:blank#${a.lease}`,partition:a.partition})
    expect(duplicate.preventDefault).toHaveBeenCalled()
    const session = sessions.get(a.partition)
    const filter = session.webRequest.onBeforeRequest.mock.calls[0][0]
    for (const url of ['file:///C:/secret.txt','http://localhost:12345/private','http://127.0.0.1:12345/','http://[::1]:12345/','https://user:password@example.com']) {
      const callback = vi.fn();filter({url},callback);expect(callback).toHaveBeenCalledWith({cancel:true})
    }
    const callback=vi.fn();filter({url:'https://example.com/paper'},callback);expect(callback).toHaveBeenCalledWith({cancel:false})
    const permission=vi.fn();session.setPermissionRequestHandler.mock.calls[0][0](null,'media',permission)
    expect(permission).toHaveBeenCalledWith(false)
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    await manager.release(owner,a.lease)
  })
})
