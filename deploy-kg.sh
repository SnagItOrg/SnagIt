#!/bin/bash

##############################################################################
# deploy-kg.sh
#
# Simple deployment script for Knowledge Graph and Synonyms to Supabase.
# Usage: ./deploy-kg.sh [--dry-run]
#
# Requires:
#   - .env.local or frontend/.env.local with:
#     - NEXT_PUBLIC_SUPABASE_URL
#     - SUPABASE_SERVICE_ROLE_KEY
#
##############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# Header
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Knowledge Graph → Supabase Deployment${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check environment
if [[ -z "$NEXT_PUBLIC_SUPABASE_URL" ]]; then
  echo -e "${YELLOW}⚠️  NEXT_PUBLIC_SUPABASE_URL not set in environment${NC}"
  echo "   Checking .env.local files..."
  
  if [[ -f ".env.local" ]]; then
    echo -e "${GREEN}   ✓ Found .env.local at repo root${NC}"
    source .env.local
  elif [[ -f "frontend/.env.local" ]]; then
    echo -e "${GREEN}   ✓ Found frontend/.env.local${NC}"
    source frontend/.env.local
  else
    echo -e "${RED}   ✗ No .env.local found${NC}"
    echo "   Create one with:"
    echo "     NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co"
    echo "     SUPABASE_SERVICE_ROLE_KEY=eyJhbGc..."
    exit 1
  fi
fi

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo -e "${RED}✗ SUPABASE_SERVICE_ROLE_KEY not set${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Environment configured${NC}"
echo ""

# Check files
if [[ ! -f "data/knowledge-graph.json" ]]; then
  echo -e "${RED}✗ data/knowledge-graph.json not found${NC}"
  exit 1
fi

if [[ ! -f "data/synonyms.json" ]]; then
  echo -e "${RED}✗ data/synonyms.json not found${NC}"
  exit 1
fi

# Parse versions
KG_VERSION=$(jq -r '.version' data/knowledge-graph.json)
SYN_VERSION=$(jq -r '.version' data/synonyms.json)

echo "📖  Knowledge Graph:  v$KG_VERSION"
echo "📖  Synonyms:         v$SYN_VERSION"
echo ""

# Dry run?
if [[ "$DRY_RUN" == true ]]; then
  echo -e "${YELLOW}[DRY RUN]${NC} Not actually importing (use without --dry-run to deploy)"
  exit 0
fi

# Deploy
echo -e "${YELLOW}Deploying...${NC}"
echo ""

npm run import-kg

if [[ $? -eq 0 ]]; then
  echo ""
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  ✅ Deployment successful!${NC}"
  echo -e "${GREEN}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. Verify in Supabase: SELECT COUNT(*) FROM kg_product"
  echo "  2. Test search in the app"
  echo "  3. Monitor Vercel logs for any import-related errors"
  echo ""
else
  echo ""
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo -e "${RED}  ✗ Deployment failed!${NC}"
  echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "Check the error above and consult DEPLOYMENT_GUIDE.md"
  exit 1
fi
