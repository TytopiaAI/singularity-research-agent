/* Read-only credentials check. No model call, cloud synthesis, or installed-profile writes. */
const {app, net} = require('electron')
const fs = require('node:fs'), path = require('node:path')
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'voice-connection', String(Date.now()))
fs.mkdirSync(output, {recursive:true}); app.setPath('userData', process.env.VOICE_VERIFY_PROFILE || path.join(output,'profile'))
const report = { cloud: [], native: null }
async function main() {
  for(const [name, file] of [['breeze','breeze-voice'],['speech','windows-speech']]) await require('esbuild').build({entryPoints:[path.join(root,'src/main',file+'.ts')],outfile:path.join(output,name+'.cjs'),bundle:true,packages:'external',platform:'node',format:'cjs',logLevel:'silent'})
  await app.whenReady()
  const {BreezeVoice} = require(path.join(output,'breeze.cjs'))
  for (const config of [path.join(root,'.local-data','config'), 'E:/SingularityData/config']) {
    const voice = new BreezeVoice(config,path.join(output,'cache'),async(url,init)=>{try{return await net.fetch(url,init)}catch(e){report.networkError={name:e.name,code:e.code,message:String(e.message).replace(/brz_[A-Za-z0-9_-]+/g,'[REDACTED]')};throw e}})
    const settings = await voice.settings()
    if(process.argv.includes('--repair-development-key') && config === path.join(root,'.local-data','config') && settings.hasCredential) {
      const {key} = await voice.credentials()
      await voice.save({...settings,apiKey:key})
      report.developmentKeyReencrypted = true
    }
    report.cloud.push({profile:config, configured:settings.hasCredential, provider:settings.provider, verification:settings.hasCredential ? await voice.verify() : null})
  }
  const {windowsSpeech} = require(path.join(output,'speech.cjs'))
  report.native = await windowsSpeech('capabilities',AbortSignal.timeout(15000))
  if(report.native.recognition && report.native.synthesis) {
    const audio = await windowsSpeech('speak',AbortSignal.timeout(30000),'你好，今天我们一起讨论科学研究。')
    const result = await windowsSpeech('listen',AbortSignal.timeout(30000),audio.audio)
    report.native.roundTrip = {recognized:!!result.text, text:result.text, confidence:result.confidence}
  }
}
main().catch(error=>{report.error = error instanceof Error ? error.message : 'Verification failed'}).finally(()=>{
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify({output,...report})); app.quit()
})
