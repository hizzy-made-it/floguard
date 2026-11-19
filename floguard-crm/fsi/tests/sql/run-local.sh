#!/usr/bin/env bash
# Local Postgres verification of fsi/sql migrations (no PostGIS, no Supabase needed).
#
#   fsi/tests/sql/run-local.sh            # full run, stops the server at the end
#   KEEP_SERVER=1 fsi/tests/sql/run-local.sh
#   PGBIN=/usr/lib/postgresql/17/bin PGPORT=54329 fsi/tests/sql/run-local.sh
#
# What it does
#   1. starts a throw-away cluster under $PGROOT (default /tmp/pg-s) as an unprivileged user
#      (creates OS user "pgs" when run as root, because initdb refuses root)
#   2. s_base: Supabase stand-ins (00_bootstrap_supabase.sql) + fsi/sql/001..015 + the two
#      supabase/migrations files re-applied (they duplicate 001/003/004; must be no-ops)
#   3. scenario databases cloned from s_base:
#        s_a  no public.leads table                       (017 creates it)
#        s_b  legacy leads table (academy-pg.js shape) with duplicate parcel_ids and null names
#        s_c  legacy leads table, no duplicate parcel_ids (lists is jsonb)
#        s_d  legacy leads table exactly as inferred from academy-pg.js (no parcel_id/address columns)
#        s_e  like s_a, but every object is owned by a NON-superuser role and the migrations run as that role
#   4. applies EVERY fsi/sql/NNN_*.sql with NNN > 015 (so 018+ are picked up automatically) three
#      times, asserting that the 2nd and 3rd runs change neither the schema nor any data
#   5. runs every fsi/tests/sql/*.test.sql whose "-- scenarios:" header names the scenario
#   Exit code 1 if any step or assertion fails.
#
# Rewrites applied to a TEMP COPY of each migration (committed files are never edited):
#   [extensions.]geometry(MultiPolygon, 4326) -> extensions.geometry (typmod cannot be emulated)
#   "using gist (col)"                       -> "(col)"               (no gist opclass for the stand-in)
#   create extension postgis / pg_cron       -> removed / null;       (stand-ins pre-created)
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRM="$(cd "$HERE/../../.." && pwd)"
SQL="$CRM/fsi/sql"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGROOT="${PGROOT:-/tmp/pg-s}"
PGPORT="${PGPORT:-54329}"
PGDATA="$PGROOT/data"
PGUSER_OS="${PGUSER_OS:-pgs}"
TMP="$PGROOT/work"
export PATH="$PGBIN:$PATH"

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u "$PGUSER_OS" -- "$@"; else "$@"; fi; }

# PostGIS schema layout under test. Production has PostGIS in `public`; 001 installs it in
# `extensions`. Without POSTGIS_SCHEMA set, the whole run happens twice (review R1), once per layout.
if [ -z "${POSTGIS_SCHEMA:-}" ]; then
  rc=0
  for gs in extensions public; do
    echo "################ POSTGIS_SCHEMA=$gs ################"
    POSTGIS_SCHEMA=$gs KEEP_SERVER=1 bash "${BASH_SOURCE[0]}" || rc=1
  done
  [ "${KEEP_SERVER:-0}" = 1 ] || as_pg pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1
  echo; if [ $rc = 0 ]; then echo "ALL OK (PostGIS in extensions and in public)"; else echo "FAILURES (see above)"; fi
  exit $rc
fi
case "$POSTGIS_SCHEMA" in extensions|public) ;; *) echo "POSTGIS_SCHEMA must be extensions or public"; exit 2;; esac
psqlx() { psql -X -q -h "$PGROOT" -p "$PGPORT" -U "${APPLY_USER:-postgres}" -v ON_ERROR_STOP=1 "$@"; }

FAILED=0
fail() { echo "FAIL: $*"; FAILED=$((FAILED + 1)); }

