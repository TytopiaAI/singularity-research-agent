// Opaque colored background for native compositing tests. Uses only isolated data.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path')
const index=process.argv.indexOf('--background-host'),dir=process.argv[index+1]
if(index<0||!dir)throw Error('An isolated test directory is required')
app.setPath('userData',path.join(dir,'background-profile'))
app.whenReady().then(async()=>{
 const bounds=JSON.parse(fs.readFileSync(path.join(dir,'host-bounds.json'),'utf8'))
 const win=new BrowserWindow({...bounds,frame:false,roundedCorners:false,show:false,webPreferences:{sandbox:true,contextIsolation:true}})
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<style>html,body{margin:0;height:100%;background:linear-gradient(90deg,#078be5 50%,#f23b72 50%)}body:before,body:after{content:"";position:fixed;left:0;right:0;height:16px;background:#ff00ff;top:0}body:after{top:auto;bottom:0;background:#00ff00}</style>'))
 win.setAlwaysOnTop(true);win.show();win.moveTop()
 fs.writeFileSync(path.join(dir,'host-ready.json'),JSON.stringify(win.getBounds()))
 let flipped=false
 const timer=setInterval(()=>{
  if(fs.existsSync(path.join(dir,'host-stop'))){app.quit();return}
  const next=fs.existsSync(path.join(dir,'host-flip'))
  if(next!==flipped){flipped=next;void win.webContents.executeJavaScript(`document.documentElement.style.background=document.body.style.background='linear-gradient(90deg,${next?'#f23b72 50%,#078be5 50%':'#078be5 50%,#f23b72 50%'})'`).then(()=>fs.writeFileSync(path.join(dir,'host-flipped'),String(next)))}
 },200)
 win.once('closed',()=>clearInterval(timer))
})
