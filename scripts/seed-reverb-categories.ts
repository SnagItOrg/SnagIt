import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

import { refreshPayload, type SeededCategory } from './lib/reverb-category-seed';

dotenv.config({ path: join(__dirname, '../frontend/.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ReverbCategory {
  uuid: string;
  full_name: string;
  name: string;
  root_slug: string;
  slug: string;
}

interface ReverbCategoriesFile {
  categories: ReverbCategory[];
}

async function main() {
  const raw = readFileSync(join(__dirname, '../data/reverb-categories.json'), 'utf-8');
  const { categories }: ReverbCategoriesFile = JSON.parse(raw);

  // --- Step 1: Upsert root categories (parent_id = NULL) ---

  const roots: SeededCategory[] = Array.from(
    new Map(
      categories.map((c) => [
        c.root_slug,
        {
          slug: c.root_slug,
          name_en: c.full_name.split(' / ')[0],
          // INVARIANT: name_en is the source, name_da is Danish and is
          // hand-maintained — nothing derives it (scripts/CLAUDE.md). The
          // English string below is a seed for a row that does not exist yet,
          // never a correction to one that does. It reaches the database only
          // through the DO NOTHING leg immediately below; the DO UPDATE leg
          // sends refreshPayload(), which omits the column entirely.
          name_da: c.full_name.split(' / ')[0],
          domain: 'music' as const,
          parent_id: null,
        },
      ]),
    ).values(),
  );

  // Leg 1 — ON CONFLICT (slug) DO NOTHING. Creates missing roots, including
  // their seeded name_da, and leaves every existing row untouched.
  const { error: rootInsertErr } = await supabase
    .from('kg_category')
    .upsert(roots, { onConflict: 'slug', ignoreDuplicates: true });

  if (rootInsertErr) {
    console.error('Root insert failed:', rootInsertErr.message);
    process.exit(1);
  }

  // Leg 2 — ON CONFLICT (slug) DO UPDATE SET <every seeded column but name_da>.
  // PostgREST builds the SET list from the payload keys, so a column that is
  // never sent can never be overwritten.
  const { error: rootErr } = await supabase
    .from('kg_category')
    .upsert(refreshPayload(roots), { onConflict: 'slug', ignoreDuplicates: false });

  if (rootErr) {
    console.error('Root upsert failed:', rootErr.message);
    process.exit(1);
  }

  console.log(`Seeded ${roots.length} root categories.`);

  // --- Step 2: Fetch root UUIDs for parent_id references ---

  const { data: rootRows, error: fetchErr } = await supabase
    .from('kg_category')
    .select('id, slug')
    .in('slug', roots.map((r) => r.slug));

  if (fetchErr || !rootRows) {
    console.error('Root fetch failed:', fetchErr?.message);
    process.exit(1);
  }

  const rootIdBySlug = new Map(rootRows.map((r) => [r.slug, r.id]));

  // --- Step 3: Upsert subcategories ---
  // Compound slug = "{root_slug}/{sub_slug}" ensures global uniqueness
  // since the same sub_slug can appear under multiple roots (e.g. "12-string").

  const subs: SeededCategory[] = categories.map((c) => ({
    slug: `${c.root_slug}/${c.slug}`,
    name_en: c.name,
    // INVARIANT: see above. Seeded only via the DO NOTHING leg, so a re-run
    // cannot overwrite a hand-set name_da.
    name_da: c.name,
    domain: 'music' as const,
    parent_id: rootIdBySlug.get(c.root_slug) ?? null,
  }));

  // Leg 1 — DO NOTHING: create missing leaves with their seeded name_da.
  const { error: subInsertErr } = await supabase
    .from('kg_category')
    .upsert(subs, { onConflict: 'slug', ignoreDuplicates: true });

  if (subInsertErr) {
    console.error('Subcategory insert failed:', subInsertErr.message);
    process.exit(1);
  }

  // Leg 2 — DO UPDATE, without name_da in the payload.
  const { error: subErr } = await supabase
    .from('kg_category')
    .upsert(refreshPayload(subs), { onConflict: 'slug', ignoreDuplicates: false });

  if (subErr) {
    console.error('Subcategory upsert failed:', subErr.message);
    process.exit(1);
  }

  console.log(`Seeded ${subs.length} subcategories.`);
  console.log(`Total: ${roots.length} roots + ${subs.length} subcategories = ${roots.length + subs.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
