#!/usr/bin/env python3
"""
Заменяет слова, помеченные в заметках как {!текст!}, на [скрыто].

Работает по КОПИИ в рабочей папке CI (исходные файлы в git не меняются).
Помеченный текст нигде не выводится: в логах только числа и пути файлов.

  python scripts/redact_marked.py content   # заменить {!...!} на [скрыто]

Метка может занимать несколько строк. Если после замены в файле остались
одиночные «{!» или «!}» (забытая закрывающая метка), скрипт завершается с
ошибкой, и сайт не публикуется: иначе текст после незакрытой метки остался бы виден.
"""
import re
import sys
from pathlib import Path

MARK = re.compile(r"\{!.+?!\}", re.S)
LEFTOVER = re.compile(r"\{!|!\}")
REPLACEMENT = "[скрыто]"
EXT = {".md", ".canvas", ".base"}


def read(p: Path):
    # newline="" — не трогаем переводы строк
    try:
        with open(p, encoding="utf-8", newline="") as f:
            return f.read()
    except (UnicodeDecodeError, OSError):
        return None


def write(p: Path, text: str):
    with open(p, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def redact(root: Path) -> int:
    files = 0
    total = 0
    broken = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in EXT:
            continue
        t = read(p)
        if t is None:
            continue
        new, n = MARK.subn(REPLACEMENT, t)
        if n:
            write(p, new)
            files += 1
            total += n
        if LEFTOVER.search(new):
            broken.append(p)
    print(f"redact: файлов изменено: {files}; замен: {total}")
    if broken:
        for p in broken:
            print(f"redact: незакрытая метка в файле: {p}")
        print("redact: исправьте метки, сборка остановлена")
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "redact":
        sys.exit("usage: redact_marked.py redact <dir>")
    sys.exit(redact(Path(sys.argv[2])))
