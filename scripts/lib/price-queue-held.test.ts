import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partitionHeld } from './price-queue-held'

const sale = (listing_url: string | null) => ({ listing_url })

test('PAN-231: an unlinked row for the sale is linked, not joined by a second row', () => {
  const { fresh, toLink } = partitionHeld(
    [sale('u/1'), sale('u/2')],
    [{ id: 'a', listing_url: 'u/1', kg_product_id: null }],
  )
  assert.deepEqual(fresh, [sale('u/2')])
  assert.deepEqual(toLink.map(h => h.id), ['a'])
})

test('PAN-231: a sale that already has a linked row is left alone — its unlinked copy is not linked too', () => {
  const { fresh, toLink } = partitionHeld(
    [sale('u/1')],
    [
      { id: 'a', listing_url: 'u/1', kg_product_id: 'p' },
      { id: 'b', listing_url: 'u/1', kg_product_id: null },
    ],
  )
  assert.deepEqual(fresh, [])
  assert.deepEqual(toLink, [])
})

test('PAN-231: two unlinked copies of one sale — only one is linked', () => {
  const { fresh, toLink } = partitionHeld(
    [sale('u/1')],
    [
      { id: 'a', listing_url: 'u/1', kg_product_id: null },
      { id: 'b', listing_url: 'u/1', kg_product_id: null },
    ],
  )
  assert.deepEqual(fresh, [])
  assert.deepEqual(toLink.map(h => h.id), ['a'])
})

test('PAN-231: a sale without a URL is never held', () => {
  const { fresh, toLink } = partitionHeld([sale(null)], [])
  assert.deepEqual(fresh, [sale(null)])
  assert.deepEqual(toLink, [])
})
