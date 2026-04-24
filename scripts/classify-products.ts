import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// ── Env ───────────────────────────────────────────────────────────────────────
for (const p of [
  path.resolve(__dirname, '../.env.local'),
  path.resolve(__dirname, '../frontend/.env.local'),
]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase  = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

const DRY_RUN    = process.argv.includes('--dry-run');
const BATCH_SIZE = 40;
const DELAY_MS   = 200;

// ── Types ─────────────────────────────────────────────────────────────────────
interface CategoryRow {
  id: string;
  slug: string;
  parent_id: string | null;
}

interface ProductRow {
  id: string;
  canonical_name: string;
  model_name: string | null;
  brand_name: string;
}

interface ClassificationResult {
  id: string;
  reverb_root_slug: string;
  reverb_sub_slug: string;
  confidence: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripMarkdown(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (DRY_RUN) console.log('[dry-run] No writes will be made.\n');

  // Step 1: Load valid slugs from DB
  const { data: catRows, error: catErr } = await supabase
    .from('kg_category')
    .select('id, slug, parent_id')
    .eq('domain', 'music');

  if (catErr || !catRows) {
    console.error('Failed to load categories:', catErr?.message);
    process.exit(1);
  }

  const rootBySlug = new Map<string, string>(); // root slug → id
  const subBySlug  = new Map<string, string>(); // compound slug → id
  // Also a quick set of just the reverb sub_slugs (bare, not compound) per root
  // to validate AI output: reverb_root_slug + reverb_sub_slug must map to a valid compound slug
  const validCompound = new Set<string>();

  for (const row of catRows as CategoryRow[]) {
    if (row.parent_id === null) {
      rootBySlug.set(row.slug, row.id);
    } else {
      subBySlug.set(row.slug, row.id); // compound: "electric-guitars/solid-body"
      validCompound.add(row.slug);
    }
  }

  const rootSlugs = Array.from(rootBySlug.keys()).sort();
  // For the prompt, give AI just the bare sub-slugs (right side of "/")
  const subSlugsForPrompt = Array.from(subBySlug.keys())
    .map((s) => s.split('/')[1])
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .sort();

  console.log(`Loaded ${rootBySlug.size} roots, ${subBySlug.size} subcategories from DB.`);

  // Step 2: Fetch unclassified products
  const { data: products, error: prodErr } = await supabase
    .from('kg_product')
    .select('id, canonical_name, model_name, kg_brand!inner(name)')
    .is('subcategory_id', null)
    .order('canonical_name') as any;

  if (prodErr || !products) {
    console.error('Failed to load products:', prodErr?.message);
    process.exit(1);
  }

  const rows: ProductRow[] = products.map((p: any) => ({
    id: p.id,
    canonical_name: p.canonical_name,
    model_name: p.model_name ?? null,
    brand_name: p.kg_brand.name,
  }));

  const total = DRY_RUN ? Math.min(rows.length, BATCH_SIZE) : rows.length;
  const batch_rows = DRY_RUN ? rows.slice(0, BATCH_SIZE) : rows;
  const totalBatches = Math.ceil(batch_rows.length / BATCH_SIZE);

  console.log(`Found ${rows.length} unclassified products. Processing ${total} in ${totalBatches} batch(es).\n`);

  const systemPrompt =
    'You are a music gear taxonomy classifier. Given a list of products, ' +
    'return a JSON array mapping each to the closest Reverb subcategory. ' +
    'Respond ONLY with a valid JSON array — no markdown, no preamble.';

  let totalClassified = 0;
  let totalSkipped    = 0;
  const skippedIds: string[] = [];

  for (let i = 0; i < totalBatches; i++) {
    const batch = batch_rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const batchNum = i + 1;

    const userPrompt =
      `Classify each product into the closest Reverb music gear category.\n\n` +
      `Valid root slugs: ${rootSlugs.join(', ')}\n\n` +
      `Valid sub slugs: ${subSlugsForPrompt.join(', ')}\n\n` +
      `Products:\n${JSON.stringify(batch.map(p => ({
        id: p.id,
        canonical_name: p.canonical_name,
        brand_name: p.brand_name,
      })), null, 2)}\n\n` +
      `Return ONLY a JSON array:\n` +
      `[{ "id": "...", "reverb_root_slug": "...", "reverb_sub_slug": "...", "confidence": 0-100 }, ...]\n` +
      `confidence is 0-100. Use 50 if genuinely uncertain.`;

    let results: ClassificationResult[] = [];

    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const raw = response.content[0].type === 'text' ? response.content[0].text : '';
      const cleaned = stripMarkdown(raw);
      results = JSON.parse(cleaned) as ClassificationResult[];
    } catch (err: any) {
      console.error(`Batch ${batchNum}/${totalBatches} — API/parse error: ${err.message}. Skipping batch.`);
      totalSkipped += batch.length;
      skippedIds.push(...batch.map((p) => p.id));
      await sleep(DELAY_MS);
      continue;
    }

    let classified = 0;
    let skipped    = 0;

    for (const result of results) {
      const compound = `${result.reverb_root_slug}/${result.reverb_sub_slug}`;
      const rootValid = rootBySlug.has(result.reverb_root_slug);
      const subValid  = validCompound.has(compound);

      if (!rootValid || !subValid) {
        console.warn(
          `  [skip] ${result.id} — invalid slugs: root="${result.reverb_root_slug}" sub="${result.reverb_sub_slug}"`,
        );
        skipped++;
        skippedIds.push(result.id);
        continue;
      }

      const subcategory_id = subBySlug.get(compound)!;

      if (DRY_RUN) {
        const product = batch.find((p) => p.id === result.id);
        console.log(`  [would write] ${product?.canonical_name}`);
        console.log(`    root="${result.reverb_root_slug}" sub="${result.reverb_sub_slug}" confidence=${result.confidence}`);
        console.log(`    subcategory_id=${subcategory_id}`);
        classified++;
        continue;
      }

      const { error: updateErr } = await supabase
        .from('kg_product')
        .update({
          subcategory_id,
          subcategory_confidence: result.confidence,
          reverb_root_slug: result.reverb_root_slug,
          reverb_sub_slug: result.reverb_sub_slug,
        })
        .eq('id', result.id);

      if (updateErr) {
        console.warn(`  [skip] ${result.id} — update failed: ${updateErr.message}`);
        skipped++;
        skippedIds.push(result.id);
      } else {
        classified++;
      }
    }

    // Products in batch but not in results
    const resultIds = new Set(results.map((r) => r.id));
    for (const p of batch) {
      if (!resultIds.has(p.id)) {
        console.warn(`  [skip] ${p.id} (${p.canonical_name}) — not returned by API`);
        skipped++;
        skippedIds.push(p.id);
      }
    }

    console.log(`Batch ${batchNum}/${totalBatches} — classified ${classified}, skipped ${skipped} (invalid slugs)`);
    totalClassified += classified;
    totalSkipped    += skipped;

    if (i < totalBatches - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. Classified: ${totalClassified} | Skipped: ${totalSkipped} | Total: ${totalClassified + totalSkipped}`);

  if (skippedIds.length > 0) {
    const outPath = path.resolve(__dirname, 'classify-products-skipped.json');
    fs.writeFileSync(outPath, JSON.stringify(skippedIds, null, 2));
    console.log(`Skipped IDs written to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
