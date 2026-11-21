/* One-time local provisioning. Credentials arrive only through an environment variable. */
const { app } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const key = process.env.BREEZE_SETUP_KEY
delete process.env.BREEZE_SETUP_KEY
const root = path.resolve(__dirname, '..'), output = path.join(root, '.local-data', 'breeze-voice-setup', String(Date.now()))
fs.mkdirSync(output, { recursive: true }); app.setPath('userData', path.join(output, 'profile')); app.commandLine.appendSwitch('mute-audio')
const argument = name => process.argv[process.argv.indexOf(name) + 1]
const report = { output, checks: [] }
async function main() {
  assert(key, 'Missing credential environment variable')
  assert(process.argv.includes('--voice-id'), 'Missing voice ID')
  await require('esbuild').build({ entryPoints: [path.join(root, 'src/main/breeze-voice.ts')], bundle: true, packages: 'external', platform: 'node', format: 'cjs', outfile: path.join(output, 'service.cjs'), logLevel: 'silent' })
  await app.whenReady()
  const { BreezeVoice } = require(path.join(output, 'service.cjs'))
  const voice = new BreezeVoice(path.join(root, '.local-data/config'), path.join(root, '.local-data/cache'))
  const input = { provider: 'breezeblue', voiceId: argument('--voice-id'), apiKey: key, monthlyCreditLimit: 10000, replyCharacterLimit: 1000 }
  await voice.save(input)
  assert(!(await voice.settings()).apiKey)
  assert(!fs.readFileSync(path.join(root, '.local-data/config/voice-settings.json'), 'utf8').includes(key))
  report.checks.push('Development voice settings are encrypted with Windows safeStorage; read API returns no plaintext key')
  const validation = await voice.verify()
  if (!validation.ok) throw new Error(validation.message)
  report.checks.push('Real non-billable voice lookup confirms the supplied key can access the saved voice')

}
main().catch(error => { report.error = String(error.message || error).replaceAll(key || 'missing-credential-sentinel', '[REDACTED]'); process.exitCode = 1 }).finally(() => {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); app.exit(report.error ? 1 : 0)
})
