-- Operations: listing_product_match review state by tier.
--
-- Kind: operational query (READ-ONLY)
-- Related migrations: 038 (is_valid, rejected_reason)
--
-- is_valid: NULL = unreviewed, true = confirmed, false = rejected.
-- /api/product/[slug] and /intel filter `is_valid IS NULL OR is_valid = true`,
-- so unreviewed rows are TREATED AS TRUSTED — the pending column is live risk,
-- not backlog. Populated by scripts/ai-validate-matches.ts.

SELECT
  p.tier,
  count(*) FILTER (WHERE m.is_valid = true)  AS confirmed_valid,
  count(*) FILTER (WHERE m.is_valid = false) AS rejected,
  count(*) FILTER (WHERE m.is_valid IS NULL) AS pending_review,
  count(*) FILTER (WHERE m.explain ? 'ai_pass1') AS ai_pass1_reviewed,
  count(*) FILTER (WHERE m.explain ? 'ai_pass2') AS ai_pass2_reviewed
FROM listing_product_match m
JOIN kg_product p ON p.id = m.product_id
GROUP BY p.tier
ORDER BY p.tier;
