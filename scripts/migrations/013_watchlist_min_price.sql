-- Migration 013: Add min_price to watchlists
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS min_price integer;
