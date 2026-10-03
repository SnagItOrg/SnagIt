/**
 * scripts/lib/pan219-body-pickups.test.ts
 *
 * PAN-219: a body TYPE ("Hollow Body", "Semi-Hollow Body", "Solid Body") and pickups named after an
 * inclusion marker ("with TV Jones Pickups") are the instrument's spec, not a part for sale. On
 * production titles (the active and confirmed-match titles `body` and `pickup(s)` deferred, read-only
 * snapshot 2026-10-03). Bodies and pickups for sale keep their deferral.
 *
 * Run: npx tsx --test scripts/lib/pan219-body-pickups.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { detectNonProductIntent } from '../../frontend/lib/matching/listing-intent'

const token = (title: string): string | null => detectNonProductIntent(title)?.token ?? null

test('PAN-219: a body type is not a body for sale', () => {
  assert.equal(token('Gretsch G5420T Electromatic Classic Hollow Body Single-Cut with Bigsby - Walnut Stain'), null)
  assert.equal(token("Gretsch G6120T-59 Vintage Select Edition '59 Chet Atkins Hollow Body w/Bigsby"), null)
  assert.equal(token('Epiphone ES-335 Semi-Hollow Body Electric Guitar Vintage Sunburst'), null)
  assert.equal(token('Gibson ES-335 Semi-hollow body Electric Guitar - Vintage Ebony'), null)
  assert.equal(token('Eastman SB59-RB Solid Body Series Electric Guitar - Redburst'), null)
  assert.equal(token('Fender American Professional II Stratocaster Thinline Semi Hollow Body Electric Guitar - Transparent Surf Green'), null)
  assert.equal(token('Gibson  Firebird VII Solid Body Electric Guitar (1964), ser. #210346, original black hard shell case.'), null)
})

test('PAN-219: a body for sale stays deferred, with or without a type word', () => {
  assert.equal(token('Fender American Performer Mustang Bass BODY & HARDWARE USA Sunburst'), 'body')
  assert.equal(token('Fender Jim Root Jazzmaster V4 LOADED BODY Guitar Mahogany Satin White'), 'body')
  assert.equal(token('Fender Vintera Telecaster Thinline Body Fully Loaded/Gibson Burstbucker@Bridge'), 'body')
  assert.equal(token('Korg Mono/Poly Custom Synthesizer Replacement Solid Walnut Chassis / Body / Case'), 'body')
  assert.equal(token('Fender American Professional II Jazz bass body V 5-string unfinished'), 'body')
  assert.equal(token('Fender Player Plus Precision Bass - Body Only'), 'body')
  assert.equal(token('Fender MALMSTEEN Stratocaster Body'), 'body')
  assert.equal(token('Tokai Breezysound ATE-102M Ocean Turquoise OTM MIJ Ash Body'), 'body')
  assert.equal(token('Fender American Ultra II kropp med pickups'), 'kropp')
})

test('PAN-219: pickups after an inclusion marker are the spec, not the part', () => {
  assert.equal(token("Gretsch G6128T-53 Vintage Select '53 Duo Jet 6-String Right-Handed Electric Guitar with Bigsby, Rosewood Fingerboard, Duo Jet with TV Jones Pickups"), null)
  assert.equal(token('Fender MIM Jazz Bass w/ Custom Shop pickups'), null)
  assert.equal(token('Used 2025 Martin D-18 Satin Acoustic Guitar - Natural Satin with Fishman Pickup and Martin Hardshell Case'), null)
  assert.equal(token('Fender MIJ 50s Stratocaster mit Custom Shop Texas Special Pickups'), null)
  assert.equal(token('Epiphone Les Paul Prophecy med Fishman Fluence pickups'), null)
  assert.equal(token('Gibson ES-330 Hollow Body Guitar w/ P-90 Pickups and Hardshell Case - Tobacco Sunburst'), null)
})

test('PAN-219: pickups for sale, and a loaded body or pickguard sold with pickups, stay deferred', () => {
  assert.equal(token('1978 Fender Telecaster neck pickup'), 'pickup')
  assert.equal(token('Seymour Duncan TB-4 JB Model Bridge Trembucker Pickup - Nickle Cover'), 'pickup')
  assert.equal(token('Fender American Standard Jazz Bass 2016 - Custom Shop \'60s Pickups'), 'pickups')
  assert.equal(token('Alnus Custom Precision Bass + Fender Customshop \'62 Pickups'), 'pickups')
  assert.equal(token('Fender Troy Van Leeuwen Jazzmaster Loaded Body with Original Pickups - Oxblood'), 'body')
  assert.equal(token('Pickguard for Music Man USA Stingray Bass HH with "ledge" pickups 2006 - 2018 - Assorted'), 'pickguard')
  // `plus` is not a pickup marker, so the part fires on `pickup` first; either way the neck pickup is deferred.
  assert.equal(token('Genuine Fender Telecaster Player Plus Pickup Neck Chrome 2021 #DK09'), 'pickup')
})
