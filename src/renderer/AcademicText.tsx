import { Fragment, useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { academicTextParts } from '../shared/academic-text'
import { readableMath } from './readable-math'
export function MathFormula({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 1000, maxSize: 30, output: 'htmlAndMathml' }) }
    catch { return null }
  }, [tex, display])
  return html ? <span className={display ? 'academic-math display-math' : 'academic-math'} dangerouslySetInnerHTML={{ __html: html }}/> : <span className="math-unparsed" title="请核对原文公式">{tex}</span>
}

export function AcademicText({ text }: { text: string }) {
  return <>{academicTextParts(text).map((part, index) => part.math ? <MathFormula key={index} tex={part.text}/> : part.script === 'sup'
    ? <sup key={index}>{part.text}</sup>
    : part.script === 'sub' ? <sub key={index}>{part.text}</sub>
      : <Fragment key={index}>{part.text}</Fragment>)}</>
}

/** Model output: formulas render as math, leftover TeX becomes readable Unicode. */
export function ReadableAcademicText({ text }: { text: string }) {
  const read = (value: string) => value.includes('\\') ? readableMath(value) : value
  return <>{academicTextParts(text).map((part, index) => part.math ? <MathFormula key={index} tex={part.text}/> : part.script === 'sup'
    ? <sup key={index}>{read(part.text)}</sup>
    : part.script === 'sub' ? <sub key={index}>{read(part.text)}</sub>
      : <Fragment key={index}>{read(part.text)}</Fragment>)}</>
}
