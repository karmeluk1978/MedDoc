#!/usr/bin/env node
/**
 * gen-dataview.mjs
 *
 * Заменяет блоки ```dataview и ```dataviewjs обычными markdown-таблицами,
 * собранными из frontmatter заметок. Нужен для публикации через Quartz:
 * на статическом сайте Dataview не работает.
 *
 * Использование:
 *   node scripts/gen-dataview.mjs [папка=content] [--dry-run] [--strict] [--force]
 *
 *   --dry-run  ничего не записывать, только показать, что было бы заменено
 *   --strict   завершиться с ошибкой, если остался нераспознанный блок
 *   --force    разрешить запуск в папке с .obsidian (ПЕРЕЗАПИШЕТ ваше хранилище!)
 *
 * Файлы правятся на месте, поэтому запускайте скрипт на КОПИИ хранилища
 * (папка content в репозитории Quartz), а не на самом хранилище Obsidian.
 * Нераспознанные блоки остаются как есть, о них выводится предупреждение.
 *
 * Зависимость: пакет `yaml` (уже есть в зависимостях Quartz).
 */
import fs from "node:fs"
import path from "node:path"
import { parse as parseYaml } from "yaml"

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const contentDir = path.resolve(argv.find((a) => !a.startsWith("--")) ?? "content")
const DRY_RUN = flags.has("--dry-run")
const STRICT = flags.has("--strict")

if (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory()) {
  console.error(`Папка не найдена: ${contentDir}`)
  process.exit(1)
}
if (fs.existsSync(path.join(contentDir, ".obsidian")) && !flags.has("--force")) {
  console.error(
    `В ${contentDir} есть папка .obsidian: похоже, это само хранилище, а не копия для сайта.\n` +
      `Скрипт правит файлы на месте и сломает ваши Dataview-запросы. Запустите его на копии (content в репозитории Quartz).`,
  )
  process.exit(1)
}

/* ---------- чтение заметок ---------- */

const SKIP_DIRS = new Set(["private", "templates"]) // как в ignorePatterns Quartz
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function walk(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(p))
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(p)
    }
  }
  return out
}

