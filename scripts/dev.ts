import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { createServer } from 'vite'
import { buildElectron } from './build-electron.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheRoot = path.join(root, '.local-data', 'cache')

await buildElectron(root)

const server = await createServer({ root })
await server.listen()
const address = server.httpServer?.address()
if (address === null || typeof address === 'string' || address === undefined) {
  throw new Error('Unable to determine the Vite development server port.')
}

const child = spawn(electron as unknown as string, ['.'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    SINGULARITY_PROJECT_ROOT: root,
    SINGULARITY_NODE_BINARY: process.execPath,
    SINGULARITY_DEV_SERVER_URL: `http://127.0.0.1:${address.port}`,
    ELECTRON_CACHE: path.join(cacheRoot, 'electron'),
    ELECTRON_BUILDER_CACHE: path.join(cacheRoot, 'electron-builder'),
    npm_config_cache: path.join(cacheRoot, 'npm'),
    PNPM_HOME: path.join(cacheRoot, 'pnpm-home'),
    PNPM_STORE_DIR: path.join(cacheRoot, 'pnpm-store'),
  },
})

const shutdown = async (): Promise<void> => {
  await server.close()
}

child.once('exit', async (code) => {
  await shutdown()
  process.exitCode = code ?? 0
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => child.kill(signal))
}
