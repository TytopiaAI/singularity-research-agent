import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Keep package operations on the carrier's interpreter and pnpm, even with an empty PATH.
const resources = process.env.SINGULARITY_RESOURCE_ROOT
if (!resources) throw new Error('Missing Singularity resource root')
const began = performance.now()
const mark = (stage: string): void => { process.stderr.write(`[startup] ${stage} +${Math.round(performance.now() - began)}ms\n`) }
mark('launcher entered')
const require = createRequire(path.join(resources, 'package.json'))
const pnpm = path.join(path.dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs')
const bin = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib', 'bin.js')
const { runCli } = await import(pathToFileURL(bin).href)
mark('CLI modules loaded')
await runCli({ packageManager: {
  command: process.execPath, args: [pnpm],
  env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
} })
mark('CLI initialized')
