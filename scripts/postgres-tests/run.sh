#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/scripts/postgres-tests/apply-migrations.sh"
(cd "$repo_root" && check_migrations)

tar -C "$repo_root" -cf - \
  --exclude='./.git' --exclude='./.git/**' --exclude='**/.git' --exclude='**/.git/**' \
  --exclude='node_modules' --exclude='**/node_modules' \
  --exclude='.next' --exclude='**/.next' \
  --exclude='.vercel' --exclude='**/.vercel' \
  --exclude='supabase/.temp' \
  --exclude='.env*' --exclude='**/.env*' \
  --exclude='.npmrc' --exclude='**/.npmrc' \
  --exclude='*.prod.temp' --exclude='**/*.prod.temp' \
  --exclude='coverage' --exclude='**/coverage' \
  --exclude='*.log' --exclude='**/*.log' \
  . |
  docker run --rm -i --network bridge -v /workspace -w /workspace "$POSTGRES_IMAGE" sh -lc '
    set -eu
    tar -xf - -C /workspace
    mkdir -p /tmp/utraya-pgdata
    chown postgres:postgres /tmp/utraya-pgdata
    gosu postgres initdb -D /tmp/utraya-pgdata --auth=trust >/dev/null
    gosu postgres pg_ctl -D /tmp/utraya-pgdata -o "-h 127.0.0.1 -p 5432" -w start >/dev/null
    trap "gosu postgres pg_ctl -D /tmp/utraya-pgdata -m fast stop >/dev/null" EXIT
    export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
    export PGOPTIONS="-c client_min_messages=warning"
    . scripts/postgres-tests/apply-migrations.sh
    apply_migrations
    psql -X -q -v ON_ERROR_STOP=1 -f scripts/postgres-tests/assertions.sql
    psql -X -q -v ON_ERROR_STOP=1 -f scripts/postgres-tests/rls.sql
  '
