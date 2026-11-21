// Only these inline elements are supported. Render them as React nodes, never HTML.
export function academicTextParts(text: string): Array<{ text: string; script?: 'sup' | 'sub'; math?: boolean }> {
  const parts: Array<{ text: string; script?: 'sup' | 'sub'; math?: boolean }> = []
  const pattern = /<(sup|sub)\s*>([^<>]{1,200})<\/\1\s*>|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/gi
  let offset = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index! > offset) parts.push({ text: text.slice(offset, match.index) })
    parts.push(match[1] ? { text: match[2], script: match[1].toLowerCase() as 'sup' | 'sub' } : { text: match[3] ?? match[4] ?? match[5], math: true })
    offset = match.index! + match[0].length
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) })
  return parts
}

export function protectAcademicScripts(text: string): { text: string; spans: Array<{ token: string; value: string }> } {
  const spans: Array<{ token: string; value: string }> = []
  // Choose a namespace absent from the source so literal paper content cannot collide.
  let prefix = 'PDF_SCRIPT'
  while (text.includes(`⟦${prefix}_`)) prefix += '_'
  let mathPrefix = 'PDF_MATH'
  while (text.includes(`⟦${mathPrefix}_`)) mathPrefix += '_'
  const protectedText = text.replace(/<(sup|sub)\s*>([^<>]{1,200})<\/\1\s*>|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\([\s\S]+?\\\)/gi, (value) => {
    const token = `⟦${value.startsWith('<') ? prefix : mathPrefix}_${spans.length}⟧`
    spans.push({ token, value }); return token
  })
  return { text: protectedText, spans }
}

// A click on one letter, a token, or a short label is not a paragraph.
export function isTranslatableParagraph(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length >= 24
}

export function canReuseAcademicTranslation(source: string, translation: string): boolean {
  // A legacy flattened citation cannot safely be located among ordinary numbers
  // in a translated sentence. Re-translate just that block instead of guessing.
  const expected = academicTextParts(source).filter((part) => part.script || part.math)
  const actual = academicTextParts(translation).filter((part) => part.script || part.math)
  return expected.every((part) => {
    const index = actual.findIndex((candidate) => candidate.script === part.script && candidate.math === part.math && candidate.text === part.text)
    if (index < 0) return false
    actual.splice(index, 1); return true
  })
}
