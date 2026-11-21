export const reviewSections: [string, string][]
export function validateReview(raw: unknown, readPage: (page: number) => string | null): { version: 1; sections: { key: string; body: string; evidence: { page: number; quote: string }[] }[] }
export function validateAnswer(raw: unknown, readPage: (page: number) => string | null): { version: 1; body: string; evidence: { page: number; quote: string }[] }
export function reviewToMarkdown(review: ReturnType<typeof validateReview>): string
