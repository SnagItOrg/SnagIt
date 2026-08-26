-- kg_migration_contradiction.sql
--
-- Injects the one condition migration 053 must refuse to resolve: a single
-- listing carrying CONTRADICTORY validation across both rows of a duplicate
-- group — manually confirmed against one, manually rejected against the other.
--
-- Loaded only by scripts/verify-migrations-isolated.sh into the disposable
-- local cluster. Never applied to production.

INSERT INTO listing_product_match (listing_id, product_id, method, score, is_valid, rejected_reason)
VALUES
 ('22222222-0000-0000-0000-000000000009','92982f65-e9eb-448a-b647-2cc81f23af4c','SKU',95,TRUE, NULL),
 ('22222222-0000-0000-0000-000000000009','a08c0c96-c842-496e-8fa7-d7fc97cbe658','SKU',95,FALSE,'reviewer says not this product')
ON CONFLICT (listing_id, product_id) DO UPDATE
  SET is_valid = EXCLUDED.is_valid, rejected_reason = EXCLUDED.rejected_reason;
