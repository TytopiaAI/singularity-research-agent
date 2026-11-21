import { expect, it } from 'vitest'
import { mentionToken } from '../src/shared/mentions'

it('keeps the id inside a mention the composer can insert', () => {
  expect(mentionToken('field', '强化学习', '11111111-1111-4111-8111-111111111111')).toBe('@[强化学习](singularity-field:11111111-1111-4111-8111-111111111111)')
  expect(mentionToken('paper', 'Attention Is All You Need', '22222222-2222-4222-8222-222222222222')).toBe('@[Attention Is All You Need](singularity-paper:22222222-2222-4222-8222-222222222222)')
})

it('strips brackets that would break the mention and falls back when the title is empty', () => {
  expect(mentionToken('paper', 'A [survey] (2024)', '33333333-3333-4333-8333-333333333333')).toBe('@[A survey 2024](singularity-paper:33333333-3333-4333-8333-333333333333)')
  expect(mentionToken('field', '   ', '44444444-4444-4444-8444-444444444444')).toBe('@[未命名领域](singularity-field:44444444-4444-4444-8444-444444444444)')
})
