// Development-only preparation. The application exposes the same portable setup in its UI.
import path from 'node:path'
import { LatexStore } from '../src/main/latex-store'
import { LatexCompilerService } from '../src/main/latex-compiler'
const data=path.resolve('.local-data'),store=new LatexStore(data),compiler=new LatexCompilerService(store,data)
const existing=(await compiler.compilers()).find(c=>c.engine==='tectonic'&&c.available)
if(!existing)await compiler.install()
console.log(JSON.stringify((await compiler.compilers()).filter(c=>c.available)))
