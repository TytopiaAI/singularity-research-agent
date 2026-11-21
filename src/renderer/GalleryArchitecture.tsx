import { useId } from 'react'

/** The room is scenery, never a placeholder artwork. All hanging art stays in the DOM above it. */
export function GalleryArchitecture({visitors}:{visitors:boolean}) {
  const id='museum-'+useId().replace(/[^a-z0-9]/gi,'')
  return <svg className="museum-architecture" viewBox="0 0 1600 1000" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id={`${id}-wall`} x2="0" y2="1"><stop stopColor="#f7e9dc"/><stop offset="1" stopColor="#f5e6dc"/></linearGradient>
      <linearGradient id={`${id}-floor`} x2="0" y2="1"><stop stopColor="#cddde1"/><stop offset="1" stopColor="#a9c5d0"/></linearGradient>
      <linearGradient id={`${id}-column`}><stop stopColor="#d8c6ad"/><stop offset=".3" stopColor="#fff3de"/><stop offset=".65" stopColor="#efe0c6"/><stop offset="1" stopColor="#c9b596"/></linearGradient>
      <radialGradient id={`${id}-light`}><stop stopColor="#fffdf7" stopOpacity=".65"/><stop offset="1" stopColor="#fffdf7" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="1600" height="1000" fill={`url(#${id}-wall)`}/>
    <ellipse cx="800" cy="360" rx="700" ry="460" fill={`url(#${id}-light)`}/>
    <path d="M0 760H1600V1000H0Z" fill={`url(#${id}-floor)`}/>
    <g stroke="#86a8b7" strokeWidth="2" opacity=".65">
      {[785,823,870,928,998].map(y=><path key={y} d={`M0 ${y}H1600`}/>)}
      {Array.from({length:17},(_,i)=>i*160-480).map(x=><path key={x} d={`M${800+(x-800)*.38} 760L${x} 1000`}/>)}
    </g>
    <g fill="none" strokeLinejoin="round">
      <path d="M0 754H1600" stroke="#b6a18b" strokeWidth="12"/>
      <path d="M0 746H1600" stroke="#fff6e7" strokeWidth="8"/>
      <path d="M0 725H1600" stroke="#dfccb8" strokeWidth="2"/>
      <path d="M0 30H1600M0 72H1600" stroke="#c6b08e" strokeWidth="3"/>
      <path d="M0 42H1600M0 66H1600" stroke="#fff7e7" strokeWidth="8"/>
      <path d="M0 82H1600" stroke="#d4bea0" strokeWidth="7"/>
      <path d="M170 94Q800 -75 1430 94" stroke="#dfccb0" strokeWidth="2"/>
      <path d="M186 110Q800 -42 1414 110" stroke="#fff7e9" strokeWidth="5"/>
    </g>
    <g fill="#c2a77f" opacity=".65">{Array.from({length:23},(_,i)=>i*70+30).map(x=><g key={x} transform={`translate(${x} 53)`}><path d="M-9 0Q-6-12 0-4Q6-12 9 0Q5 8 0 4Q-5 8-9 0Z"/><circle cy="1" r="2" fill="#f9efde"/></g>)}</g>
    {[110,1418].map(x=><g key={x}>
      <rect x={x+8} y="151" width="64" height="554" fill={`url(#${id}-column)`}/>
      {[20,32,44,56].map(dx=><path key={dx} d={`M${x+dx} 174V682`} stroke="#c7b594" strokeWidth="2" opacity=".55"/>)}
      <path d={`M${x-8} 109H${x+88}L${x+76} 141H${x+4}Z`} fill="#e4d2b4" stroke="#c3aa83" strokeWidth="2"/>
      <path d={`M${x} 141H${x+80}V155H${x}Z`} fill="#f9ecd6" stroke="#c3aa83" strokeWidth="2"/>
      <path d={`M${x-8} 705H${x+88}V724H${x-8}Z M${x-14} 724H${x+94}V747H${x-14}Z`} fill="#ead9bf" stroke="#c3aa83" strokeWidth="2"/>
      <path d={`M${x+5} 128Q${x-14} 105 ${x-3} 101Q${x+10} 97 ${x+8} 116 M${x+75} 128Q${x+94} 105 ${x+83} 101Q${x+70} 97 ${x+72} 116`} fill="none" stroke="#ac9066" strokeWidth="4"/>
    </g>)}
    {[8,1498].map(x=><g key={x}>
      <path d={`M${x} 690V326Q${x+46} 235 ${x+92} 326V690Z`} fill="#e9d9ca" stroke="#d4bea5" strokeWidth="3"/>
      <path d={`M${x+11} 676V330Q${x+46} 262 ${x+81} 330V676Z`} fill="#f0e2d5" stroke="#fef3e3" strokeWidth="4"/>
      <path d={`M${x+46} 317V644 M${x+19} 452H${x+73}`} stroke="#dbc7ae" strokeWidth="2"/>
    </g>)}
    <g fill="none" stroke="#ddc9af" strokeWidth="2"><path d="M216 154H1384V699H216Z"/><path d="M226 164H1374V689H226Z" stroke="#fff5e7"/></g>
    <text x="800" y="104" textAnchor="middle" fill="#9b8161" fontSize="14" letterSpacing="7" fontFamily="Georgia,serif">SINGULARITY MUSEUM</text>
    {visitors&&<g className="museum-visitors">
      <ellipse cx="481" cy="931" rx="55" ry="9" fill="#7396a4" opacity=".22"/>
      <g transform="translate(444 706)"><path d="M16 120L12 210H32L39 132L44 211H65L60 116" fill="#bf8c4e"/><path d="M11 207L1 219H32V207M45 207V219H78L65 207" fill="#456aa2"/><path d="M21 31Q0 52 8 111L6 133Q35 141 65 128L59 53L44 34" fill="#517ec1"/><path d="M12 64L0 112L12 151L22 146L17 111L29 70" fill="#deb28a"/><path d="M59 59L70 107L62 142L52 139L56 102L46 68" fill="#deb28a"/><ellipse cx="35" cy="23" rx="17" ry="22" fill="#deb28a"/><path d="M18 23Q9-5 29-9Q57-13 55 25L45 29L39 0L24 4L25 24Z" fill="#73513c"/></g>
      <ellipse cx="658" cy="929" rx="53" ry="9" fill="#7396a4" opacity=".22"/>
      <g transform="translate(623 709)"><path d="M22 151L19 210H33L40 158L47 210H60L56 150" fill="#e8bd95"/><path d="M19 207L7 216H34V207M48 207V216H72L60 207" fill="#997548"/><path d="M20 41L8 104L0 171Q39 183 78 168L65 104L57 42Z" fill="#f0d66d"/><path d="M20 56L9 105L20 131M59 56L70 106L59 134" fill="none" stroke="#e4b58f" strokeWidth="12" strokeLinecap="round"/><ellipse cx="38" cy="24" rx="17" ry="22" fill="#e4b58f"/><path d="M20 24Q12-8 37-9Q61-11 57 24L60 57Q41 65 34 44L35 8L26 6Z" fill="#795135"/></g>
    </g>}
    <g className="museum-bench"><path d="M1116 892H1494V1000H1116Z" fill="#e4dac0"/><path d="M1116 892H1494L1468 869H1143Z" fill="#f6ead0"/><path d="M1116 892V1000H1132V899Z" fill="#d0c3aa"/></g>
    {visitors&&<g transform="translate(1231 767)" className="museum-visitors"><path d="M9 83Q-6 105 14 121L82 121L89 107L61 96Z" fill="#dbab5b"/><path d="M22 24Q-2 39 2 91Q35 109 66 92L60 44L44 25" fill="#739bd0"/><path d="M10 59L-3 85L18 99M55 59L73 83L58 99" fill="none" stroke="#dfae86" strokeWidth="12" strokeLinecap="round"/><ellipse cx="33" cy="11" rx="17" ry="20" fill="#dfae86"/><path d="M15 10V-7Q33-28 53-6L51 12Z" fill="#bb6145"/><path d="M11-6H56V3H11Z" fill="#c4744d"/></g>}
  </svg>
}
