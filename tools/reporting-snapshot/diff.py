# -*- coding: utf-8 -*-
"""Сравнение двух снимков расчёта 6.1.3.2.7.

    python tools/reporting-snapshot/diff.py before-mo-directory after-mo-directory

Печатает построчный список изменившихся пар «МО × вид СЭМД», сдвиг процентов
по МО и раскладку причин. Вывод — в UTF-8 файл, а не в консоль: кириллица
в консоли Windows ломается (см. грабли контекста).
"""
import csv
import io
import os
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SNAP = os.path.join(ROOT, "outputs", "snapshots")


def read(label, srez):
    path = os.path.join(SNAP, label, srez + ".csv")
    with io.open(path, encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def diff_pairs(before, after, out):
    # Ключ — OID, а не наименование. 17.08.2026 переименование одной МО
    # (выгрузка РЭМД перезаписала имя) показало «изменилось 72 пары» там, где
    # ни один статус не менялся: 36 строк «пропали» под старым именем и 36
    # «появились» под новым. Снимок нужен, чтобы ловить изменения расчёта, —
    # ложная тревога на 72 строки обесценивает его.
    key = lambda r: (r.get("organization_oid") or r["organization"], r["semd_code"])
    b = {key(r): r for r in before}
    a = {key(r): r for r in after}
    changed = [k for k in sorted(set(b) | set(a))
               if b.get(k, {}).get("requirement_status") != a.get(k, {}).get("requirement_status")]
    out.write("## Пары «МО × вид СЭМД»\n\n")
    out.write("было %d пар, стало %d, изменилось %d\n\n" % (len(b), len(a), len(changed)))
    moves = Counter()
    for k in changed:
        was = b.get(k, {}).get("requirement_status", "—")
        now = a.get(k, {}).get("requirement_status", "—")
        moves[(was, now)] += 1
        row = a.get(k) or b.get(k)
        out.write("  %-28s вид %-6s %-40s %s -> %s\n"
                  % (row["organization"][:28], k[1].replace("nsi_type_", ""),
                     row["semd_name"][:40], was, now))
    if moves:
        out.write("\nсводка переходов:\n")
        for (was, now), n in sorted(moves.items(), key=lambda x: -x[1]):
            out.write("  %-14s -> %-14s %d\n" % (was, now, n))
    diff_organization_names(before, after, out)
    return len(changed)


def diff_organization_names(before, after, out):
    """Переименования МО — отдельным блоком.

    Расчёта они не меняют, но и молчать о них нельзя: имя на карте и в выгрузках
    берётся отсюда, а перезаписать его может импорт.
    """
    def names(rows):
        return {r["organization_oid"]: r["organization"]
                for r in rows if r.get("organization_oid")}

    was, now = names(before), names(after)
    renamed = [(oid, was[oid], now[oid]) for oid in sorted(set(was) & set(now))
               if was[oid] != now[oid]]
    if not renamed:
        return
    out.write("\nпереименования МО (на расчёт не влияют):\n")
    for oid, old_name, new_name in renamed:
        out.write("  %s\n    %s\n    -> %s\n" % (oid, old_name, new_name))


def diff_orgs(before, after, out):
    # Ключ — показатель И организация. По одной организации теперь приходит
    # до шести строк, и ключ из одного OID оставлял в сравнении случайную из них.
    key = lambda r: (r.get("indicator_id", ""), r["organization_oid"])
    b = {key(r): r for r in before}
    a = {key(r): r for r in after}
    out.write("\n\n## Проценты по МО\n\n")
    n = 0
    for item in sorted(set(b) | set(a)):
        rb, ra = b.get(item, {}), a.get(item, {})
        if (rb.get("fact_value"), rb.get("numerator"), rb.get("denominator")) == \
           (ra.get("fact_value"), ra.get("numerator"), ra.get("denominator")):
            continue
        n += 1
        out.write("  %-26s %-28s %s/%s (%s) -> %s/%s (%s)\n" % (
            item[0][:26],
            (ra or rb).get("organization", "")[:28],
            rb.get("numerator", "—"), rb.get("denominator", "—"), rb.get("fact_value", "—"),
            ra.get("numerator", "—"), ra.get("denominator", "—"), ra.get("fact_value", "—")))
    if not n:
        out.write("  без изменений\n")
    return n


def diff_findings(before, after, out):
    cb = Counter(r["finding_code"] for r in before)
    ca = Counter(r["finding_code"] for r in after)
    out.write("\n\n## Причины\n\n")
    out.write("  %-52s %6s %6s %6s\n" % ("код", "было", "стало", "дельта"))
    for code in sorted(set(cb) | set(ca)):
        d = ca[code] - cb[code]
        out.write("  %-52s %6d %6d %+6d\n" % (code, cb[code], ca[code], d))
    out.write("  %-52s %6d %6d %+6d\n" % ("ИТОГО", sum(cb.values()), sum(ca.values()),
                                          sum(ca.values()) - sum(cb.values())))


def main():
    if len(sys.argv) < 3:
        raise SystemExit("укажите две метки снимков: diff.py <до> <после>")
    before_label, after_label = sys.argv[1], sys.argv[2]
    report = os.path.join(SNAP, "diff_%s__%s.md" % (before_label, after_label))
    with io.open(report, "w", encoding="utf-8") as out:
        out.write("# Сверка расчёта: %s -> %s\n\n" % (before_label, after_label))
        changed = diff_pairs(read(before_label, "pairs"), read(after_label, "pairs"), out)
        orgs = diff_orgs(read(before_label, "orgs"), read(after_label, "orgs"), out)
        diff_findings(read(before_label, "findings"), read(after_label, "findings"), out)
    print("пар изменилось: %d, МО с новым процентом: %d" % (changed, orgs))
    print("отчёт: %s" % report)


if __name__ == "__main__":
    main()