# ---------------------------------------------------------------- cluster
if [ "$(id -u)" = 0 ] && ! id "$PGUSER_OS" >/dev/null 2>&1; then useradd -m "$PGUSER_OS"; fi
mkdir -p "$PGROOT" "$TMP"
if [ "$(id -u)" = 0 ]; then chown "$PGUSER_OS" "$PGROOT" "$TMP"; chmod 755 "$PGROOT" "$TMP"; fi
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  as_pg initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null || { echo "initdb failed"; exit 2; }
fi
if ! as_pg pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  as_pg pg_ctl -D "$PGDATA" -o "-p $PGPORT -k $PGROOT -c listen_addresses=''" -l "$PGROOT/server.log" start -w >/dev/null || { echo "server start failed"; exit 2; }
fi
stop_server() { [ "${KEEP_SERVER:-0}" = 1 ] || as_pg pg_ctl -D "$PGDATA" stop -m fast >/dev/null 2>&1; }
trap stop_server EXIT

# ---------------------------------------------------------------- helpers
rewrite() { # $1 source file -> stdout (rewritten copy)
  sed -E \
    -e "s/(extensions\\.)?geometry\\([A-Za-z]+, *[0-9]+\\)/$POSTGIS_SCHEMA.geometry/g" \
    -e 's/^( *)create extension postgis with schema extensions;/\1null;/' \
    -e 's/using gist \(([a-z_]+)\)/(\1)/g' \
    -e '/^create extension if not exists (postgis|pg_cron)/d' \
    "$1"
}
apply_file() { # $1 db  $2 file  [$3 = "tx" for single-transaction]
  local db="$1" f="$2" tx="${3:-}"
  local out="$TMP/$(basename "$f").$db.rewritten.sql"
  rewrite "$f" > "$out"
  [ "$(id -u)" = 0 ] && chmod 644 "$out"
  local flags=(); [ "$tx" = tx ] && flags=(-1)
  local au=postgres; [ "$db" = s_e ] && au=sb_owner   # s_e: apply as a NON-superuser owner (like Supabase's postgres role)
  APPLY_USER=$au psqlx -d "$db" "${flags[@]}" -f "$out" > "$TMP/$(basename "$f").$db.log" 2>&1
  local rc=$?
  if [ $rc -ne 0 ]; then fail "apply $(basename "$f") on $db"; sed 's/^/    /' "$TMP/$(basename "$f").$db.log" | tail -8; fi
  return $rc
}
num() { basename "$1" | sed -E 's/^([0-9]+)_.*/\1/' | sed -E 's/^0+//'; }
snapshot() { # $1 db $2 label -> files with schema dump and data digests
  as_pg true
  pg_dump -h "$PGROOT" -p "$PGPORT" -U postgres -s -n public -n cron "$1" 2>/dev/null \
    | grep -v -E '^-- Dumped|^\\(un)?restrict' > "$TMP/$1.$2.schema"
  psqlx -d "$1" -At -c "
    select format('select %L || '': '' || coalesce(md5(string_agg(t::text, ''|'' order by t::text)), ''-'') from %I.%I t;', c.relname, n.nspname, c.relname)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by 1" \
    | psqlx -d "$1" -At > "$TMP/$1.$2.data"
}

# ---------------------------------------------------------------- s_base
echo "== s_base: stand-ins + fsi/sql 001..015 + supabase/migrations"
psqlx -d postgres -c "drop database if exists s_base with (force)" -c "create database s_base" || exit 2
psqlx -d s_base -c "alter database s_base set search_path = \"\$user\", public, extensions"
psqlx -d s_base -f "$HERE/00_bootstrap_supabase.sql" >/dev/null || { echo "bootstrap failed"; exit 2; }
if [ "$POSTGIS_SCHEMA" = public ]; then # production layout: move the PostGIS stand-ins to public
  psqlx -d s_base -f - >/dev/null <<'SQL' || { echo "moving PostGIS stand-ins to public failed"; exit 2; }
