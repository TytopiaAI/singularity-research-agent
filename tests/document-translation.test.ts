import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTranslationBlocks, DocumentTranslationService } from '../src/main/document-translation'
import { parseTranslationResult, translationBatches, translationLayoutRevision, translationRequestBlocks, type DocumentTranslation } from '../src/shared/document-translation'
import type { PdfPageText } from '../src/renderer/pdf-document-paragraphs'
import type { PaperRecord } from '../src/shared/types'
import { minimalTextPdf } from './helpers/minimal-pdf'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const action of cleanup.splice(0)) await action() })
const page = (pageNumber: number, rows: Array<[string, number]>): PdfPageText => ({ pageNumber,
  viewport: { width: 612, height: 792, convertToViewportPoint: (x, y) => [x, 792 - y] },
  items: rows.map(([str, top]) => ({ str, width: Math.min(470, str.length * 5), height: 12, transform: [12, 0, 0, 12, 72, 792 - top] })) })
const document = (): DocumentTranslation => ({ version: 1, layoutRevision: translationLayoutRevision, checksum: 'hash',
  blocks: buildTranslationBlocks([page(1, [['Abstract', 100], ['A novel method provides reliable evidence.', 125], ['1. Introduction', 170], ['The objective is defined below.', 195], ['y = x + 1 (1)', 240], ['References', 300], ['[1] A reference excluded from translation.', 330]]), page(2, [['Appendix A. Additional Experiments', 90], ['Extra results provide additional evidence.', 120]])]),
  translations: {}, running: [], errors: {} })
