import assert from 'node:assert/strict'
import { test } from 'vitest'
import { validateAnswer, validateReview, reviewSections, reviewToMarkdown } from '../packages/harness-extension/review.js'
import { answerColors, pickAnswerColor } from '../packages/harness-extension/answer-colors.js'

const quote = 'Research methods provide reliable results.'
const review = () => ({ version: 1, sections: reviewSections.map(([key]) => ({ key, body: '论文未报告其他细节。', evidence: key === 'innovation' ? [{ page: 1, quote }] : [] })) })

test('review validates all eleven ordered sections and page-grounded quotes', () => {
  const value = validateReview(review(), (page) => page === 1 ? `Research methods provide reliable results. More text.` : null)
  assert.equal(value.sections.length, 11)
  assert.match(reviewToMarkdown(value), /\[p\.1\] Research methods provide reliable results/)
})

test('review rejects invented evidence and wrong section order', () => {
  assert.throws(() => validateReview(review(), () => 'Unrelated page text'), /找不到引文/)
  const swapped = review(); swapped.sections.reverse()
  assert.throws(() => validateReview(swapped, () => quote), /小节 problem 无效/)
})

test('review permits unsupported sections without fabricated highlights', () => {
  const value = review(); value.sections.forEach((section) => { section.evidence = [] })
  assert.equal(validateReview(value, () => null).sections.every((section) => section.evidence.length === 0), true)
})

test('paper answers require exact local quotes for every cited page', () => {
  const accepted = validateAnswer({ version: 1, body: '研究方法提供可靠结果。[p.1]', evidence: [{ page: 1, quote }] }, (page) => page === 1 ? quote : null)
  assert.deepEqual(accepted.evidence, [{ page: 1, quote }])
  assert.throws(() => validateAnswer({ version: 1, body: '有结果。[p.2]', evidence: [{ page: 1, quote }] }, () => quote), /缺少可核验引文/)
  assert.throws(() => validateAnswer({ version: 1, body: '有结果。[p.1]', evidence: [{ page: 1, quote: 'A fabricated research result.' }] }, () => quote), /找不到回答引文/)
  assert.deepEqual(validateAnswer({ version: 1, body: '论文无法确认这个问题。', evidence: [] }, () => null).evidence, [])
})

test('each answer uses a persistent palette color not already used for that paper', () => {
  assert.equal(pickAnswerColor(new Set()), answerColors[0])
  assert.equal(pickAnswerColor(new Set([answerColors[0]])), answerColors[1])
  const exhausted = new Set(answerColors)
  const fallback = pickAnswerColor(exhausted)
  assert.match(fallback, /^#[0-9A-F]{6}$/)
  assert.equal(exhausted.has(fallback), false)
  assert.notEqual(fallback, '#FFF5E1')
})
