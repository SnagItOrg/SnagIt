# Deployment Guide: Knowledge Graph & Synonyms to Supabase

This guide explains how to deploy updated knowledge graphs and synonyms to Supabase.

## Quick Start (for Claude Code or manual deployment)

### Prerequisites
- Supabase project set up
- Service role key in `.env.local` or `frontend/.env.local`
- Both files must have:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
  ```

### Deployment Steps

```bash
# 1. Verify the knowledge graph is up to date
npm run export-kg  # optional: validate export

# 2. Import to Supabase (idempotent)
npm run import-kg

# 3. Verify in Supabase dashboard
# - Check kg_category, kg_brand, kg_product table row counts
# - Spot-check a few products to ensure they imported correctly
```

### What `npm run import-kg` does

The import script is **fully idempotent** and follows this order:

1. **Categories** — upsert on `slug` (non-destructive)
   - Creates/updates: music-gear, danish-modern, photography, tech

2. **Brands** — upsert on `slug` (non-destructive)
   - ~197 music gear brands imported with proper display names
   - Associates each brand with its category

3. **Products** — upsert on `slug` (non-destructive)
   - ~3300 music products with metadata (price range, era, reference URL)
   - Includes attributes (type: instrument, cable, etc.)

4. **Identifiers** — **FULL REPLACE** (delete + insert)
   - SKUs, EANs, model numbers
   - Each identifier linked to a product with confidence score

5. **Relations** — **FULL REPLACE** (delete + insert)
   - Product clones, related products, variants
   - Includes weight/importance scores

6. **Synonyms** — **FULL REPLACE** (delete + insert)
   - Search aliases for both Danish and English
   - Includes priority/match_type for ranking

### Important Notes

- **Idempotent**: Safe to run multiple times. Categories/brands/products upsert on slug, so duplicates are merged.
- **Batch processing**: Tables are processed in 100-row batches to avoid timeout errors
- **Service role required**: Uses Supabase service role key, not RLS policies
- **Timing**: ~30–60 seconds depending on network and Supabase latency

## For Claude Code Deployment

If you're deploying via Claude Code (e.g., in a thread), follow these steps in order:

1. **Ensure env vars are set** in the deployment environment:
   ```bash
   echo $NEXT_PUBLIC_SUPABASE_URL
   echo $SUPABASE_SERVICE_ROLE_KEY  # should NOT echo; just verify it's set
   ```

2. **Run the import**:
   ```bash
   npm run import-kg
   ```

3. **Monitor output** for success/errors:
   - ✅ `✓ X categories` → Categories imported
   - ✅ `✓ X brands` → Brands imported
   - ✅ `✓ X products` → Products imported
   - ✅ `✓ X identifiers` → SKU/EAN/model data imported
   - ✅ `✓ X relations` → Clone/related data imported
   - ✅ `✓ X synonyms` → Search aliases imported

4. **Verify in Supabase**:
   - Go to `https://app.supabase.com` → your project
   - Click SQL Editor
   - Run: `SELECT COUNT(*) FROM kg_product` → should show ~3300+
   - Run: `SELECT COUNT(*) FROM kg_brand` → should show ~197

## Troubleshooting

### "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
- Env vars not loaded. Check:
  - `.env.local` at repo root (scripts looks here first)
  - `frontend/.env.local` (fallback location)
  - Both must have `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`

### "Upsert error: 401 Unauthorized"
- Service role key is invalid or expired
- Check Supabase project settings → API → Service Role Key

### "Foreign key constraint violation"
- A brand or category slug changed, breaking products
- Verify `BRAND_NAME_OVERRIDES` in `scripts/import-knowledge-graph.ts`
- May need to migrate existing data if schema changed

### Network timeout
- Supabase is slow or unreachable
- Try again, or increase batch size in script

## Files Involved

- `data/knowledge-graph.json` — Master data file (JSON)
- `data/synonyms.json` — Search aliases (JSON)
- `scripts/import-knowledge-graph.ts` — Deployment script
- `frontend/.env.local` or `.env.local` — Environment variables
- Supabase tables: `kg_category`, `kg_brand`, `kg_product`, `kg_identifier`, `kg_relation`, `kg_synonym`

## Advanced: Custom Deployments

If you need to deploy only categories/brands (not products), edit `scripts/import-knowledge-graph.ts` and comment out steps 3–6.

For a dry-run (no writes):
1. Edit the script to comment out all `upsert()` calls
2. Run `npm run import-kg` to see what would be imported
3. Revert the changes

---

**Last updated:** 2026-03-06
**Knowledge Graph Version:** v1.14.0
**Total Products:** 3,298
**Total Brands:** 197
