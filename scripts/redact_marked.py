#!/usr/bin/env python3
"""
Заменяет слова, выделенные в заметках как ==текст==, на [скрыто].

Работает по КОПИИ в рабочей папке CI (исходные файлы в git не меняются).
Выделенный текст нигде не выводится: в логах только числа и пути файлов.

  python scripts/redact_marked.py redact content   # заменить ==...== на [скрыто]

Правила:
  - выделение может занимать несколько строк, но не пересекает пустую строку
    (границу абзаца), чтобы одиночный «==» не скрыл полстраницы;
  - блоки кода (```...```, ~~~...~~~) и `инлайн-код` не трогаем:
    там «==» это оператор сравнения, а не выделение;
  - одиночный «==» без пары вне кода не скрывается, о нём выводится
    предупреждение (::warning::) с путём файла.
"""
import re
import sys
from pathlib import Path

MARK = re.compile(r"==(?!=)((?:(?!\n[ \t]*\n).)+?)(?<!=)==", re.S)
CODE = re.compile(r"```.*?```|~~~.*?~~~|`[^`\n]+`", re.S)
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


def redact_text(t: str):
    """Возвращает (новый текст, число замен, остался ли одиночный '==' вне кода)."""
    out = []
    pos = 0
    count = 0
    stray = False
    for m in list(CODE.finditer(t)) + [None]:
        end = m.start() if m else len(t)
        seg, k = MARK.subn(REPLACEMENT, t[pos:end])
        count += k
        if "==" in seg:
            stray = True
        out.append(seg)
        if m:
            out.append(m.group(0))
            pos = m.end()
    return "".join(out), count, stray


def redact(root: Path) -> int:
    files = 0
    total = 0
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in EXT:
            continue
        t = read(p)
        if t is None:
            continue
        new, n, stray = redact_text(t)
        if n:
            write(p, new)
            files += 1
            total += n
        if stray:
            print(f"::warning::redact: одиночный '==' без пары (не скрыт) в файле: {p}")
    print(f"redact: файлов изменено: {files}; замен: {total}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] != "redact":
        sys.exit("usage: redact_marked.py redact <dir>")
    sys.exit(redact(Path(sys.argv[2])))
