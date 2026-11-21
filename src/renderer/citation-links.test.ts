import { describe, expect, it } from 'vitest'
import { buildCitationIndex, linkIndexAtPoint, normalizeTextRuns, type CitationLink, type RunPage, type TextRun } from './citation-links'

const run = (str: string, x = .1, y = .1, width = .5): TextRun => ({ str, x, y, width, height: .02 })

describe('normalizeTextRuns', () => {
  it('maps PDF text space into normalised page rects', () => {
    const [first] = normalizeTextRuns(
      [{ str: 'Figure 3. Caption', transform: [10, 0, 0, 10, 72, 700], width: 120, height: 10 }],
      { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] },
    )
    expect(first.x).toBeCloseTo(72 / 600)
    expect(first.y).toBeCloseTo(90 / 800)
    expect(first.width).toBeCloseTo(120 / 600)
    expect(first.height).toBeCloseTo(10 / 800)
  })

  it('drops blank items and survives a zero-width transform', () => {
    expect(normalizeTextRuns([{ str: '   ', transform: [1, 0, 0, 1, 0, 0] }], { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] })).toEqual([])
    expect(normalizeTextRuns([{ str: 'x', transform: [0, 0, 0, 0, 0, 0] }], { width: 600, height: 800, transform: [1, 0, 0, -1, 0, 800] })).toEqual([])
  })
})

describe('linkIndexAtPoint', () => {
  const link: CitationLink = { page: 1, text: '[12]', rect: { x: .2, y: .3, width: .04, height: .02 }, target: { kind: 'reference', label: '[12]', page: 9, rect: { x: .1, y: .1, width: .1, height: .02 } } }
  const links = [link]

  it('hits inside the marker rect and misses just outside it', () => {
    expect(linkIndexAtPoint(links, .22, .31, .004, .002)).toBe(0)
    expect(linkIndexAtPoint(links, .26, .31, .004, .002)).toBe(-1)
    expect(linkIndexAtPoint(links, .22, .34, .004, .002)).toBe(-1)
  })

  it('still hits with the padding a real page uses', () => {
    expect(linkIndexAtPoint(links, .238, .31, .004, .002)).toBe(0)
    expect(linkIndexAtPoint(undefined, .22, .31, .004, .002)).toBe(-1)
  })
})

describe('buildCitationIndex', () => {
  const pages: RunPage[] = [
    {
      page: 1,
      runs: [
        run('Introduction', .08, .1, .2),
        run('Deep models improved accuracy [1], [2, 3] and [4–5].', .08, .2, .7),
        run('Figure 2 shows the pipeline.', .08, .3, .5),
      ],
    },
    {
      page: 2,
      runs: [
        run('Figure 2. Pipeline overview.', .08, .1, .4),
        run('Table 1. Ablation results.', .08, .2, .4),
        run('References', .08, .4, .15),
        run('[1] A. Author. Deep models. 2020.', .08, .45, .6),
        run('[2] B. Author. Better models. 2021.', .08, .5, .6),
        run('[3] C. Author. More models. 2022.', .08, .55, .6),
        run('[4] D. Author. Fewer models. 2023.', .08, .6, .6),
        run('[5] E. Author. Some models. 2024.', .08, .65, .6),
      ],
    },
  ]

  it('links bracketed citations to their reference entry pages', () => {
    const links = buildCitationIndex(pages)
    const reference = links.filter((link) => link.target.kind === 'reference')
    expect(reference.map((link) => link.text)).toEqual(['[1]', '[2]', '[3]', '[4–5]'])
    expect(reference.every((link) => link.page === 1 && link.target.page === 2)).toBe(true)
  })

  it('expands a range to its first entry but keeps the printed label', () => {
    const range = buildCitationIndex(pages).find((link) => link.text === '[4–5]')!
    expect(range.target.label).toBe('[4]')
    expect(range.rect.width).toBeGreaterThan(0)
  })

  it('links figure mentions but never the caption to itself', () => {
    const links = buildCitationIndex(pages).filter((link) => link.target.kind === 'figure')
    expect(links).toHaveLength(1)
    expect(links[0].page).toBe(1)
    expect(links[0].text).toBe('Figure 2')
    expect(links[0].target.page).toBe(2)
  })

  it('does not turn reference entries into self links', () => {
    const links = buildCitationIndex(pages)
    expect(links.filter((link) => link.page === 2)).toEqual([])
  })

  it('keeps figure links when a paper carries no reference section', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('Fig. 3 plots the loss.', .08, .2, .4)] },
      { page: 3, runs: [run('Fig. 3. Training loss curves.', .08, .1, .4)] },
    ])
    expect(links.map((link) => [link.text, link.target.kind, link.target.page])).toEqual([['Fig. 3', 'figure', 3]])
  })

  it('ignores citations that have no matching reference entry', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('As shown before [99].', .08, .2, .4), run('References', .08, .4, .15), run('[1] A. Author. 2020.', .08, .45, .6)] },
    ])
    expect(links).toEqual([])
  })

  it('falls back to a climbing numeric reference style', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('Prior work agrees [2].', .08, .2, .4)] },
      {
        page: 2,
        runs: [
          run('References', .08, .4, .15),
          run('1. A. Author. Deep models. 2020.', .08, .45, .6),
          run('2. B. Author. Better models. 2021.', .08, .5, .6),
          run('3. C. Author. More models. 2022.', .08, .55, .6),
        ],
      },
    ])
    const reference = links.filter((link) => link.target.kind === 'reference')
    expect(reference).toHaveLength(1)
    expect(reference[0].text).toBe('[2]')
    expect(reference[0].target.page).toBe(2)
  })

  it('pairs author-year citations with their entries', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('Prior work agrees (Zhao et al., 2021; Li and Ma, 2019).', .08, .2, .7)] },
      {
        page: 3,
        runs: [
          run('References', .08, .1, .15),
          run('Li, Y., Ma, K., 2019. Anomaly detection. IEEE TMI 38, 1–9.', .08, .2, .7),
          run('Zhao, H., Li, Y., He, N., 2021. Anomaly detection again.', .08, .25, .7),
        ],
      },
    ])
    const reference = links.filter((link) => link.target.kind === 'reference')
    expect(reference.map((link) => link.target.label)).toEqual(['Zhao 2021', 'Li 2019'])
    expect(reference.every((link) => link.page === 1 && link.target.page === 3)).toBe(true)
  })

  it('follows the narrative "Author et al. (year)" form', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('Zhao et al. (2021) showed the effect.', .08, .2, .6)] },
      {
        page: 2,
        runs: [
          run('References', .08, .1, .15),
          run('Zhao, H., Li, Y., 2021. Anomaly detection again.', .08, .2, .7),
        ],
      },
    ])
    expect(links.map((link) => [link.text, link.target.label])).toEqual([['Zhao et al. (2021)', 'Zhao 2021']])
  })

  it('finds the reference block without a printed heading', () => {
    const links = buildCitationIndex([
      { page: 1, runs: [run('Body text cites (Zhao et al., 2021).', .08, .1, .6)] },
      { page: 2, runs: [run('Filler paragraph that mentions 2021 once.', .08, .1, .6)] },
      { page: 3, runs: [run('Zhao, H., Li, Y., 2021. Anomaly detection again.', .08, .1, .7)] },
    ])
    expect(links.map((link) => [link.target.label, link.target.page])).toEqual([['Zhao 2021', 3]])
  })
})
