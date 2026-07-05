#!/usr/bin/env bash
# Local server for the dashboard e2e: a throwaway Postgres database, migrated, then
# the production build served. Requires a prior `pnpm build` and a local Postgres
# accepting connections for the current OS user.
set -euo pipefail
cd "$(dirname "$0")/.."

createdb swdi_e2e 2>/dev/null || true
export PGHOST=/var/run/postgresql
export DATABASE_URL="postgresql:///swdi_e2e"

node scripts/migrate.mjs
exec node node_modules/next/dist/bin/next start -p 3105
