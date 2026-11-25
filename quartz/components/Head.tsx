import { i18n } from "../i18n"
import { FullSlug, getFileExtension, joinSegments, pathToRoot } from "../util/path"
import { CSSResourceToStyleElement, JSResourceToScriptElement } from "../util/resources"
import { googleFontHref, googleFontSubsetHref } from "../util/theme"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { unescapeHTML } from "../util/escape"

// Ручка для изменения ширины левой панели (Explorer).
// Ширина хранится в CSS-переменной --sidebar-left-width и запоминается в localStorage.
const sidebarResizeScript = `
  var KEY = "sidebar-left-width"
  var DEFAULT_W = 320
  var MIN_W = 200
  var root = document.documentElement
  function maxW() { return Math.min(700, Math.round(window.innerWidth * 0.6)) }
  function clamp(w) { return Math.max(MIN_W, Math.min(maxW(), w)) }
  function apply(w) { root.style.setProperty("--sidebar-left-width", w + "px") }
  try {
    var saved = parseInt(localStorage.getItem(KEY) || "", 10)
    if (saved) apply(clamp(saved))
  } catch (e) {}

  function mount() {
    var sb = document.querySelector("#quartz-body .sidebar.left")
    if (!sb || sb.querySelector(":scope > .sidebar-resizer")) return
    var h = document.createElement("div")
    h.className = "sidebar-resizer"
    h.title = "Потяните, чтобы изменить ширину (двойной клик — сбросить)"
    sb.appendChild(h)

    var startX = 0
    var startW = 0
    function move(e) { apply(clamp(startW + e.clientX - startX)) }
    function up(e) {
      try { h.releasePointerCapture(e.pointerId) } catch (err) {}
      h.removeEventListener("pointermove", move)
      h.removeEventListener("pointerup", up)
      h.removeEventListener("pointercancel", up)
      document.body.classList.remove("sidebar-resizing")
      try {
        localStorage.setItem(KEY, String(parseInt(root.style.getPropertyValue("--sidebar-left-width"), 10)))
      } catch (err) {}
    }
    h.addEventListener("pointerdown", function (e) {
      e.preventDefault()
      startX = e.clientX
      startW = sb.getBoundingClientRect().width
      h.setPointerCapture(e.pointerId)
      h.addEventListener("pointermove", move)
      h.addEventListener("pointerup", up)
      h.addEventListener("pointercancel", up)
      document.body.classList.add("sidebar-resizing")
    })
    h.addEventListener("dblclick", function () {
      apply(DEFAULT_W)
      try { localStorage.removeItem(KEY) } catch (err) {}
    })
  }

  mount()
  document.addEventListener("nav", mount)
  window.addEventListener("resize", function () {
    var cur = parseInt(root.style.getPropertyValue("--sidebar-left-width"), 10)
    if (cur) apply(clamp(cur))
  })
`

// Поиск: результаты сортируются по дате от новых к старым.
// Дата берётся из начала имени заметки (ГГГГ-ММ-ДД_...). Заметки без даты идут в конце,
// при равных датах сохраняется порядок релевантности.
const searchSortScript = `
  ;(function () {
    if (window.__searchSortInit) return
    window.__searchSortInit = true

    function dateKey(card) {
      var s = card.id || card.getAttribute("href") || ""
      try { s = decodeURIComponent(s) } catch (e) {}
      var seg = s.split("/").pop() || ""
      var m = seg.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})/)
      return m ? parseInt(m[1] + m[2] + m[3], 10) : 0
    }

    var obs

    function sortCards(container) {
      var cards = Array.prototype.slice.call(
        container.querySelectorAll(":scope > .result-card:not(.no-match)")
      )
      if (cards.length < 2) return
      var items = cards.map(function (c, i) { return { c: c, i: i, k: dateKey(c) } })
      items.sort(function (a, b) { return (b.k - a.k) || (a.i - b.i) })
      var changed = items.some(function (x, idx) { return x.c !== cards[idx] })
      if (!changed) return
      obs.disconnect()
      items.forEach(function (x) { container.appendChild(x.c) })
      obs.observe(document.body, { childList: true, subtree: true })
    }

    obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target
        if (t && t.classList && t.classList.contains("results-container")) {
          sortCards(t)
          break
        }
      }
    })
    obs.observe(document.body, { childList: true, subtree: true })
  })()
`

// Широкие таблицы: шапка таблицы закреплена у верха окна, но у таблицы, которая шире колонки
// с контентом, нужна горизонтальная прокрутка. Прокрутка и закрепление к окну несовместимы,
// поэтому такие таблицы помечаются классом table-wide и прокручиваются в собственном окне
// (стили — в custom.scss). Остальные таблицы прокручиваются вместе со страницей.
// Сначала читаем размеры всех таблиц, потом меняем классы — так браузер делает один пересчёт
// раскладки, а не по одному на таблицу; запуски объединяются через requestAnimationFrame.
const tableWideScript = `
  ;(function () {
    var queued = false
    function mark() {
      queued = false
      var boxes = document.querySelectorAll("article .table-container")
      if (!boxes.length) return
      var states = []
      for (var i = 0; i < boxes.length; i++) {
        var table = boxes[i].firstElementChild
        if (!table || table.tagName !== "TABLE") continue
        states.push([boxes[i], table.offsetWidth > boxes[i].clientWidth + 1])
      }
      for (var j = 0; j < states.length; j++) {
        if (states[j][0].classList.contains("table-wide") !== states[j][1]) {
          states[j][0].classList.toggle("table-wide", states[j][1])
        }
      }
    }

    function schedule() {
      if (queued) return
      queued = true
      requestAnimationFrame(mark)
    }

    var timer
    function scheduleResize() {
      clearTimeout(timer)
      timer = setTimeout(schedule, 200)
    }

    schedule()
    document.addEventListener("nav", schedule)
    window.addEventListener("resize", scheduleResize)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule)
  })()
`

