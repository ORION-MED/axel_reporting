#!/usr/bin/env bash
# Снимок расчёта 6.1.3.2.7 в CSV. Только чтение, стенд не трогает.
#
#   bash tools/reporting-snapshot/snapshot.sh <метка> [код_периода]
#
# Пример: bash tools/reporting-snapshot/snapshot.sh before-mo-directory 2026-07
# Кладёт outputs/snapshots/<метка>/{pairs,orgs,findings}.csv
#
# Правило проекта: расчёт не должен меняться молча. Снимок «до» снимается
# ПЕРЕД правкой, «после» — после пересчёта периода, дальше diff.py.
set -euo pipefail

LABEL="${1:?укажите метку снимка, например before-mo-directory}"
PERIOD="${2:-2026-07}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/outputs/snapshots/$LABEL"
mkdir -p "$OUT"

psql() {
    docker compose --env-file .env.docker exec -T app-db \
        psql -U telemed -d telemed_app --csv -v period_code="$PERIOD" -f - < "$1"
}

cd "$ROOT"
for srez in pairs orgs findings; do
    psql "tools/reporting-snapshot/$srez.sql" > "$OUT/$srez.csv"
    printf '%-10s %6d строк\n' "$srez" "$(($(wc -l < "$OUT/$srez.csv") - 1))"
done

printf 'период %s -> %s\n' "$PERIOD" "$OUT"
