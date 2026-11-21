import fs from 'node:fs'
import path from 'node:path'
import { preparePrimaryRuntime, smokePrimaryRuntime } from './primary-runtime/prepare'

// All replacement/removal performed by the upstream builder stays in this workspace.
const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'runtime')
const temporary = path.join(root, '.local-data', 'temp')
fs.mkdirSync(temporary, { recursive: true })
process.env.TEMP = temporary
process.env.TMP = temporary
await preparePrimaryRuntime({ target: 'win-x64', output,
  cache: path.join(root, '.local-data', 'cache', 'primary-runtime-downloads'),
  version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['@deepseek-ai/dsh'],
})
smokePrimaryRuntime(path.join(output, 'primary-runtime'))
console.log('Desktop Node, Python, pnpm and Office runtime verified.')
