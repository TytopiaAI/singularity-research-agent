/* The model is instructed to return readable Unicode mathematics. This handles
   common TeX fragments defensively when a compatible provider ignores that rule. */
const symbols: Record<string,string> = {
  alpha:'α',beta:'β',gamma:'γ',delta:'δ',epsilon:'ε',theta:'θ',lambda:'λ',mu:'μ',pi:'π',sigma:'σ',phi:'φ',omega:'ω',
  Gamma:'Γ',Delta:'Δ',Sigma:'Σ',Omega:'Ω',times:'×',cdot:'·',pm:'±',leq:'≤',geq:'≥',neq:'≠',approx:'≈',
  infty:'∞',sum:'∑',prod:'∏',int:'∫',partial:'∂',nabla:'∇',rightarrow:'→',leftarrow:'←',in:'∈',subset:'⊂',
  cdots:'…',ldots:'…',forall:'∀',exists:'∃',cap:'∩',cup:'∪',mathbb:'',
}
const superscripts: Record<string,string> = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','n':'ⁿ','i':'ⁱ' }
const subscripts: Record<string,string> = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','i':'ᵢ','j':'ⱼ','n':'ₙ' }

export function readableMath(value: string): string {
  let text=value.replace(/\$\$?/g,'').replace(/\\\[|\\\]|\\\(|\\\)/g,'')
  for(let pass=0;pass<3;pass++) text=text.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g,'($1)/($2)')
  text=text.replace(/\\sqrt\{([^{}]+)\}/g,'√($1)')
    .replace(/\\(?:begin|end)\{[^{}]+\}/g,'')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]+)\}/g,'$1')
    .replace(/\\(?:left|right)\b/g,'')
    .replace(/\^\{([0-9+\-ni]+)\}|\^([0-9ni])/g,(_all,group:string|undefined,single:string|undefined)=>[...(group??single??'')].map((char)=>superscripts[char]??char).join(''))
    .replace(/_\{([0-9ijn]+)\}|_([0-9ijn])/g,(_all,group:string|undefined,single:string|undefined)=>[...(group??single??'')].map((char)=>subscripts[char]??char).join(''))
    .replace(/\\([A-Za-z]+)/g,(_all,name:string)=>symbols[name]??name)
    .replace(/\{([^{}]+)\}/g,'($1)')
    .replace(/\s*&\s*/g,'  ')
  return text
}
