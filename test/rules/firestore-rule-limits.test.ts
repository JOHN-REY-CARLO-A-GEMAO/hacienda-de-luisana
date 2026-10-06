import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const rules = readFileSync(join(__dirname, '../../firestore.rules'), 'utf8')

/** Strip comments without treating comment-like text inside a string as a comment. */
function withoutComments(source: string): string {
  let result = ''
  let quote: "'" | '"' | null = null
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (current === '\n') {
        lineComment = false
        result += current
      }
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false
        index += 1
      } else if (current === '\n') {
        result += current
      }
      continue
    }
    if (quote) {
      result += current
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = null
      continue
    }
    if (current === "'" || current === '"') {
      quote = current
      result += current
    } else if (current === '/' && next === '/') {
      lineComment = true
      index += 1
    } else if (current === '/' && next === '*') {
      blockComment = true
      index += 1
    } else {
      result += current
    }
  }

  return result
}

function functionLetBindings(source: string): Array<{ name: string; count: number }> {
  const code = withoutComments(source)
  const declaration = /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/g
  const functions: Array<{ name: string; count: number }> = []
  let match: RegExpExecArray | null

  while ((match = declaration.exec(code)) !== null) {
    const name = match[1]
    const bodyStart = declaration.lastIndex
    let depth = 1
    let quote: "'" | '"' | null = null
    let escaped = false
    let bodyEnd = bodyStart

    for (; bodyEnd < code.length && depth > 0; bodyEnd += 1) {
      const current = code[bodyEnd]
      if (quote) {
        if (escaped) escaped = false
        else if (current === '\\') escaped = true
        else if (current === quote) quote = null
      } else if (current === "'" || current === '"') {
        quote = current
      } else if (current === '{') {
        depth += 1
      } else if (current === '}') {
        depth -= 1
      }
    }

    const body = code.slice(bodyStart, bodyEnd - 1)
    const count = (body.match(/^\s*let\s+[A-Za-z_][A-Za-z0-9_]*\s*=/gm) ?? []).length
    functions.push({ name, count })
    declaration.lastIndex = bodyEnd
  }

  return functions
}

describe('Firestore Rules compile-time limits', () => {
  it('keeps every function within Firestore’s ten-let-binding limit', () => {
    const overLimit = functionLetBindings(rules).filter(({ count }) => count > 10)
    expect(overLimit, `Rules functions exceed the ten-binding limit: ${JSON.stringify(overLimit)}`).toEqual([])
  })
})