function normTags(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : []
  return list
    .map((t) =>
      String(t ?? "")
        .replace(/^#/, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
}

const warnings = []
const warn = (msg) => warnings.push(msg)

const notes = walk(contentDir).map((file) => {
  const raw = fs.readFileSync(file, "utf8")
  const rel = path.relative(contentDir, file).split(path.sep).join("/")
  let fm = {}
  const m = raw.replace(/^\uFEFF/, "").match(FM_RE)
  if (m) {
    try {
      const parsed = parseYaml(m[1])
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) fm = parsed
    } catch (e) {
      warn(`${rel}: не удалось разобрать frontmatter (${e.message.split("\n")[0]})`)
    }
  }
  return { file, rel, raw, stem: path.basename(file, path.extname(file)), fm, tags: normTags(fm.tags) }
})

/* ---------- помощники ---------- */

const isEmpty = (x) => x == null || (typeof x === "string" && x.trim() === "") || (Array.isArray(x) && x.length === 0)

function dateKey(fm) {
  const d = fm.date
  if (!d) return null
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}
const fmtDate = (k) => (k ? `${k.slice(8, 10)}.${k.slice(5, 7)}.${k.slice(0, 4)}` : "—")

/** Значение ячейки: пусто → «—», списки через запятую, | экранируется. */
function show(x) {
  if (isEmpty(x)) return "—"
  if (Array.isArray(x)) {
    const s = x.map(show).filter((v) => v !== "—").join(", ")
    return s || "—"
  }
  if (typeof x === "object") {
    const s = Object.entries(x)
      .map(([k, v]) => `${k}: ${show(v)}`)
      .join("; ")
    return s || "—"
  }
  return String(x).trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

/** Вики-ссылка с датой в качестве текста (| экранируется для таблиц). */
function dateLink(n) {
  const k = dateKey(n.fm)
  return k ? `[[${n.stem}\\|${fmtDate(k)}]]` : `[[${n.stem}]]`
}

function table(headers, rows) {
  if (!rows.length) return "_Нет данных._"
  const esc = (h) => h.replace(/\|/g, "\\|")
  return [
    `| ${headers.map(esc).join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n")
}

const byDate = (a, b) => {
  const x = dateKey(a.fm)
  const y = dateKey(b.fm)
  if (x === y) return a.stem.localeCompare(b.stem, "ru")
  if (!x) return 1
  if (!y) return -1
  return x < y ? -1 : 1
}

function pagesFromSource(src) {
  src = src.trim()
  if (src.startsWith("#")) {
    const tag = src.slice(1).toLowerCase()
    return notes.filter((n) => n.tags.some((t) => t === tag || t.startsWith(tag + "/")))
  }
  if (src.startsWith('"')) return notes.slice() // «папка хранилища» = всё содержимое content
  throw new Error(`неподдерживаемый источник: ${src}`)
}

const valuesOf = (n) => (n.fm.values && typeof n.fm.values === "object" ? n.fm.values : {})

/* ---------- dataviewjs ---------- */

function handleDataviewJs(code) {
  if (code.includes("p.antibiogram")) return antibiogram(code)
  if (code.includes("consilium_doctors")) return consilium(code)
  if (code.includes("нейтральный_жир")) return neutralFat(code)
  if (code.includes("dv.luxon") && code.includes("pick(")) return altAstAlp(code)

  const srcM = code.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/)
  if (!srcM) throw new Error("не найден dv.pages(...)")
  let pages = pagesFromSource(srcM[2])
  const typeM = code.match(/\.where\(\s*p\s*=>\s*p\.type\s*==\s*"([^"]+)"\s*\)/)
  const whereCount = (code.match(/\.where\(/g) ?? []).length
  if (whereCount > (typeM ? 1 : 0)) throw new Error("незнакомое условие .where(...)")
  if (typeM) pages = pages.filter((n) => n.fm.type === typeM[1])
  pages.sort(byDate)

  const colsM = code.match(/const cols = \[([\s\S]*?)\];/)
  if (colsM) {
    const cols = [...colsM[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]])
    if (!cols.length) throw new Error("пустой список cols")
    const withAbn = code.includes("p.abnormal")
    const headers = ["Дата", "Учреждение", ...cols.map((c) => c[0]), ...(withAbn ? ["Отклонения"] : [])]
    const rows = pages.map((n) => {
      const v = valuesOf(n)
      return [
        dateLink(n),
        show(n.fm.institution),
        ...cols.map(([, key]) => show(v[key] ?? v[key + "_мкгг"])),
        ...(withAbn ? [show(n.fm.abnormal)] : []),
      ]
    })
    return table(headers, rows)
  }

  if (code.includes("p.category")) {
    // хронология инструментальных исследований
    return table(
      ["Дата", "Учреждение", "Категория", "Отклонения"],
      pages.map((n) => [dateLink(n), show(n.fm.institution), show(n.fm.category), show(n.fm.abnormal)]),
    )
  }
  throw new Error("незнакомая структура запроса")
}

/** Сводная таблица АЛТ/АСТ/ЩФ: возраст, короткие названия лабораторий, жирным значения вне нормы. */
function altAstAlp(code) {
  const srcM = code.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/)
  const dobM = code.match(/fromISO\(\s*"(\d{4})-(\d{2})-(\d{2})"\s*\)/)
  const colsM = code.match(/const cols = \[([\s\S]*?)\];/)
  if (!srcM || !dobM || !colsM) throw new Error("не найдены dv.pages, дата рождения или cols")
  const cols = [...colsM[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]])
  const dob = dobM.slice(1).map(Number)
  const pick = (v, k) => v[k] ?? v[k + "_едл"]

  const age = (key) => {
    const [y2, m2, d2] = key.split("-").map(Number)
    let years = y2 - dob[0]
    let months = m2 - dob[1]
    let days = d2 - dob[2]
    if (days < 0) {
      months--
      const pm = m2 === 1 ? 12 : m2 - 1
      const py = m2 === 1 ? y2 - 1 : y2
      days += new Date(py, pm, 0).getDate()
    }
    if (months < 0) {
      years--
      months += 12
    }
    return years > 0 ? `${years} г ${months} мес` : `${months} мес ${days} дн`
  }
  const inst = (x) => {
    if (isEmpty(x)) return "—"
    const s = String(x)
    if (/Синэво|SYNEVO/i.test(s)) return "SYNEVO"
    if (/Хеликс|HELIX/i.test(s)) return "HELIX"
    if (/РНПЦ/.test(s)) return "РНПЦ ДОГИ"
    if (/3-я/.test(s)) return "3ДКБ"
    const m = s.match(/\(([^)]+)\)/)
    return show(m ? m[1] : s)
  }

  const pages = pagesFromSource(srcM[2])
    .filter((n) => dateKey(n.fm) && cols.some(([, k]) => pick(valuesOf(n), k) != null))
    .sort(byDate)
  const rows = pages.map((n) => {
    const v = valuesOf(n)
    const abn = Array.isArray(n.fm.abnormal) ? n.fm.abnormal.map(String) : []
    const cell = (k) => {
      const x = pick(v, k)
      if (x == null) return "—"
      const s = String(x).replace(".", ",").replace(/\|/g, "\\|")
      return abn.some((a) => a === k || a.startsWith(k + "_")) ? `**${s}**` : s
    }
    return [
      dateLink(n),
      inst(n.fm.institution),
      age(dateKey(n.fm)),
      ...cols.map(([, k]) => cell(k)),
      abn.length ? show(abn.map((a) => a.replaceAll("_", " ")).join(", ")) : "—",
    ]
  })
  return table(["Дата", "Учреждение", "Возраст", ...cols.map((c) => c[0]), "Отклонения"], rows)
}

function consilium(code) {
  const pages = pagesFromSource(code.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/)[2]).sort(byDate)
  return table(
    ["Дата", "Учреждение", "Состав врачей", "Решение по ЖКТ", "Суть"],
    pages.map((n) => [
      dateLink(n),
      show(n.fm.institution),
      show(n.fm.consilium_doctors),
      show(n.fm.gi_decision),
      show(n.fm.summary),
    ]),
  )
}

function neutralFat(code) {
  const pages = pagesFromSource(code.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/)[2]).sort(byDate)
  const norm = (x) => {
    if (isEmpty(x)) return "—"
    const s = String(x).trim()
    if (/^(отсутств|отрицат|не обнаруж)/i.test(s) || s === "-") return "нет"
    return show(s)
  }
  return table(
    ["Дата", "Учреждение", "Нейтр. жир", "Жирные кислоты"],
    pages.map((n) => {
      const v = valuesOf(n)
      return [dateLink(n), show(n.fm.institution), norm(v["нейтральный_жир"]), norm(v["жирные_кислоты"])]
    }),
  )
}

function antibiogram(code) {
  const srcM = code.match(/dv\.pages\(\s*(['"])([\s\S]*?)\1\s*\)/)
  const orderM = code.match(/const order = \[([^\]]*)\]/)
  if (!srcM || !orderM) throw new Error("не найден dv.pages или order")
  const order = [...orderM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
  const legend = { Чувствительный: "S", Устойчивый: "**R**", "Умеренно-устойчивый": "I" }
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x)
  const pages = pagesFromSource(srcM[2])
    .filter((n) => isObj(n.fm.antibiogram))
    .sort(byDate)
  const parts = []
  for (const bact of order) {
    const rows = pages.filter((n) => isObj(n.fm.antibiogram[bact]))
    if (!rows.length) continue
    const abx = [...new Set(rows.flatMap((n) => Object.keys(n.fm.antibiogram[bact])))].sort((a, b) =>
      a.localeCompare(b, "ru"),
    )
    parts.push(
      `#### ${bact}\n\n` +
        table(
          ["Дата", "Учреждение", ...abx],
          rows.map((n) => [
            dateLink(n),
            show(n.fm.institution),
            ...abx.map((a) => legend[n.fm.antibiogram[bact][a]] ?? "—"),
          ]),
        ),
    )
  }
  return parts.join("\n\n") || "_Нет данных._"
}

/* ---------- dataview (DQL) ---------- */

function splitClauses(text) {
  const re = /\b(TABLE|FROM|WHERE|GROUP BY|SORT)\b/gi
  const ms = [...text.matchAll(re)]
  const out = {}
  ms.forEach((m, i) => {
    const key = m[1].toUpperCase().replace(/\s+/g, " ")
    out[key] = text.slice(m.index + m[0].length, ms[i + 1]?.index ?? text.length).trim()
  })
  return out
}

/** Разбивает по запятым верхнего уровня (вне скобок и кавычек). */
function splitTopLevel(s) {
  const out = []
  let depth = 0
  let quote = null
  let cur = ""
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"') quote = ch
    else if (ch === "(") depth++
    else if (ch === ")") depth--
    else if (ch === "," && depth === 0) {
      out.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseSelectItem(item) {
  const m = item.match(/^([\s\S]*?)\s+as\s+(?:"([^"]*)"|([\p{L}\p{N}_]+))\s*$/iu)
  return m ? { expr: m[1].trim(), label: m[2] ?? m[3] } : { expr: item.trim(), label: item.trim() }
}

function whereFn(expr) {
  if (!expr) return () => true
  const preds = expr.split(/\s+AND\s+/i).map((t) => {
    t = t.trim()
    let m = t.match(/^(!?)\s*contains\(\s*file\.path\s*,\s*"([^"]*)"\s*\)$/i)
    if (m) return (n) => n.rel.includes(m[2]) !== (m[1] === "!")
    if (/^[\p{L}\p{N}_]+$/u.test(t)) return (n) => !isEmpty(n.fm[t])
    throw new Error(`не поддерживается WHERE: ${t}`)
  })
  return (n) => preds.every((p) => p(n))
}

function handleDql(code) {
  const text = code.trim()
  if (!/^TABLE\b/i.test(text)) throw new Error("поддерживается только TABLE")
  const c = splitClauses(text)
  if (!c.FROM) throw new Error("нет FROM")
  let pages = pagesFromSource(c.FROM).filter(whereFn(c.WHERE))
  const items = splitTopLevel(c.TABLE ?? "").map(parseSelectItem)

  if (c["GROUP BY"]) {
    const countItem = items.find((i) => /^length\(\s*rows\s*\)$/i.test(i.expr))
    if (!countItem) throw new Error("GROUP BY поддерживается только со счётчиком length(rows)")
    const g = c["GROUP BY"]
    const field = (g.match(/\+\s*([\p{L}_][\p{L}\p{N}_]*)\s*\+/u) ?? g.match(/([\p{L}_][\p{L}\p{N}_]*)/u))?.[1]
    if (!field) throw new Error("не удалось разобрать GROUP BY")
    const wrap = /"`"/.test(g) ? "`" : ""
    const counts = new Map()
    for (const n of pages) {
      const k = String(n.fm[field])
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"))
    if (/DESC/i.test(c.SORT ?? "")) rows.sort((a, b) => b[1] - a[1])
    return table(["Категория", countItem.label], rows.map(([k, v]) => [`${wrap}${k}${wrap}`, String(v)]))
  }

  for (const i of items) {
    if (!/^[\p{L}\p{N}_]+$/u.test(i.expr)) throw new Error(`не поддерживается колонка: ${i.expr}`)
  }
  const sortM = (c.SORT ?? "").match(/^([\p{L}\p{N}_]+)(?:\s+(ASC|DESC))?/iu)
  if (sortM && sortM[1] === "date") {
    pages.sort(byDate)
    if (/DESC/i.test(sortM[2] ?? "")) pages.reverse()
  } else if (sortM) {
    const f = sortM[1]
    pages.sort((a, b) => String(a.fm[f] ?? "").localeCompare(String(b.fm[f] ?? ""), "ru"))
    if (/DESC/i.test(sortM[2] ?? "")) pages.reverse()
  }
  return table(
    ["Файл", ...items.map((i) => i.label)],
    pages.map((n) => [
      `[[${n.stem}]]`,
      ...items.map((i) => (i.expr === "date" ? fmtDate(dateKey(n.fm)) : show(n.fm[i.expr]))),
    ]),
  )
}

/* ---------- замена блоков ---------- */

const FENCE = /(^|\n)(`{3,})(dataviewjs|dataview)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\2[^\S\r\n]*(?=\r?\n|$)/g

let filesChanged = 0
let blocksReplaced = 0
let blocksSkipped = 0

for (const n of notes) {
  if (!n.raw.includes("```dataview")) continue
  let replaced = 0
  const out = n.raw.replace(FENCE, (whole, pre, _ticks, kind, code) => {
    try {
      const md = kind === "dataviewjs" ? handleDataviewJs(code) : handleDql(code)
      replaced++
      return pre + md
    } catch (e) {
      blocksSkipped++
      warn(`${n.rel}: блок ${kind} оставлен без изменений (${e.message})`)
      return whole
    }
  })
  if (replaced > 0) {
    filesChanged++
    blocksReplaced += replaced
    console.log(`${DRY_RUN ? "[dry-run] " : ""}${n.rel}: заменено блоков: ${replaced}`)
    if (!DRY_RUN) fs.writeFileSync(n.file, out, "utf8")
  }
}

for (const w of warnings) console.warn(`⚠ ${w}`)
console.log(
  `Готово. Файлов изменено: ${filesChanged}, блоков заменено: ${blocksReplaced}, не распознано: ${blocksSkipped}.`,
)
if (STRICT && blocksSkipped > 0) process.exit(1)
