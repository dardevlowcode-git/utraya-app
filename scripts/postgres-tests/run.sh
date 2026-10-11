#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
  docker run --rm -i --network bridge -v /workspace -w /workspace postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 sh -lc '
    set -eu
    tar -xf - -C /workspace
    mkdir -p /tmp/utraya-pgdata
    chown postgres:postgres /tmp/utraya-pgdata
    gosu postgres initdb -D /tmp/utraya-pgdata --auth=trust >/dev/null
    gosu postgres pg_ctl -D /tmp/utraya-pgdata -o "-h 127.0.0.1 -p 5432" -w start >/dev/null
    trap "gosu postgres pg_ctl -D /tmp/utraya-pgdata -m fast stop >/dev/null" EXIT
    export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGDATABASE=postgres
    psql -X -v ON_ERROR_STOP=1 -f scripts/postgres-tests/fixture.sql
    for migration in \
      20261011230600_api_credential_retry_limits.sql \
      20261011235900_persistent_credential_validation_jobs.sql \
      20261012000000_firecrawl_personal_credentials.sql \
      20261012001000_youtube_channel_key_rotation.sql \
      20261012002000_firecrawl_transcript_recovery.sql \
      20261012003000_atomic_credential_replacement.sql; do
      psql -X -v ON_ERROR_STOP=1 -f "supabase/migrations/$migration"
    done
    psql -X -v ON_ERROR_STOP=1 -f scripts/postgres-tests/assertions.sql
  '
