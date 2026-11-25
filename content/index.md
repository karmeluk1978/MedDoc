
# Медицинский архив
	Структурированный архив медицинских документов ребёнка: выписки, консультации, лабораторные и инструментальные исследования.
	Все документы переведены из PDF и DOCX в заметки, названия которых строятся по схеме `ГГГГ-ММ-ДД_Тип-исследования_Учреждение`.
## Теги
```dataviewjs
// Панель тегов из frontmatter всех заметок: столбец на каждую букву (алфавитно), 7 букв в строке
dv.container.classList.add("tag-panel");
const seen = new Map();
for (const p of dv.pages()) {
  let raw = p.file.frontmatter?.tags ?? [];
  if (typeof raw === "string") raw = raw.split(/[,\s]+/);
  for (const t of raw) {
    const tag = String(t ?? "").replace(/^#/, "").trim();
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
}
const byLetter = new Map();
for (const tag of [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))) {
  const letter = tag[0].toUpperCase();
  if (!byLetter.has(letter)) byLetter.set(letter, []);
  byLetter.get(letter).push(`#${tag}`);
}
const letters = [...byLetter.keys()];
for (let i = 0; i < letters.length; i += 7) {
  const chunk = letters.slice(i, i + 7);
  dv.table(chunk, [chunk.map(l => byLetter.get(l).join("<br> "))]);
}
```
## С чего начать