// Кнопка «Домой» вместо кнопки режима чтения: стоит в панели инструментов рядом с переключателем
// темы (кнопка режима чтения скрыта в custom.scss). Это такой же <button>, как у переключателя темы,
// поэтому выравнивается с ним одинаково. Адрес главной считается от текущей страницы (data-slug у body),
// поэтому работает на любой глубине и при любом baseUrl. Кнопка добавляется заново после каждого перехода.
const homeButtonScript = `
  ;(function () {
    function rootHref() {
      var slug = document.body.getAttribute("data-slug") || ""
      var depth = slug === "" || slug === "index" ? 0 : slug.split("/").length - 1
      return depth === 0 ? "./" : new Array(depth + 1).join("../")
    }

    function go(btn) {
      var url = new URL(btn.getAttribute("data-href") || "./", window.location.href)
      if (typeof window.spaNavigate === "function") window.spaNavigate(url)
      else window.location.href = url.href
    }

    function mount() {
      var anchor = document.querySelector(".darkmode") || document.querySelector(".readermode")
      if (!anchor || !anchor.parentElement) return
      var href = rootHref()
      var existing = document.querySelector(".home-button")
      if (existing) {
        existing.setAttribute("data-href", href)
        return
      }
      var b = document.createElement("button")
      b.type = "button"
      b.className = "home-button"
      b.setAttribute("data-href", href)
      b.setAttribute("aria-label", "На главную")
      b.setAttribute("title", "На главную")
      b.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>'
      b.addEventListener("click", function () { go(b) })
      anchor.parentElement.insertBefore(b, anchor.nextSibling)
    }

    mount()
    document.addEventListener("nav", mount)
  })()
`

export default (() => {
  const Head: QuartzComponent = ({
    cfg,
    fileData,
    externalResources,
    ctx,
  }: QuartzComponentProps) => {
    const titleSuffix = cfg.pageTitleSuffix ?? ""
    const title =
      (fileData.frontmatter?.title ?? i18n(cfg.locale).propertyDefaults.title) + titleSuffix
    const description =
      fileData.frontmatter?.socialDescription ??
      fileData.frontmatter?.description ??
      unescapeHTML(fileData.description?.trim() ?? i18n(cfg.locale).propertyDefaults.description)

    const { css, js, additionalHead } = externalResources

    const url = new URL(`https://${cfg.baseUrl ?? "example.com"}`)
    const path = url.pathname as FullSlug
    const baseDir = fileData.slug === "404" ? path : pathToRoot(fileData.slug!)
    const iconPath = joinSegments(baseDir, "static/icon.png")

    // Url of current page
    const socialUrl =
      fileData.slug === "404" ? url.toString() : joinSegments(url.toString(), fileData.slug!)

    const usesCustomOgImage = ctx.cfg.plugins.emitters.some((e) => e.name === "CustomOgImages")
    const ogImageDefaultPath = `https://${cfg.baseUrl}/static/og-image.png`

    const coreStylesheet = css[0]?.content
    const coreScript = js.find(
      (r) => r.loadTime === "beforeDOMReady" && r.contentType === "external",
    )

    return (
      <head>
        <title>{title}</title>
        <meta charSet="utf-8" />
        {coreStylesheet && <link rel="preload" href={coreStylesheet} as="style" />}
        {coreScript && coreScript.contentType === "external" && (
          <link rel="preload" href={coreScript.src} as="script" />
        )}
        {cfg.theme.cdnCaching && cfg.theme.fontOrigin === "googleFonts" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" />
            <link rel="stylesheet" href={googleFontHref(cfg.theme)} />
            {cfg.theme.typography.title && (
              <link rel="stylesheet" href={googleFontSubsetHref(cfg.theme, cfg.pageTitle)} />
            )}
          </>
        )}
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />

        <meta name="og:site_name" content={cfg.pageTitle}></meta>
        <meta property="og:title" content={title} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:description" content={description} />
        <meta property="og:image:alt" content={description} />

        {!usesCustomOgImage && (
          <>
            <meta property="og:image" content={ogImageDefaultPath} />
            <meta property="og:image:url" content={ogImageDefaultPath} />
            <meta name="twitter:image" content={ogImageDefaultPath} />
            <meta
              property="og:image:type"
              content={`image/${getFileExtension(ogImageDefaultPath) ?? "png"}`}
            />
          </>
        )}

        {cfg.baseUrl && (
          <>
            <meta property="twitter:domain" content={cfg.baseUrl}></meta>
            <meta property="og:url" content={socialUrl}></meta>
            <meta property="twitter:url" content={socialUrl}></meta>
          </>
        )}

        <link rel="icon" href={iconPath} />
        <meta name="description" content={description} />
        <meta name="generator" content="Quartz" />

        {css.map((resource) => CSSResourceToStyleElement(resource, true))}
        {js
          .filter((resource) => resource.loadTime === "beforeDOMReady")
          .map((res) => JSResourceToScriptElement(res, true))}
        {additionalHead.map((resource) => {
          if (typeof resource === "function") {
            return resource(fileData)
          } else {
            return resource
          }
        })}
      </head>
    )
  }

  Head.afterDOMLoaded =
    sidebarResizeScript + "\n" + searchSortScript + "\n" + tableWideScript + "\n" + homeButtonScript

  return Head
}) satisfies QuartzComponentConstructor
