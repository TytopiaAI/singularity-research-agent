// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStartupSequence } from './startup-sequence'
import { chooseStartupVariant, startupHistoryKey, type StartupVariant } from './StartupSplash'

let root: Root, host: HTMLDivElement, sequence: ReturnType<typeof useStartupSequence>
let reduced = false
it('cycles all four animations across launches and resumes saved progress', () => {
  const data = new Map<string, string>()
  const storage = () => ({ getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } })
  // Recreate the storage adapter on every launch, keeping only its persisted data.
  expect(Array.from({ length: 9 }, () => chooseStartupVariant(storage())))
    .toEqual(['planets', 'willow', 'sail', 'armor', 'planets', 'willow', 'sail', 'armor', 'planets'])
  expect(data.get(startupHistoryKey)).toBe('planets')
  data.set(startupHistoryKey, 'invalid')
  expect(chooseStartupVariant(storage())).toBe('planets')
})
it.each(['read', 'write'])('uses equal 25% odds only when storage cannot %s', operation => {
  const storage = { getItem: () => { if(operation==='read')throw Error('Storage blocked');return 'armor' }, setItem: () => { throw Error('Storage full') } }
  expect([0, .249999, .25, .499999, .5, .749999, .75, .999999].map(sample => chooseStartupVariant(storage, sample)))
    .toEqual(['planets', 'planets', 'willow', 'willow', 'sail', 'sail', 'armor', 'armor'])
})
function Fixture({ phase, variant = 'armor' }: { phase: string; variant?: StartupVariant }) {
  sequence = useStartupSequence(phase, variant)
  return <div data-complete={sequence.complete} data-leaving={sequence.leaving}/>
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  reduced = false
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: reduced }) })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers() })
const render = async (phase: string, variant?: StartupVariant) => act(async () => root.render(<Fixture phase={phase} variant={variant}/>))
const advance = async (time: number) => act(async () => { vi.advanceTimersByTime(time) })
it('waits for both the suit reveal and backend, then fades into the application', async () => {
  await render('starting'); await advance(1000); await render('ready')
  expect(sequence.complete).toBe(false); await advance(4199); expect(sequence.leaving).toBe(false)
  await advance(1); expect(sequence.leaving).toBe(true); expect(sequence.complete).toBe(false)
  await advance(480); expect(sequence.complete).toBe(true)
})
it('opens the local desktop after the reveal even if the backend is still starting', async () => {
  await render('starting'); await advance(5200)
  expect(sequence.leaving).toBe(true)
  await advance(480); expect(sequence.complete).toBe(true)
  await render('ready'); expect(sequence.complete).toBe(true)
})
it('lets users skip into local pages without pretending the backend is ready', async () => {
  await render('starting'); await act(async () => sequence.skip()); await advance(480)
  expect(sequence.complete).toBe(true)
})
it.each(['planets', 'willow', 'sail'] as const)('bounds the %s wait when the backend is slow', async variant => {
  await render('starting', variant); await advance(5200); await advance(480)
  expect(sequence.complete).toBe(true)
})
it('allows early entry once ready and exposes startup errors immediately', async () => {
  await render('ready'); await act(async () => sequence.skip()); await advance(480)
  expect(sequence.complete).toBe(true)
  await act(async () => { root.unmount(); root = createRoot(host) })
  await render('error'); expect(sequence.complete).toBe(true)
})
it('does not delay the other styles or reduced-motion users', async () => {
  await render('ready', 'sail'); expect(sequence.complete).toBe(true)
  await act(async () => { root.unmount(); root = createRoot(host) })
  reduced = true; await render('ready'); await advance(0); await advance(0)
  expect(sequence.complete).toBe(true)
})
