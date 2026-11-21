import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as buildRenderer } from 'vite'
import { buildElectron } from './build-electron.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await buildElectron(root)
await buildRenderer({ root })
