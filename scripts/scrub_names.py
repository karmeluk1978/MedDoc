#!/usr/bin/env python3
"""
Убирает ФИО пациента и родственников из заметок перед сборкой сайта.

Работает по КОПИИ в рабочей папке CI (исходные файлы в git не меняются).
Сами имена в скрипте не хранятся: они определяются из полей
`patient:` (frontmatter) и `**Пациент:**` в заметках.

  python scripts/scrub_names.py scrub content   # заменить имена в content/
  python scripts/scrub_names.py check public    # проверить, что имён нет в собранном сайте

В логах выводятся только числа, без имён (логи публичного репозитория открыты всем).
"""
import json
import os
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

NAME = r"[А-ЯЁ][а-яё]+"
RE_FM_PATIENT = re.compile(rf"^patient:\s*({NAME}(?:\s+{NAME}){{1,2}})", re.M)
RE_FIELD_PATIENT = re.compile(rf"\*\*Пациент:\*\*\s*({NAME}(?:\s+{NAME}){{1,2}})")
RE_TABLE_FIO = re.compile(rf"\|\s*ФИО\s*\|\s*({NAME}(?:\s+{NAME}){{1,2}})\s*\|")

# RUNNER_TEMP может быть путём MSYS (/tmp/...), непонятным обычному Windows-Python:
# тогда берём системную временную папку.
_tmp = os.environ.get("RUNNER_TEMP", "")
if not (_tmp and Path(_tmp).is_dir()):
    _tmp = tempfile.gettempdir()
TOKENS_FILE = Path(_tmp) / "scrub_tokens.json"
TEXT_EXT = {".md", ".json", ".xml", ".html", ".txt", ".yaml", ".yml", ".css", ".js", ".canvas", ".base"}


def read(p: Path):
    # newline="" — не трогаем переводы строк (на Windows иначе LF превратится в CRLF)
    try:
        with open(p, encoding="utf-8", newline="") as f:
            return f.read()
    except (UnicodeDecodeError, OSError):
        return None


def write(p: Path, text: str):
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def collect(root: Path):
    names = Counter()
    for p in root.rglob("*.md"):
        t = read(p)
        if t is None:
            continue
        for rx in (RE_FM_PATIENT, RE_FIELD_PATIENT, RE_TABLE_FIO):
            for m in rx.finditer(t):
                names[" ".join(m.group(1).split())] += 1
    return names


def scrub(root: Path):
    names = collect(root)
    if not names:
        print("scrub: имён не найдено, ничего не меняю")
        return
    surnames = set()
    firsts = Counter()
    full = []
    for n in names:
        parts = n.split()
        surnames.add(parts[0])
        full.append(parts)
    # имя ребёнка — самое частое имя в полях «Пациент»
    for parts, cnt in zip(full, names.values()):
        if len(parts) >= 2:
            firsts[parts[1]] += cnt
    child_first = firsts.most_common(1)[0][0] if firsts else None

    # от длинных к коротким
    full_sorted = sorted(full, key=lambda p: -len(" ".join(p)))
    total = Counter()
    files = 0
    for p in root.rglob("*.md"):
        t = read(p)
        if t is None:
            continue
        o = t
        for parts in full_sorted:
            initials = f"{parts[1][0]}. {parts[0][0]}." if len(parts) >= 2 else "[ФИО скрыто]"
            rx = re.compile(r"\s+".join(map(re.escape, parts)))
            t, n1 = rx.subn(initials, t)
            total["full"] += n1
            if len(parts) >= 2:  # «Фамилия Имя» без отчества
                rx2 = re.compile(rf"{re.escape(parts[0])}\s+{re.escape(parts[1])}\w*")
                t, n2 = rx2.subn(initials, t)
                total["short"] += n2
            if len(parts) == 3:  # «Имя Отчество» без фамилии
                rx3 = re.compile(rf"{re.escape(parts[1])}\s+{re.escape(parts[2])}")
                t, n6 = rx3.subn("[ФИО скрыто]", t)
                total["name_patr"] += n6
        # «Фамилия И.О.» (инициалы родственников)
        for s in surnames:
            rx = re.compile(rf"{re.escape(s)}\w*\s+[А-ЯЁ]\.\s?[А-ЯЁ]\.(?:¹|\d)?")
            t, n3 = rx.subn("[ФИО скрыто]", t)
            total["initials"] += n3
            # «Фамилия Имя Отчество» родственников, которых нет в полях «Пациент»
            rx = re.compile(rf"{re.escape(s)}\w*\s+{NAME}\s+{NAME}(?:ич|на)\b")
            t, n7 = rx.subn("[ФИО скрыто]", t)
            total["relatives"] += n7
            rx = re.compile(rf"{re.escape(s)}\w*")
            t, n4 = rx.subn("[ФИО скрыто]", t)
            total["surname"] += n4
        if child_first:
            rx = re.compile(rf"{re.escape(child_first)}\w*")
            t, n5 = rx.subn(f"{child_first[0]}. К.", t)
            total["first"] += n5
        t = re.sub(r"([А-ЯЁ]\. К\.)\.(?=\s)", r"\1", t)  # «Д. К..» -> «Д. К.»
        if t != o:
            write(p, t)
            files += 1

    tokens = sorted({*surnames, *(x for parts in full for x in parts)})
    write(TOKENS_FILE, json.dumps(tokens, ensure_ascii=False))
    print(f"scrub: изменено файлов: {files}; замен: {dict(total)}")


def check(root: Path):
    if not TOKENS_FILE.exists():
        print("check: нет списка имён (scrub не запускался) — пропуск")
        return 0
    tokens = json.loads(read(TOKENS_FILE))
    rx = re.compile("|".join(re.escape(t) + r"\w*" for t in tokens), re.I)
    bad = 0
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in TEXT_EXT:
            continue
        t = read(p)
        if t and rx.search(t):
            bad += 1
            print(f"check: найдено имя в файле: {p}")
    print(f"check: файлов с именами: {bad}")
    try:
        TOKENS_FILE.unlink()  # список имён нигде не оставляем
    except OSError:
        pass
    return 1 if bad else 0


if __name__ == "__main__":
    mode, target = sys.argv[1], Path(sys.argv[2])
    if mode == "scrub":
        scrub(target)
    elif mode == "check":
        sys.exit(check(target))
    else:
        sys.exit("usage: scrub_names.py scrub|check <dir>")
