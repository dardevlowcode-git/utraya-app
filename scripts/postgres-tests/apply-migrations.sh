#!/bin/sh
# Sorgente comune per l'immagine e per la sequenza applicata ai due database effimeri.
POSTGRES_IMAGE='postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'

check_migrations() {
  if [ ! -f supabase/migrations/20261028150000_remove_firecrawl.sql ]; then
    printf 'Migrazione per la fixture assente: %s\n' 'supabase/migrations/20261028150000_remove_firecrawl.sql' >&2
    return 1
  fi
}

apply_migrations() (
  set -eu
  export LC_ALL=C PGOPTIONS='-c client_min_messages=warning'
  check_migrations
  psql -X -q -v ON_ERROR_STOP=1 -f scripts/postgres-tests/fixture.sql
  # I prefissi numerici e i timestamp ordinati lessicograficamente sono l'ordine delle migrazioni Supabase.
  for migration in supabase/migrations/*.sql; do
    if [ "$migration" = supabase/migrations/20261028150000_remove_firecrawl.sql ]; then
      psql -X -q -v ON_ERROR_STOP=1 -f scripts/postgres-tests/firecrawl-removal-fixture.sql
    fi
    psql -X -q -v ON_ERROR_STOP=1 -f "$migration"
  done
)
