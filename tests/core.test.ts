import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppPaths, isPathInside, packagedDataRoot, type AppPaths } from '../src/main/paths'
import { redact, redactObject } from '../src/main/redaction'
import { createTranslationChunks } from '../src/main/translation-chunks'
import { extractPdf } from '../src/main/pdf-extractor'
import { PaperRepository } from '../src/main/paper-repository'
import { minimalTextPdf } from './helpers/minimal-pdf'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => fs.rm(item, { recursive: true, force: true })))
})

async function fixtureRoot(): Promise<string> {
  const parent = path.join(process.cwd(), '.local-data', 'temp')
  await fs.mkdir(parent, { recursive: true })
  const root = await fs.mkdtemp(path.join(parent, 'test-'))
  cleanup.push(root)
  return root
}

function appPaths(root: string): AppPaths {
  const data = path.join(root, '.local-data')
  const result: AppPaths = {
    resources: root, data, workspace: path.join(data, 'workspace'), cache: path.join(data, 'cache'), config: path.join(data, 'config'), database: path.join(data, 'database'),
    logs: path.join(data, 'logs'), temp: path.join(data, 'temp'), electron: path.join(data, 'electron'),
    dshHome: path.join(data, 'dsh-home'), extracted: path.join(data, 'extracted'), artifacts: path.join(data, 'artifacts'),
  }
  for (const directory of Object.values(result)) if (directory !== result.resources) fsSync.mkdirSync(directory, { recursive: true })
  return result
}

describe('path boundaries and redaction', () => {
  it('separates packaged resources from writable application data', async () => {
    const root = await fixtureRoot()
    const resources = path.join(root, 'app-resources')
    const data = path.join(root, 'app-data')
    await fs.mkdir(resources, { recursive: true })
    const paths = createAppPaths({ resourceRoot: resources, dataRoot: data })
    expect(paths.resources).toBe(path.resolve(resources))
    expect(paths.data).toBe(path.resolve(data))
    expect(paths.workspace).toBe(path.join(path.resolve(data), 'workspace'))
    expect(fsSync.existsSync(paths.dshHome)).toBe(true)
  })

  it('keeps packaged data beside the install folder without a hard-coded drive', () => {
    expect(packagedDataRoot('E:\\Apps\\Singularity\\resources\\app')).toBe('E:\\Apps\\SingularityData')
  })

  it('rejects sibling and parent paths', () => {
    expect(isPathInside('E:\\lab\\project\\paper.pdf', 'E:\\lab\\project')).toBe(true)
    expect(isPathInside('E:\\lab\\project-copy\\paper.pdf', 'E:\\lab\\project')).toBe(false)
    expect(isPathInside('E:\\lab\\secret.txt', 'E:\\lab\\project')).toBe(false)
  })

  it('removes secrets from logs and structured diagnostics', () => {
    expect(redact('Authorization: Bearer sk-secretvalue123456')).not.toContain('secretvalue')
    expect(redactObject({ apiKey: 'hidden', nested: { model: 'deepseek-chat' } })).toEqual({ apiKey: '[REDACTED]', nested: { model: 'deepseek-chat' } })
  })
})

describe('translation chunks', () => {
  it('keeps page anchors and deterministic resumable boundaries', () => {
    const pages = [1, 2, 3].map((pageNumber) => ({ paperId: 'p', pageNumber, text: 'x'.repeat(400) }))
    const chunks = createTranslationChunks(pages, 700)
    expect(chunks).toHaveLength(3)
    expect(chunks[1].text).toContain('<!-- page:2 -->')
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2])
  })
})

describe('PDF extraction and repository', () => {
  it('extracts metadata, indexes pages, searches FTS and detects a changed source', async () => {
    const root = await fixtureRoot()
    const pdfPath = path.join(root, 'paper.pdf')
    await fs.writeFile(pdfPath, minimalTextPdf('Research agents use reliable methods and report important reproducible results with transparent scientific evaluation, careful experiments, and robust analysis DOI 10.1234/example.2024'))
    const extracted = await extractPdf(pdfPath)
    expect(extracted.title).toBe('A Minimal Research Paper')
    expect(extracted.authors).toEqual(['Ada Lovelace', 'Alan Turing'])
    expect(extracted.indexStatus).toBe('ready')
    const repository = new PaperRepository(appPaths(root))
    try {
      const paper = await repository.import(pdfPath)
      expect(repository.search('reliable', paper.id)[0]).toMatchObject({ paperId: paper.id, pageNumber: 1 })
      expect(repository.pages(paper.id, 1, 1)[0].text).toContain('important reproducible results')
      await fs.appendFile(pdfPath, 'changed')
      expect((await repository.list())[0].missing).toBe(false)
      await fs.appendFile(paper.sourcePath, 'changed')
      expect((await repository.list())[0].missing).toBe(true)
    } finally {
      repository.close()
    }
  })
})
