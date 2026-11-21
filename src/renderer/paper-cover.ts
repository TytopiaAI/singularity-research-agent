import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'

const figureStart = /^(?:fig(?:ure)?\.?|图)\s*\d+[.:：\s]/i
const pipelineTerms = /pipeline|framework|architecture|workflow|overview|method|model|流程|框架|架构|方法|模型/i

export async function suggestPipelineCover(paperId: string): Promise<string | null> {
  const load = getDocument({ url: `singularity-paper://paper/${paperId}`, isEvalSupported: false })
  try {
    const pdf = await load.promise
    for (let number = 1; number <= Math.min(pdf.numPages, 12); number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const items = content.items.filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && 'transform' in item)
      for (let i = 0; i < items.length; i++) {
        const caption = items.slice(i, i + 14).map((item) => item.str).join(' ')
        if (!figureStart.test(items[i].str.trim()) || !pipelineTerms.test(caption)) continue
        const viewport = page.getViewport({ scale: 520 / page.getViewport({ scale: 1 }).width })
        const rendered = document.createElement('canvas')
        rendered.width = Math.ceil(viewport.width)
        rendered.height = Math.ceil(viewport.height)
        await page.render({ canvas: rendered, viewport }).promise
        const captionY = viewport.height - items[i].transform[5] * viewport.scale
        const cropHeight = Math.min(viewport.height * .42, Math.max(110, captionY - 12))
        const cropTop = Math.max(0, captionY - cropHeight - 12)
        const result = document.createElement('canvas')
        result.width = rendered.width
        result.height = Math.max(1, Math.round(Math.min(cropHeight, rendered.height - cropTop)))
        result.getContext('2d')?.drawImage(rendered, 0, cropTop, rendered.width, result.height, 0, 0, result.width, result.height)
        return result.toDataURL('image/png')
      }
    }
    return null
  } finally {
    await load.destroy()
  }
}

export async function renderCoverPage(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement): Promise<void> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 650 / page.getViewport({ scale: 1 }).width })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
}
