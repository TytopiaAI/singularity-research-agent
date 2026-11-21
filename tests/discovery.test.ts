import { describe, expect, it } from 'vitest'
import { conferenceFromGroup, flagshipVenueIds, isoWeek, isRecentConference, parseGithubRepositories, parseHuggingFacePapers } from '../src/main/discovery-service'

describe('weekly discovery sources', () => {
  it('calculates the ISO week across the year boundary', () => {
    expect(isoWeek(new Date('2025-12-31T12:00:00Z'))).toBe('2026-W01')
  })

  it('keeps only source-backed paper and repository links', () => {
    expect(parseHuggingFacePapers([
      { paper: { id: '2609.01234', title: 'Grounded medical reasoning', summary: 'A source abstract', authors: [{ name: 'A Researcher' }] }, upvotes: 12 },
      { paper: { id: '../../bad', title: 'Invalid' } },
    ])).toMatchObject([{ id: 'hf:2609.01234', url: 'https://huggingface.co/papers/2609.01234', metric: '12 赞' }])
    expect(parseGithubRepositories({ items: [
      { full_name: 'lab/research-agent', html_url: 'https://github.com/lab/research-agent', stargazers_count: 38 },
      { full_name: 'lab/other', html_url: 'https://elsewhere.example/other' },
    ] })).toMatchObject([{ id: 'github:lab/research-agent', metric: '38 Stars' }])
    const many = Array.from({ length: 12 }, (_, index) => ({ paper: { id: `2609.01${String(index).padStart(3, '0')}`, title: `Paper ${index}` } }))
    expect(parseHuggingFacePapers(many)).toHaveLength(10)
  })

  it('shows only flagship meetings whose acceptance window is current', () => {
    const now = Date.parse('2026-11-14T00:00:00Z')
    expect(flagshipVenueIds(['NeurIPS.cc/2026/Conference', 'NeurIPS.cc/2026/Workshop/MLForSys', 'Workshop/2026/Conference'])).toEqual(['NeurIPS.cc/2026/Conference'])
    expect(isRecentConference('2026-12-06T00:00:00.000Z', now)).toBe(true)
    expect(isRecentConference('2027-07-01T00:00:00.000Z', now)).toBe(false)
    const group = { id: 'NeurIPS.cc/2026/Conference', content: { accept_decision_options: { value: ['Accept (poster)'] }, start_date: { value: 'Dec 06 2026' }, website: { value: 'https://neurips.cc/' }, location: { value: 'Sydney' } } }
    expect(conferenceFromGroup(group, now)).toMatchObject({ id: 'venue:NeurIPS.cc/2026/Conference', title: 'NeurIPS 2026', url: 'https://neurips.cc/', metric: '新放榜' })
    expect(conferenceFromGroup({ ...group, id: 'ICML.cc/2027/Conference', content: { ...group.content, start_date: { value: 'Jul 01 2027' } } }, now)).toBeNull()
  })
})
