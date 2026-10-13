/**
 * PAN-254: the DBA brand net.
 *
 * Before: scrape-dba queried the 32 products frozen in the monitoring file
 * while 590 public products were never searched on DBA. Now it issues one
 * query per listed brand, plus one model-name query per product whose ads
 * omit the brand, through the same staging and promotion path.
 *
 * No live request and no database: the monitoring reader, the frontend's
 * brand gate and the scraper's source are exercised as data.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { monitoredBrands, monitoredSlugs } from './source-monitoring'
import { monitoredSourcesFor } from '../../frontend/lib/source-monitoring'

const ROOT = join(__dirname, '..', '..')

test('dba.dk is a brand net and refuses to be read as a product set', () => {
  const net = monitoredBrands('dba.dk')
  assert.ok(net.brands.length >= 45, 'the 44 public brands plus strymon')
  assert.ok(net.brands.includes('manley') && net.brands.includes('shure') && net.brands.includes('martin'))
  assert.deepEqual(net.modelQueries, ['kush-clariphonic', 'shure-sm7b'])
  assert.equal(net.subCategory, '1.86.92')
  for (const b of net.brands) assert.match(b, /^[a-z0-9-]+$/, `${b} is not a kg_brand slug`)

  // A category error in either direction throws rather than returning [].
  assert.throws(() => monitoredSlugs('dba.dk'), /not a per-product query source/)
  assert.throws(() => monitoredBrands('finn'), /not a brand-net source/)
  assert.throws(() => monitoredBrands('reverb'), /not a brand-net source/)
})

test('a product is watched on dba.dk through its brand, never through its slug', () => {
  // Public products of a listed brand are watched, whatever their slug.
  assert.ok(monitoredSourcesFor('shure-sm7b', { inCatalogueSweep: true, brandSlug: 'shure' }).includes('dba.dk'))
  assert.ok(monitoredSourcesFor('any-new-manley-product', { inCatalogueSweep: false, brandSlug: 'manley' }).includes('dba.dk'))
  // A brand outside the net is not, and a product without a brand is not
  // (fail-closed), even for a slug the old product set used to list.
  assert.ok(!monitoredSourcesFor('roland-juno-106', { inCatalogueSweep: true, brandSlug: 'not-a-brand' }).includes('dba.dk'))
  assert.ok(!monitoredSourcesFor('roland-juno-106', { inCatalogueSweep: true, brandSlug: null }).includes('dba.dk'))
  // The three explicit product sets still answer by slug.
  assert.ok(monitoredSourcesFor('roland-juno-106', { inCatalogueSweep: false, brandSlug: null }).includes('finn'))
})

test('scrape-dba queries brands newest first in the configured sub-category, through the one pipeline', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'scrape-dba.ts'), 'utf8')
  assert.match(src, /const NET = monitoredBrands\('dba\.dk'\)/)
  assert.match(src, /\.from\('kg_brand'\)[\s\S]{0,80}\.in\('slug', NET\.brands\)/)
  assert.match(src, /assertResolved\('dba\.dk', NET\.brands, .+?, 'brand'\)/)
  assert.match(src, /\.in\('slug', NET\.modelQueries\)/)
  assert.match(src, /SEARCH_OPTIONS: SchibstedSearchOptions = \{ subCategory: NET\.subCategory, sort: 'PUBLISHED_DESC' \}/)
  // The same writer path as before: staging, atomic promotion, bounded matching.
  for (const call of ['stageListings(', 'promoteRunAtomic(', 'matchScrapedBatch(', "fetchBatchListingIds(supabase, 'dba.dk'"]) {
    assert.ok(src.includes(call), `scrape-dba must still call ${call}`)
  }
  // No second writer: nothing else may insert or update listings directly.
  const direct = src.match(/\.from\('listings'\)[\s\S]{0,60}\.(insert|upsert)\(/g) ?? []
  assert.equal(direct.length, 0, 'listings are written only by promote_scrape_run')
  // The scope hash is keyed on the query set, so the first net run is a bootstrap.
  assert.match(src, /query_ids: \[\.\.\.queryIds\]\.sort\(\)/)
  assert.match(src, /const SCRAPER_VERSION = 'dba-3\.0\.0'/)
})
