/**
 * PAN-309. The watch form's max-price field rejected its own prefilled value
 * ("Enter a valid value"): a number input's valid values are `min + k·step`,
 * so `min={1} step={100}` accepts 4,401 and 4,501 but never the 4,500 the
 * product page suggests (the band's q1 rounded to whole hundreds).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FRONTEND = join(__dirname, '..', '..', 'frontend')
const read = (...p: string[]) => readFileSync(join(FRONTEND, ...p), 'utf8')

test('the suggested max price is a valid value of the watch form price field', () => {
  const page = read('app', '(shell)', 'product', '[slug]', 'page.tsx')
  assert.match(page, /Math\.max\(100, Math\.round\(stats\.q1 \/ 100\) \* 100\)/, 'the suggestion is whole hundreds')

  const form = read('components', 'WatchProductForm.tsx')
  const field = form.match(/<TextField\b(?:(?!<TextField\b)[\s\S])*?type="number"[\s\S]*?\/>/)?.[0]
  assert.ok(field, 'the price field is a number TextField')
  const min = Number(field.match(/\bmin=\{(\d+)\}/)?.[1] ?? 0)
  const step = Number(field.match(/\bstep=\{(\d+)\}/)?.[1] ?? 1)
  for (const suggested of [100, 4500, 12300]) {
    assert.equal((suggested - min) % step, 0, `${suggested} kr must satisfy min=${min} step=${step}`)
  }
  // A typed price is any whole krone, as `priceOk` accepts.
  assert.equal((4550 - min) % step, 0, 'a typed 4,550 kr must be valid too')
})
