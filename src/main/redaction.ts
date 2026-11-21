const SECRET_KEYS = /(api[-_ ]?key|authorization|bearer|token|secret|password)/i

export function redact(value: unknown): string {
  let text = value instanceof Error ? value.message : String(value ?? '')
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
  text = text.replace(/(sk-|ds-|brz_)[A-Za-z0-9_-]{8,}/gi, '$1[REDACTED]')
  text = text.replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
  return text.slice(0, 2_000)
}

export function redactObject<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactObject) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SECRET_KEYS.test(key) ? '[REDACTED]' : redactObject(item),
      ]),
    ) as T
  }
  return value
}
