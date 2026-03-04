/**
 * scripts/expand-synonyms-vse.ts
 *
 * Generates synonyms for all instruments in the knowledge graph that don't
 * already have a synonym entry, and merges them into data/synonyms.json.
 *
 * Synonym generation rules (mirrors the patterns in the existing synonym set):
 *   - canonical:  "{brand} {model}"  (lowercased, hyphens kept)
 *   - Variant 1:  Strip brand prefix if model already starts with brand name
 *   - Variant 2:  Replace hyphens with spaces → "juno-60" → "juno 60"
 *   - Variant 3:  Remove all hyphens/spaces → "juno-60" → "juno60"
 *   - Variant 4:  "{brand} {model without hyphens}"
 *   - Variant 5:  Common abbreviations for well-known series
 *
 * Usage:
 *   npx tsx scripts/expand-synonyms-vse.ts
 *   npx tsx scripts/expand-synonyms-vse.ts --dry-run
 *
 * Output:
 *   data/synonyms.json  (updated in place, version bumped)
 */

import * as fs   from 'fs'
import * as path from 'path'

const DRY_RUN  = process.argv.includes('--dry-run')

const KG_PATH  = path.resolve(__dirname, '../data/knowledge-graph.json')
const SYN_PATH = path.resolve(__dirname, '../data/synonyms.json')

// ── Types ─────────────────────────────────────────────────────────────────────
interface KgProduct  { name: string; type: string; era?: string; reference_url?: string }
interface KgBrand    { products: Record<string, KgProduct> }
interface KgCategory { brands: Record<string, KgBrand> }
interface KnowledgeGraph {
  version: string; description: string
  categories: Record<string, KgCategory>
}
interface SynonymFile {
  version:     string
  description: string
  synonyms:    Record<string, string[]>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * Generate synonym variants for a product given its canonical key
 * (e.g. "roland juno-60") and the raw name (e.g. "Roland Juno-60").
 */
function generateSynonyms(canonicalKey: string, rawName: string): string[] {
  const syns = new Set<string>()

  // Parse brand and model from the raw name
  // e.g. "Roland Juno-60" → brand="roland", model="juno-60"
  const nameLower = rawName.toLowerCase().trim()
  // canonicalKey is already "roland-juno-60" style — convert to space-separated
  const canonical = canonicalKey.replace(/-/g, ' ')

  // Add brand-model with space (no hyphens in model)
  const withoutHyphens = canonical.replace(/-/g, ' ')
  if (withoutHyphens !== canonical) syns.add(withoutHyphens)

  // Add model-only (strip brand from front if it starts with it)
  // Find the brand prefix (first word(s) of canonical that form the brand key)
  // We'll try to find the brand from the raw name's first capital-word-group
  const parts = rawName.trim().split(/\s+/)
  let brandEnd = 1
  // Multi-word brands: stop when we hit the model name (starts with digit or is all-caps abbrev)
  for (let i = 1; i < parts.length; i++) {
    if (/^[A-Z0-9]/.test(parts[i]) && !/^[A-Z][a-z]/.test(parts[i])) {
      // Looks like a model identifier (all caps, digit-led, etc.)
      brandEnd = i
      break
    }
    // Stop if part is clearly a model number
    if (/^[A-Z]{1,3}[-\d]/.test(parts[i]) || /^\d/.test(parts[i])) {
      brandEnd = i
      break
    }
  }

  const brandName  = parts.slice(0, brandEnd).join(' ').toLowerCase()
  const modelPart  = parts.slice(brandEnd).join(' ').toLowerCase()
  const modelNoDash = modelPart.replace(/-/g, ' ')
  const modelNoSep  = modelPart.replace(/[-\s]/g, '')

  // Model only (if differs from canonical)
  if (modelPart && modelPart !== canonical) {
    syns.add(modelPart)
  }
  // Model with spaces instead of hyphens
  if (modelNoDash !== modelPart) syns.add(modelNoDash)
  // Model fully concatenated
  if (modelNoSep !== modelPart && modelNoSep.length > 2) syns.add(modelNoSep)

  // Brand + model no hyphens
  const brandModelNoHyph = `${brandName} ${modelNoDash}`.trim()
  if (brandModelNoHyph !== canonical) syns.add(brandModelNoHyph)

  // Brand + model concatenated (no space, no hyphens) — less useful but valid
  // Only for short model names to avoid noise
  if (modelNoSep.length <= 8) {
    const concat = `${brandName}${modelNoSep}`
    if (concat.length > brandName.length + 1) syns.add(concat)
  }

  // Strip the canonical itself (key already stores it)
  syns.delete(canonical)
  // Remove duplicates that equal canonicalKey
  syns.delete(canonicalKey)
  // Remove empty
  syns.delete('')

  // Normalise all: lowercase, collapse whitespace, trim
  const normalised = [...syns]
    .map(s => s.toLowerCase().replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 1)

  return [...new Set(normalised)].sort()
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  const kg:  KnowledgeGraph = JSON.parse(fs.readFileSync(KG_PATH,  'utf8'))
  const syn: SynonymFile    = JSON.parse(fs.readFileSync(SYN_PATH, 'utf8'))

  const existing = new Set(Object.keys(syn.synonyms))

  let added   = 0
  let skipped = 0

  const musicGear = kg.categories['music-gear']
  if (!musicGear) { console.error('❌  music-gear not found'); process.exit(1) }

  for (const [brandSlug, brand] of Object.entries(musicGear.brands)) {
    for (const [productKey, product] of Object.entries(brand.products)) {
      // Canonical key for synonyms: use product slug with spaces, no brand prefix duplication
      // e.g. "roland-juno-60" → "roland juno-60"
      const canonicalKey = productKey.replace(/-/g, ' ')

      if (existing.has(canonicalKey)) {
        skipped++
        continue
      }

      const variants = generateSynonyms(productKey, product.name)
      if (variants.length === 0) {
        skipped++
        continue
      }

      syn.synonyms[canonicalKey] = variants
      added++
    }
  }

  console.log(`Synonyms added: ${added}  Skipped (existing): ${skipped}`)

  if (!DRY_RUN && added > 0) {
    const [major, minor, patch] = (syn.version ?? '1.0.0').split('.').map(Number)
    syn.version = `${major}.${minor + 1}.${patch ?? 0}`

    fs.writeFileSync(SYN_PATH, JSON.stringify(syn, null, 2))
    console.log(`✅  synonyms.json updated (v${syn.version}) — ${Object.keys(syn.synonyms).length} total entries`)
  } else if (DRY_RUN) {
    console.log('(Dry run — not written)')
  }
}

main()
