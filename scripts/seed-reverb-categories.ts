import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

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

  const roots = Array.from(
    new Map(
      categories.map((c) => [
        c.root_slug,
        {
          slug: c.root_slug,
          name_en: c.full_name.split(' / ')[0],
          name_da: c.full_name.split(' / ')[0], // Danish translations TBD
          domain: 'music' as const,
          parent_id: null,
        },
      ]),
    ).values(),
  );

  const { error: rootErr } = await supabase
    .from('kg_category')
    .upsert(roots, { onConflict: 'slug', ignoreDuplicates: false });

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

  const subs = categories.map((c) => ({
    slug: `${c.root_slug}/${c.slug}`,
    name_en: c.name,
    name_da: c.name, // Danish translations TBD
    domain: 'music' as const,
    parent_id: rootIdBySlug.get(c.root_slug) ?? null,
  }));

  const { error: subErr } = await supabase
    .from('kg_category')
    .upsert(subs, { onConflict: 'slug', ignoreDuplicates: false });

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
