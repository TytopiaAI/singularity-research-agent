import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { afterEach, expect, it } from 'vitest'
import { HarnessRuntime } from '../src/main/harness-runtime'
import { createAppPaths } from '../src/main/paths'
import type { ProviderStore } from '../src/main/provider-store'

const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true})})
it('does not rewrite unchanged startup files, but repairs a stale bundled extension', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-profile-'));roots.push(root)
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:root})
 const runtime=new HarnessRuntime(paths,{harnessEntries:async()=>[]} as unknown as ProviderStore)
 await runtime['ensureProfile']()
 const extension=path.join(paths.dshHome,'profiles/node_modules/@singularity/harness-extension/client.js')
 const patch=path.join(paths.dshHome,'profiles/singularity/cordis.patch.yml')
 const original=fs.readFileSync(extension,'utf8'),stamp=new Date('2020-01-01T00:00:00Z')
 for(const file of [extension,patch])fs.utimesSync(file,stamp,stamp)
 await runtime['ensureProfile']()
 for(const file of [extension,patch])expect(fs.statSync(file).mtimeMs).toBe(stamp.getTime())
 fs.writeFileSync(extension,'outdated bundled extension')
 await runtime['ensureProfile']()
 expect(fs.readFileSync(extension,'utf8')).toBe(original)
 expect(fs.statSync(patch).mtimeMs).toBe(stamp.getTime())
})
it('retains installed dependencies, disabled bundles, custom root configuration and unrelated metadata on every restart', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-profile-'));roots.push(root)
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:root})
 const runtime=new HarnessRuntime(paths,{harnessEntries:async()=>[]} as unknown as ProviderStore)
 await runtime['ensureProfile']()
 const dir=path.join(paths.dshHome,'profiles/singularity'),file=path.join(dir,'package.json')
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'))
 manifest.dependencies={'example-enabled':'file:./enabled','example-disabled':'1.0.0'}
 manifest.devDependencies={'example-helper':'1.2.3'};manifest.custom='retained'
 manifest.dsh.profile.bundles.unshift('example-enabled');manifest.dsh.profile.customSetting=true
 fs.writeFileSync(file,JSON.stringify(manifest))
 fs.writeFileSync(path.join(dir,'cordis.yml'),'- id: my-root-plugin\n  name: example-enabled\n')
 fs.writeFileSync(path.join(dir,'pnpm-lock.yaml'),'lockfileVersion: 9.0\n')
 await runtime['ensureProfile']();await runtime['ensureProfile']()
 expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(manifest)
 expect(fs.readFileSync(path.join(dir,'cordis.yml'),'utf8')).toContain('my-root-plugin')
 expect(fs.readFileSync(path.join(dir,'pnpm-lock.yaml'),'utf8')).toBe('lockfileVersion: 9.0\n')
})
it('refuses to overwrite an unreadable user manifest or patch', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-profile-'));roots.push(root)
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:root})
 const runtime=new HarnessRuntime(paths,{harnessEntries:async()=>[]} as unknown as ProviderStore)
 await runtime['ensureProfile']()
 const dir=path.join(paths.dshHome,'profiles/singularity'),file=path.join(dir,'package.json'),original=fs.readFileSync(file,'utf8')
 fs.writeFileSync(file,'broken json')
 await expect(runtime['ensureProfile']()).rejects.toThrow('原文件已保留')
 expect(fs.readFileSync(file,'utf8')).toBe('broken json')
 fs.writeFileSync(file,original)
 fs.writeFileSync(path.join(dir,'cordis.patch.yml'),'unclosed: [')
 await expect(runtime['ensureProfile']()).rejects.toThrow('原文件已保留')
 expect(fs.readFileSync(path.join(dir,'cordis.patch.yml'),'utf8')).toBe('unclosed: [')
})
it('skips the pinned product preview notice before first launch and preserves other settings on later launches',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'singularity-profile-'));roots.push(root)
 const paths=createAppPaths({resourceRoot:process.cwd(),dataRoot:root})
 const runtime=new HarnessRuntime(paths,{harnessEntries:async()=>[]} as unknown as ProviderStore)
 await runtime['ensureProfile']()
 const file=path.join(paths.dshHome,'profiles/singularity/cordis.patch.yml')
 let patch=yaml.load(fs.readFileSync(file,'utf8')) as {id?:string;config?:Record<string,unknown>}[]
 expect(patch.find(p=>p.id==='ui-settings-general')?.config).toEqual({welcomeNoticeVersion:'2026-09-28.1'})
 patch.find(p=>p.id==='ui-settings-general')!.config={welcomeNoticeVersion:'old',unrelatedPreference:'keep'}
 patch.push({id:'another-plugin',config:{enabled:true}})
 fs.writeFileSync(file,yaml.dump(patch),'utf8')
 await runtime['ensureProfile']()
 patch=yaml.load(fs.readFileSync(file,'utf8')) as typeof patch
 expect(patch.filter(p=>p.id==='ui-settings-general')).toHaveLength(1)
 expect(patch.find(p=>p.id==='ui-settings-general')?.config).toEqual({welcomeNoticeVersion:'2026-09-28.1',unrelatedPreference:'keep'})
 expect(patch.find(p=>p.id==='another-plugin')?.config).toEqual({enabled:true})
})
