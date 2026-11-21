import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

export function projectRoot(): string {
  return process.env.SINGULARITY_PROJECT_ROOT
    ? path.resolve(process.env.SINGULARITY_PROJECT_ROOT)
    : path.resolve(moduleDir, '..')
}

export interface AppPaths {
  resources: string
  data: string
  workspace: string
  cache: string
  config: string
  database: string
  logs: string
  temp: string
  electron: string
  dshHome: string
  extracted: string
  artifacts: string
}

export interface AppPathOptions {
  resourceRoot?: string
  dataRoot?: string
}

/** Packaged installs keep data next to the install folder: `<parent>/SingularityData`. */
export function packagedDataRoot(appPath: string): string {
  const installRoot = path.resolve(appPath, '..', '..')
  return path.join(path.dirname(installRoot), 'SingularityData')
}

export function createAppPaths(options: AppPathOptions = {}): AppPaths {
  const resources = path.resolve(options.resourceRoot ?? projectRoot())
  const data = path.resolve(options.dataRoot ?? process.env.SINGULARITY_DATA_ROOT ?? path.join(resources, '.local-data'))
  const paths: AppPaths = {
    resources,
    data,
    workspace: path.join(data, 'workspace'),
    cache: path.join(data, 'cache'),
    config: path.join(data, 'config'),
    database: path.join(data, 'database'),
    logs: path.join(data, 'logs'),
    temp: path.join(data, 'temp'),
    electron: path.join(data, 'electron'),
    dshHome: path.join(data, 'dsh-home'),
    extracted: path.join(data, 'extracted'),
    artifacts: path.join(data, 'artifacts'),
  }
  for (const directory of Object.values(paths).filter((value) => value !== resources)) {
    fs.mkdirSync(directory, { recursive: true })
  }
  return paths
}

export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
