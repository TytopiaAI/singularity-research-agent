import path from 'node:path'
import { build } from 'esbuild'

export async function buildElectron(root: string): Promise<void> {
  const common = {
    bundle: true,
    sourcemap: true,
    target: 'node24',
    platform: 'node' as const,
    packages: 'external' as const,
    logLevel: 'info' as const,
  }

  await Promise.all([
    build({
      ...common,
      entryPoints: [path.join(root, 'src/main/harness-launcher.ts')],
      outfile: path.join(root, 'dist-electron/harness-launcher.js'),
      format: 'esm',
    }),
    build({
      ...common,
      entryPoints: [path.join(root, 'src/main/main.ts')],
      outfile: path.join(root, 'dist-electron/main.js'),
      format: 'esm',
    }),
    build({
      ...common,
      entryPoints: [path.join(root, 'src/preload/preload.ts')],
      outfile: path.join(root, 'dist-electron/preload.cjs'),
      format: 'cjs',
    }),
    build({
      ...common,
      entryPoints: [path.join(root, 'src/preload/chat-appearance.ts')],
      outfile: path.join(root, 'dist-electron/chat-appearance.cjs'),
      format: 'cjs',
    }),
  ])
}
