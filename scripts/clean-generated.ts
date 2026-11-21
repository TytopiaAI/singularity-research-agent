import { rm } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
for (const directory of ['dist', 'dist-electron', 'coverage']) {
  await rm(path.join(root, directory), { recursive: true, force: true })
}
