import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as buildRenderer } from 'vite'
import { buildElectron } from './build-electron.js'
import { makeState, payload, runtimeContract } from './app-update'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheRoot = path.join(root, '.local-data', 'cache')
const electronBuilderCli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const directoryOnly = process.argv.includes('--dir')
if (!fs.existsSync(path.join(root, 'runtime', 'primary-runtime', 'runtime.json'))) {
  throw new Error('请先运行 pnpm prepare:desktop-runtime，准备独立的桌面插件和 Office 运行环境。')
}

Object.assign(process.env, {
  ELECTRON_CACHE: path.join(cacheRoot, 'electron'),
  ELECTRON_BUILDER_CACHE: path.join(cacheRoot, 'electron-builder'),
  npm_config_cache: path.join(cacheRoot, 'npm'),
})

await buildElectron(root)
await buildRenderer({ root })
// Full installations carry the baseline needed by later code-only updates.
fs.writeFileSync(path.join(root,'build','app-update.json'),JSON.stringify(makeState(runtimeContract(root),payload(root)),null,2))

const args = [electronBuilderCli, '--win', '--x64', '--publish', 'never']
if (directoryOnly) args.push('--dir')

await new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', reject)
  child.once('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`electron-builder exited with code ${code ?? 'unknown'}`))
  })
})
