#!/usr/bin/env bash
set -euo pipefail

readonly SUPABASE_VERSION='2.121.0'

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != '--check' ) ]]; then
  printf 'Uso: %s [--check]\n' "$0" >&2
  exit 1
fi

if ! version="$(supabase --version)" || [[ "$version" != "$SUPABASE_VERSION" ]]; then
  printf 'Versione Supabase CLI richiesta: %s\n' "$SUPABASE_VERSION" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
target="$repo_root/src/lib/types/database.generated.ts"
source "$repo_root/scripts/postgres-tests/apply-migrations.sh"
(cd "$repo_root" && check_migrations)

temp_file="$(mktemp)"
container_name="utraya-db-types-$(cat /proc/sys/kernel/random/uuid)"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -f "$temp_file"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

password="$(openssl rand -hex 24)"
container_id="$(docker run -d --name "$container_name" -e "POSTGRES_PASSWORD=$password" -p 127.0.0.1::5432 "$POSTGRES_IMAGE")"

ready=false
for _ in {1..60}; do
  # L'entrypoint avvia prima un server provvisorio che ascolta solo sul socket.
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  printf 'PostgreSQL non disponibile entro 60 secondi.\n' >&2
  exit 1
fi

tar -C "$repo_root" -cf - scripts/postgres-tests/apply-migrations.sh \
  scripts/postgres-tests/fixture.sql scripts/postgres-tests/firecrawl-removal-fixture.sql \
  supabase/migrations |
  docker exec -i "$container_id" sh -c '
    set -eu
    mkdir -p /workspace
    tar -xf - -C /workspace
    cd /workspace
    export PGUSER=postgres PGDATABASE=postgres
    . scripts/postgres-tests/apply-migrations.sh
    apply_migrations
  ' >/dev/null

# Supabase usa extensions; la fixture usa public, che esporrebbe funzioni uuid_* non presenti su DEV.
printf 'ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;\n' |
  docker exec -i -e PGOPTIONS='-c client_min_messages=warning' "$container_id" \
    psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null

port="$(docker port "$container_id" 5432/tcp)"
port="${port##*:}"
supabase gen types typescript --db-url "postgresql://postgres:$password@127.0.0.1:$port/postgres?sslmode=disable" --schema public > "$temp_file"

if [[ "${1:-}" == '--check' ]]; then
  if ! cmp -s "$target" "$temp_file"; then
    printf 'I tipi generati differiscono da %s; eseguire lo script senza --check.\n' "$target" >&2
    exit 1
  fi
  printf 'I tipi generati sono aggiornati.\n'
else
  cat "$temp_file" > "$target"
  printf 'Tipi generati in %s\n' "$target"
fi
