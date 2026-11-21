// Hidden compositor probe: captures only the test renderer, never the desktop.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path')
const output=path.resolve(__dirname,'../.local-data/native-backdrop',String(Date.now()))
fs.mkdirSync(output,{recursive:true});app.setPath('userData',path.join(output,'profile'))
app.on('window-all-closed',()=>{})
const report={output,variants:[],errors:[]};let win
const wait=ms=>new Promise(r=>setTimeout(r,ms))
async function main(){
 await app.whenReady()
 for(const variant of ['current','clear-views','transparent-window']){
  win=new BrowserWindow({width:760,height:540,show:false,frame:false,transparent:variant==='transparent-window',backgroundColor:'#00000000',backgroundMaterial:'acrylic',webPreferences:{sandbox:true,contextIsolation:true,offscreen:true,backgroundThrottling:false}})
  win.contentView.setBackgroundColor('#00000000')
  if(variant==='clear-views')for(const child of win.contentView.children)child.setBackgroundColor('#00000000')
  await win.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{background:transparent;margin:0;height:100%;font:14px Segoe UI}.glass{position:absolute;inset:38px;background:#ffffff24;border-radius:20px;display:grid;place-items:center}</style><div class="glass">原生透明通道验证</div>'))
  await wait(250)
  const shot=await win.webContents.capturePage(),size=shot.getSize(),data=shot.toBitmap()
  const pixel=(x,y)=>[...data.subarray((y*size.width+x)*4,(y*size.width+x)*4+4)]
  fs.writeFileSync(path.join(output,variant+'.png'),shot.toPNG())
  report.variants.push({variant,background:win.getBackgroundColor(),root:win.contentView.constructor.name,children:win.contentView.children.map(c=>c.constructor.name),clearPixel:pixel(15,200),glassPixel:pixel(100,200)})
  win.destroy();win=null
 }
}
main().catch(e=>report.errors.push(String(e.stack||e))).finally(()=>{win?.destroy();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));app.exit(report.errors.length?1:0)})