alter domain extensions.geometry set schema public;
alter function extensions.st_geomfromgeojson(text) set schema public;
alter function extensions.st_setsrid(geometry, integer) set schema public;
alter function extensions.st_multi(geometry) set schema public;
alter function extensions.st_simplifypreservetopology(geometry, double precision) set schema public;
alter function extensions.st_asgeojson(geometry, integer, integer) set schema public;
alter function extensions.st_makeenvelope(double precision, double precision, double precision, double precision, integer) set schema public;
alter function extensions._sb_bbox(text) set schema public;
alter function extensions._sb_overlaps(text, text) set schema public;
alter operator extensions.&& (text, text) set schema public;
SQL
fi
echo "   (PostGIS stand-ins in schema $POSTGIS_SCHEMA)"
for f in "$SQL"/[0-9]*.sql; do
  n=$(num "$f"); [ "$n" -le 15 ] || continue
  apply_file s_base "$f" || echo "   (baseline file $(basename "$f") failed; later results may be affected)"
done
snapshot s_base pre_mig
for f in "$CRM"/supabase/migrations/*.sql; do apply_file s_base "$f"; done
snapshot s_base post_mig
# parcel_risk is excluded from the data comparison: the migrations embed 002's FIXTURE-* upsert, which
# rewrites those rows (updated_at = now()) on every apply. Known, harmless; reported in docs/handoff/S.md.
cmp -s "$TMP/s_base.pre_mig.schema" "$TMP/s_base.post_mig.schema" \
  && cmp -s <(grep -v '^parcel_risk:' "$TMP/s_base.pre_mig.data") <(grep -v '^parcel_risk:' "$TMP/s_base.post_mig.data") \
  && echo "ok: supabase/migrations re-apply leaves schema unchanged on top of 001..015" \
  || fail "supabase/migrations changed schema or data on top of 001..015 (see $TMP/s_base.*.schema)"

# Remember what existed before 016+ so the generic lint (900_lint.test.sql) only judges new objects.
psqlx -d s_base -c "create table t.baseline_fns as select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'" \
  -c "create table t.baseline_rels as select c.relname::text as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m','S','p')" || exit 2

# ---------------------------------------------------------------- scenarios
for s in a b c d e; do
  psqlx -d postgres -c "drop database if exists s_$s with (force)" -c "create database s_$s template s_base" || exit 2
  psqlx -d "s_$s" -c "alter database s_$s set search_path = \"\$user\", public, extensions"
done
psqlx -d s_b -f "$HERE/fixtures/legacy_leads.sql" -v dups=1 -v parcelcol=1 -v listtype=text[] >/dev/null || fail "legacy fixture (b)"
psqlx -d s_c -f "$HERE/fixtures/legacy_leads.sql" -v dups=0 -v parcelcol=1 -v listtype=jsonb >/dev/null || fail "legacy fixture (c)"
psqlx -d s_e -f "$HERE/fixtures/make_nonsuper_owner.sql" >/dev/null || fail "non-superuser owner fixture (e)"
psqlx -d s_d -f "$HERE/fixtures/legacy_leads.sql" -v dups=0 -v parcelcol=0 -v listtype=jsonb >/dev/null || fail "legacy fixture (d)"

POST=()
for f in "$SQL"/[0-9]*.sql; do n=$(num "$f"); [ "$n" -gt 15 ] && POST+=("$f"); done
echo "== migrations under test: $(for f in "${POST[@]}"; do basename "$f"; done | tr '\n' ' ')"

for s in a b c d e; do
  db="s_$s"
  echo "== $db: apply (single transaction each) x3"
  for f in "${POST[@]}"; do apply_file "$db" "$f" tx; done
  grep -h -E 'NOTICE|WARNING' "$TMP"/01[0-9]_*."$db".log 2>/dev/null | grep -v -E 'already exists, skipping|does not exist, skipping' | sed -E 's/^psql:[^ ]+ //; s/^/   /' | sort -u | head -20
  snapshot "$db" run1
  for pass in 2 3; do
    for f in "${POST[@]}"; do apply_file "$db" "$f" tx; done
    snapshot "$db" "run$pass"
    cmp -s "$TMP/$db.run1.schema" "$TMP/$db.run$pass.schema" || { fail "$db: schema differs after apply #$pass"; diff "$TMP/$db.run1.schema" "$TMP/$db.run$pass.schema" | head -20; }
    cmp -s "$TMP/$db.run1.data" "$TMP/$db.run$pass.data" || { fail "$db: data differs after apply #$pass"; diff "$TMP/$db.run1.data" "$TMP/$db.run$pass.data" | head; }
  done
  echo "   (idempotency checked: schema dump + per-table md5 equal after apply #2 and #3)"
done

# ---------------------------------------------------------------- concurrent legacy_id assignment
for db in s_a s_c; do
  org="null"; [ "$db" = s_c ] && org="(select id from public.organizations limit 1)"
  for w in 1 2 3 4; do
    psqlx -d "$db" -c "insert into public.leads (org_id, name) select $org, 'T-CONC-$w-' || g from generate_series(1, 40) g" >/dev/null 2>"$TMP/conc.$db.$w.err" &
  done
  wait
  r=$(psqlx -d "$db" -Atc "select count(*) || '/' || count(distinct legacy_id) from public.leads where name like 'T-CONC-%'")
  if [ "$r" = "160/160" ]; then echo "ok: $db 4 concurrent sessions x 40 inserts got 160 distinct legacy_ids"; else fail "$db concurrent legacy_id assignment: $r"; cat "$TMP"/conc.$db.*.err | head -3; fi
  psqlx -d "$db" -c "delete from public.leads where name like 'T-CONC-%'" >/dev/null
done

# ---------------------------------------------------------------- JS <-> SQL contract
if command -v node >/dev/null 2>&1; then
  for db in s_a s_c; do
    echo "== $db: contract-check.mjs"
    PGHOST="$PGROOT" PGPORT="$PGPORT" PGUSER=postgres PGDATABASE="$db" node "$HERE/contract-check.mjs" 2>&1 | sed 's/^/   /' > "$TMP/$db.contract.out"
    cat "$TMP/$db.contract.out"
    grep -q -E 'FAIL|Error' "$TMP/$db.contract.out" && fail "$db contract-check.mjs"
  done
else echo "node not found: skipping contract-check.mjs"; fi

# ---------------------------------------------------------------- behaviour tests
for s in a b c d e; do
  db="s_$s"
  for t in "$HERE"/*.test.sql; do
    hdr=$(grep -m1 -E '^-- scenarios:' "$t" | sed 's/^-- scenarios://')
    case " $hdr " in *" $s "*) ;; *) continue;; esac
    echo "== $db: $(basename "$t")"
    psqlx -d "$db" -v migdir="$TMP" -v dbname="$db" -f "$t" 2>&1 | grep -E 'PASS|FAIL|ERROR|^psql:' | sed -E 's/^psql:[^ ]+ //; s/^NOTICE:  //' | sed 's/^/   /' > "$TMP/$db.$(basename "$t").out"
    cat "$TMP/$db.$(basename "$t").out"
    if grep -q -E 'FAIL|ERROR' "$TMP/$db.$(basename "$t").out"; then fail "$db $(basename "$t")"; fi
  done
  p=$(psqlx -d "$db" -Atc "select count(*) filter (where ok), count(*) filter (where not ok) from t.results" 2>/dev/null)
  echo "== $db totals (pass|fail): $p"
done

echo
if [ "$FAILED" = 0 ]; then echo "ALL OK"; exit 0; else echo "$FAILED FAILURE(S)"; exit 1; fi