async function setup() {
  const parent = path.join(process.cwd(), '.local-data', 'temp'); await fs.mkdir(parent, { recursive: true })
  const root = await fs.mkdtemp(path.join(parent, 'translation-')); cleanup.push(() => fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }))
  const paper = { id: 'paper', checksum: 'hash', sourcePath: path.join(root, 'paper.pdf'), indexStatus: 'ready' } as PaperRecord
  const file = path.join(root, paper.id, 'translation-v1-hash.json'); await fs.mkdir(path.dirname(file))
  await fs.writeFile(file, JSON.stringify(document()))
  return { root, paper, file }
}
const settle = async (service: DocumentTranslationService, scope: 'body' | 'appendix') => {
  await vi.waitFor(async () => expect((await service.get('paper')).running).not.toContain(scope))
}
describe('persistent document translation', () => {
  it('separates appendix after references and preserves formulas without sending them to the model', () => {
    const value = document()
    expect(value.blocks.some((block) => block.text.includes('reference excluded'))).toBe(false)
    expect(value.blocks.find((block) => block.text === 'A novel method provides reliable evidence.')?.kind).toBe('paragraph')
    expect(value.blocks.find((block) => block.kind === 'formula')?.text).toBe('y = x + 1 (1)')
    expect(value.blocks.filter((block) => block.scope === 'appendix')).toHaveLength(2)
    expect(translationBatches(value, 'body').flatMap((batch) => batch.blocks).some((block) => block.text.includes('y ='))).toBe(false)
  })
  it('validates complete one-to-one paragraph output, rejecting duplicates and missing paragraphs', () => {
    const batch = translationBatches(document(), 'body')[0]
    expect(() => parseTranslationResult('[]', batch)).toThrow('缺少段落')
    expect(() => parseTranslationResult(JSON.stringify(batch.blocks.map(() => ({ id: batch.blocks[0].id, translation: '译文' }))), batch)).toThrow('不匹配')
  })
  it('protects citation and mathematical scripts, restores them verbatim and rejects missing or duplicated markers', () => {
    const value = document()
    value.blocks = [{ ...value.blocks[1], text: 'Prior work<sup>12–14</sup> defines h<sub>t</sub>.' }]
    const batch = translationBatches(value, 'body')[0], request = translationRequestBlocks(batch)[0]
    expect(request.text).toBe('Prior work⟦PDF_SCRIPT_0⟧ defines h⟦PDF_SCRIPT_1⟧.')
    const response = (translation: string) => JSON.stringify([{ id: request.id, translation }])
    expect(parseTranslationResult(response('前人工作⟦PDF_SCRIPT_0⟧定义 h⟦PDF_SCRIPT_1⟧。'), batch)[request.id]).toBe('前人工作<sup>12–14</sup>定义 h<sub>t</sub>。')
    expect(() => parseTranslationResult(response('前人工作12–14定义 h。'), batch)).toThrow('上下标')
    expect(() => parseTranslationResult(response('⟦PDF_SCRIPT_0⟧⟦PDF_SCRIPT_0⟧⟦PDF_SCRIPT_1⟧'), batch)).toThrow('上下标')
  })
  it('keeps complete display equations in reading order instead of translating their scripts and numbers as paragraphs', () => {
    const input = page(4, [['3.1 CAUSAL VISUAL-READ BOUNDARY', 210], ['We measure the bidirectional effect as', 330], ['where larger effects indicate reliable visual evidence.', 415], ['3.2 PERSISTENT VISUAL RECURRENCE', 560], ['A competent initialization preserves visual ability.', 590]])
    const add = (str: string, x: number, top: number, width: number, height = 10) => input.items.push({ str, width, height, transform: [height, 0, 0, height, x, 792 - top] })
    add('1 h', 211, 347, 11); add('m(ℓ) = 2 M(x) − M(P(x ← x′))', 173, 360, 160)
    add('i', 342, 374, 5); add('m (ℓ)', 410, 378, 24); add('(1)', 492, 373, 12)
    add('+ M(x′) − M(P(x′ ← x)), m(ℓ) = m(0)', 214, 391, 225); add('i', 419, 402, 3, 7)
    add('H = F(I, q)', 220, 480, 170); add('(2)', 492, 480, 12)
    add('h = P H', 210, 690, 200); add('(3)', 492, 690, 12)
    const blocks = buildTranslationBlocks([input])
    expect(blocks.filter((block) => block.kind === 'formula')).toHaveLength(3)
    expect(blocks.filter((block) => block.kind === 'paragraph').map((block) => block.text)).toEqual(['We measure the bidirectional effect as', 'where larger effects indicate reliable visual evidence.', 'A competent initialization preserves visual ability.'])
    expect(blocks.findIndex((block) => block.text.startsWith('3.2'))).toBeGreaterThan(blocks.findIndex((block) => block.text.startsWith('where')))
    const formula = blocks.find((block) => block.kind === 'formula')!
    expect(formula.text).toContain('(1)'); expect(formula.parts[0].rects[0].height).toBeGreaterThan(.07)
    expect(translationBatches({ ...document(), blocks }, 'body').flatMap((batch) => batch.blocks).some((block) => /^\(\d+\)$|^i$|^m \(ℓ\)$/.test(block.text))).toBe(false)
  })
  it('keeps prose with inline equations translatable', () => {
    const blocks = buildTranslationBlocks([page(1, [['We define h = 0 before initialization.', 100], ['where x = 1 denotes the reference state.', 150]])])
    expect(blocks.every((block) => block.kind === 'paragraph')).toBe(true)
  })
  it('preserves a chart as one figure and never translates its internal values or labels', () => {
    const input=page(2,[['2 PRELIMINARY EXPERIMENTS',100],['Clean latent Blank-image latent',250],['82.7',280],['81.2 80.1',300],['Figure 1: Preliminary diagnostics motivating the method.',370],['The controlled experiment preserves visual evidence.',420]])
    input.visualRects=[{x:.1,y:.25,width:.8,height:.18}]
    const blocks=buildTranslationBlocks([input])
    expect(blocks.some(b=>/^(?:82\.7|81\.2 80\.1|Clean latent)/.test(b.text))).toBe(false)
    expect(blocks.find(b=>b.kind==='figure')?.imageRect).toEqual(input.visualRects[0])
    expect(blocks.some(b=>b.text.startsWith('The controlled experiment'))).toBe(true)
  })
  it('protects entire inline formulas and rejects translations that flatten their scripts', () => {
    const value=document();value.blocks=[{...value.blocks[1],text:'We initialize $f_{0}=L_{21}$ at $\\ell^{*}=20$.'}]
    const batch=translationBatches(value,'body')[0], request=translationRequestBlocks(batch)[0]
    expect(request.text).toContain('⟦PDF_MATH_0⟧')
    expect(parseTranslationResult(JSON.stringify([{id:request.id,translation:'在⟦PDF_MATH_1⟧处初始化⟦PDF_MATH_0⟧。'}]),batch)[request.id]).toBe('在$\\ell^{*}=20$处初始化$f_{0}=L_{21}$。')
    expect(()=>parseTranslationResult(JSON.stringify([{id:request.id,translation:'在ell*=20处初始化f0=L21。'}]),batch)).toThrow('上下标')
  })
  it('saves body independently, prevents duplicate starts, and reads saved translations after reopening without requests', async () => {
    const { root, paper, file } = await setup()
    const reply = vi.fn(async (_system: string, input: string) => JSON.stringify(JSON.parse(input).map((block: { id: string }) => ({ id: block.id, translation: '完整译文' }))))
    const service = new DocumentTranslationService(root, () => paper, reply)
    await Promise.all([service.start('paper', 'body'), service.start('paper', 'body')]); await settle(service, 'body')
    expect(reply).toHaveBeenCalledOnce()
    const stored = JSON.parse(await fs.readFile(file, 'utf8')) as DocumentTranslation
    expect(Object.keys(stored.translations)).toHaveLength(translationBatches(document(), 'body')[0].blocks.length)
    const reopened = new DocumentTranslationService(root, () => paper, reply)
    expect((await reopened.get('paper')).translations).toEqual(stored.translations)
    await reopened.start('paper', 'body'); expect(reply).toHaveBeenCalledOnce()
    await reopened.start('paper', 'appendix'); await settle(reopened, 'appendix')
    expect(reply).toHaveBeenCalledTimes(2)
  })
  it('retains saved batches after an interruption and retries only missing blocks', async () => {
    const { root, paper, file } = await setup(), value = document()
    const first = value.blocks.find((block) => block.kind === 'paragraph')!
    value.translations[first.id] = '已保存的段落'; value.running = ['body']; await fs.writeFile(file, JSON.stringify(value))
    const reply = vi.fn().mockRejectedValueOnce(new Error('网络连接中断')).mockImplementation(async (_system, input) => JSON.stringify(JSON.parse(input).map((block: { id: string }) => ({ id: block.id, translation: '补全译文' }))))
    const service = new DocumentTranslationService(root, () => paper, reply)
    expect((await service.get('paper')).errors.body).toContain('已中断')
    await service.start('paper', 'body'); await settle(service, 'body')
    expect((await service.get('paper')).errors.body).toContain('网络连接中断')
    await service.start('paper', 'body'); await settle(service, 'body')
    expect((await service.get('paper')).translations[first.id]).toBe('已保存的段落')
    expect(reply.mock.calls.every((call) => !call[1].includes(first.id))).toBe(true)
  })
  it('extracts a real PDF and saves the reusable document plan', async () => {
    const { root, paper, file } = await setup(); await fs.unlink(file)
    await fs.writeFile(paper.sourcePath, minimalTextPdf('Scientific experiments provide reliable evidence for this research.'))
    const service = new DocumentTranslationService(root, () => paper, vi.fn())
    expect((await service.get('paper')).blocks.map((block) => block.text).join(' ')).toContain('Scientific experiments')
    await expect(fs.access(file)).resolves.toBeUndefined()
  })
  it('automatically rebuilds old cached layouts, reuses matching translations under new IDs, and backs up the original', async () => {
    const { root, paper, file } = await setup(), old = document()
    await fs.writeFile(paper.sourcePath, minimalTextPdf('Scientific experiments provide reliable evidence for this research.'))
    old.layoutRevision = undefined
    old.blocks = [{ id: 'old-id', scope: 'body', kind: 'paragraph', text: 'Scientific experiments provide reliable evidence for this research.', parts: [{ page: 1, rects: [{ x: .1, y: .1, width: .7, height: .1 }] }] }]
    old.translations = { 'old-id': '已完成的译文，无需重新请求。' }
    await fs.writeFile(file, JSON.stringify(old))
    const reply = vi.fn(), service = new DocumentTranslationService(root, () => paper, reply)
    const migrated = await service.get('paper')
    expect(migrated.layoutRevision).toBe(translationLayoutRevision)
    expect(migrated.translations[migrated.blocks[0].id]).toBe(old.translations['old-id'])
    expect(migrated.blocks[0].id).not.toBe('old-id')
    expect(JSON.parse(await fs.readFile(`${file}.layout-1.bak`, 'utf8'))).toEqual(JSON.parse(JSON.stringify(old)))
    await service.start('paper', 'body'); expect(reply).not.toHaveBeenCalled()
    expect((await new DocumentTranslationService(root, () => paper, reply).get('paper')).translations).toEqual(migrated.translations)
  })
  it('does not mark an unsaved batch as cached when a filesystem write fails', async () => {
    const { root, paper, file } = await setup()
    let finish!: (value: string) => void, input = ''
    const service = new DocumentTranslationService(root, () => paper, async (_system, value) => { input = value; return new Promise<string>((resolve) => { finish = resolve }) })
    await service.start('paper', 'body')
    await fs.unlink(file); await fs.mkdir(file)
    finish(JSON.stringify(JSON.parse(input).map((block: { id: string }) => ({ id: block.id, translation: '不能保存的译文' }))))
    await settle(service, 'body')
    expect((await service.get('paper')).translations).toEqual({})
    expect((await service.get('paper')).errors.body).toContain('保存译文失败')
    expect(translationBatches(await service.get('paper'), 'body')).toHaveLength(1)
  })
})
