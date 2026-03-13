(function () {
  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function key(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseDateValue(value) {
    if (!value) return Number.NEGATIVE_INFINITY;
    const timestamp = Date.parse(String(value));
    return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
  }

  function sortItems(items) {
    return [...items].sort((a, b) => {
      const aManual = String(a.manualsort || "").trim();
      const bManual = String(b.manualsort || "").trim();
      if (aManual && bManual && aManual !== bManual) return aManual.localeCompare(bManual, undefined, { numeric: true, sensitivity: "base" });
      if (aManual && !bManual) return -1;
      if (!aManual && bManual) return 1;
      const byStart = parseDateValue(b.start) - parseDateValue(a.start);
      if (byStart !== 0) return byStart;
      return parseDateValue(b.end) - parseDateValue(a.end);
    });
  }



  function inlineMarkdownToHtml(text) {
    const escaped = escapeHtml(text);
    return escaped
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function markdownToHtml(markdown) {
    const raw = String(markdown || "").trim();
    if (!raw) return "";
    const lines = raw.split(/\r?\n/);
    const chunks = [];
    let list = [];
    const flush = function () {
      if (!list.length) return;
      chunks.push("<ul>" + list.map(function (x) { return "<li>" + inlineMarkdownToHtml(x) + "</li>"; }).join("") + "</ul>");
      list = [];
    };

    lines.forEach(function (line) {
      const t = line.trim();
      const bullet = t.match(/^[-*]\s+(.*)$/);
      if (bullet) {
        list.push(bullet[1]);
        return;
      }
      flush();
      if (t) chunks.push("<p>" + inlineMarkdownToHtml(t) + "</p>");
    });
    flush();
    return chunks.join("\n");
  }

  function formatApDate(value) {
    const input = String(value || "").trim();
    if (!input) return "";
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return input;
    const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
    return months[date.getMonth()] + " " + date.getFullYear();
  }

  function displayDate(item) {
    if (item.dispdate) return String(item.dispdate);
    const start = formatApDate(item.start);
    const end = formatApDate(item.end);
    if (start && end) return start + " – " + end;
    if (start) return "Since " + start;
    return end;
  }

  function renderEntry(item) {
    const meta = [item.subtitle, item.location].filter(Boolean).map(escapeHtml).join(" • ");
    const date = displayDate(item);
    const titleHtml = item.title ? '<h4 class="entry-title">' + escapeHtml(item.title) + "</h4>" : "";
    const metaHtml = meta ? '<div class="entry-meta">' + meta + "</div>" : "";
    const dateHtml = date ? '<div class="entry-date">' + escapeHtml(date) + "</div>" : "";
    const contentHtml = item.content ? '<div class="entry-content">' + markdownToHtml(item.content) + "</div>" : "";
    return '<article class="entry">' + titleHtml + metaHtml + dateHtml + contentHtml + "</article>";
  }

  function sectionHtml(title, items, hideEntryTitleWhenSameAsSection) {
    if (!items.length) return "";
    const normalizedTitle = key(title);
    const entries = sortItems(items).map(function (item) {
      if (hideEntryTitleWhenSameAsSection && key(item.title) === normalizedTitle) {
        return renderEntry({ ...item, title: "" });
      }
      return renderEntry(item);
    }).join("\n");
    return '<section class="section"><h3>' + escapeHtml(title) + "</h3>" + entries + "</section>";
  }

  function groupBySection(items) {
    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach(function (item) {
      const section = key(item.section);
      if (!section || section === "header" || section === "contact") return;
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section).push(item);
    });
    return grouped;
  }

  function iconClassForContact(text) {
    const v = String(text || "").toLowerCase();
    if (v.includes("@")) return "fa-solid fa-envelope";
    if (v.includes("http") || v.includes("www.")) return "fa-solid fa-globe";
    if (/[+()\d\s-]{7,}/.test(v)) return "fa-solid fa-phone";
    return "fa-solid fa-address-card";
  }

  const scripts = document.querySelectorAll('script[src*="cv-embed.js"]');
  const scriptEl = scripts[scripts.length - 1];
  if (!scriptEl) return;

  const slug = (scriptEl.dataset.cv || "").trim().toLowerCase();
  if (!slug) {
    console.error('[cv-embed] Missing required data-cv attribute on cv-embed.js script tag.');
    return;
  }

  const baseUrl = (scriptEl.dataset.baseUrl || scriptEl.src).replace(/\/cv-embed\.js(?:\?.*)?$/, "").replace(/\/$/, "");
  const targetId = scriptEl.dataset.target || "";
  const host = targetId ? document.getElementById(targetId) : null;
  const mount = host || document.createElement("div");
  if (!host) scriptEl.insertAdjacentElement("afterend", mount);

  const shadow = mount.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host, .cv-embed-shell, .cv-embed-shell * { box-sizing: border-box; }
      .cv-embed-shell {
        --bg: #ffffff;
        --text: #000000;
        --muted: #3d4248;
        --panel: #2c3237;
        --panel-text: #f7f9fb;
        --rule: #dadde0;
        color: var(--text);
        font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
        line-height: 1.35;
        font-size: 11pt;
        width: 100%;
      }
      .cv-embed-page {
        width: 100%;
        background: #fff;
        border: 1px solid #d8dde3;
        border-radius: 4px;
        overflow: hidden;
      }
      .header { padding: 22mm 16mm 8mm; border-bottom: 1px solid var(--rule); }
      .header h1 { margin: 0; font-size: 28pt; font-weight: 800; letter-spacing: 0.02em; }
      .header h2 { margin: 2mm 0 0; font-size: 14pt; font-weight: 500; }
      .header-summary { margin-top: 5mm; font-size: 11pt; line-height: 1.45; }
      .contact-bar {
        display: grid;
        grid-template-columns: repeat(3, minmax(120px, 1fr));
        background: var(--panel);
        color: var(--panel-text);
        padding: 18px 16mm;
      }
      .contact-item {
        padding: 8px 0;
        font-size: 11pt;
        overflow-wrap: anywhere;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .contact-item i { width: 14px; text-align: center; }
      .contact-item:first-child { padding-right: 16px; }
      .contact-item:last-child { padding-left: 16px; }
      .content {
        display: grid;
        grid-template-columns: 1.55fr 0.75fr;
        gap: 12mm;
        padding: 12mm 16mm 16mm;
      }
      .section { margin-bottom: 22px; }
      .section h3 { margin: 0 0 8px; font-size: 13pt; font-weight: 700; }
      .entry { margin-bottom: 16px; }
      .entry-title { margin: 0; font-size: 12pt; font-weight: 700; }
      .entry-meta { margin: 2px 0 0; font-size: 11.5pt; font-weight: 500; }
      .entry-date { margin-top: 4px; font-size: 10.5pt; color: var(--muted); }
      .entry-content { margin-top: 8px; font-size: 11pt; line-height: 1.45; }
      .entry-content p { margin: 0 0 8px; }
      .entry-content ul, .entry-content ol { margin: 0; padding-left: 0; list-style: none; }
      .entry-content li { margin: 0 0 5px; padding-left: 12px; position: relative; }
      .entry-content li::before { content: "•"; position: absolute; left: 0; }
      .cv-embed-error {
        background: #fceaea;
        border: 1px solid #f0c5c5;
        color: #8b1111;
        border-radius: 8px;
        padding: 12px;
      }
      @media (max-width: 920px) {
        .content { grid-template-columns: 1fr; gap: 6mm; }
        .contact-bar { grid-template-columns: 1fr; }
        .contact-item { padding-left: 0; }
        .contact-item:last-child { padding-left: 0; }
      }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
    <div class="cv-embed-shell">
      <main class="cv-embed-page">
        <header class="header" id="header"></header>
        <section class="contact-bar" id="contact"></section>
        <section class="content">
          <div id="main-col"></div>
          <div id="rail-col"></div>
        </section>
      </main>
    </div>
  `;

  fetch(baseUrl + "/data/cv/" + encodeURIComponent(slug) + ".json", { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("Unable to load CV data for slug \"" + slug + "\" (HTTP " + response.status + ")");
      return response.json();
    })
    .then(function (cv) {
      const items = Array.isArray(cv.items) ? cv.items : [];
      const grouped = groupBySection(items);
      const header = items.find(function (item) { return key(item.section) === "header"; }) || {};
      const contacts = items.filter(function (item) { return key(item.section) === "contact" && String(item.content || "").trim() !== ""; });

      shadow.getElementById("header").innerHTML =
        "<h1>" + escapeHtml(header.title || "CV") + "</h1>" +
        "<h2>" + escapeHtml(header.subtitle || "") + "</h2>" +
        '<div class="header-summary">' + markdownToHtml(header.content || "") + "</div>";

      shadow.getElementById("contact").innerHTML = contacts
        .map(function (item) {
          return '<div class="contact-item"><i class="' + iconClassForContact(item.content) + '" aria-hidden="true"></i><span>' + escapeHtml(item.content) + "</span></div>";
        })
        .join("");

      const mainCol = shadow.getElementById("main-col");
      const railCol = shadow.getElementById("rail-col");

      mainCol.innerHTML =
        sectionHtml("Core Competencies", grouped.get("core competencies") || [], true) +
        sectionHtml("Work Experience", grouped.get("work experience") || [], false) +
        sectionHtml("Technical + IT", grouped.get("technical + it") || [], false) +
        footerHtml(grouped.get("footer") || []);

      railCol.innerHTML =
        sectionHtml("Skills", grouped.get("topline skills") || [], false) +
        sectionHtml("Education", grouped.get("education") || [], false) +
        titledItemsAsSectionsHtml(grouped.get("second page rail") || []);
    })
    .catch(function (error) {
      const page = shadow.querySelector(".cv-embed-page");
      page.innerHTML = '<div class="cv-embed-error">' + escapeHtml(error.message) + "</div>";
    });
})();
