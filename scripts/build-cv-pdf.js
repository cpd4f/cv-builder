import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";

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
    if (aManual && bManual && aManual !== bManual) {
      return aManual.localeCompare(bManual, undefined, { numeric: true, sensitivity: "base" });
    }
    if (aManual && !bManual) return -1;
    if (!aManual && bManual) return 1;

    const byStart = parseDateValue(b.start) - parseDateValue(a.start);
    if (byStart !== 0) return byStart;
    const byEnd = parseDateValue(b.end) - parseDateValue(a.end);
    if (byEnd !== 0) return byEnd;
    return 0;
  });
}

function formatApDate(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function displayDate(item) {
  if (item.dispdate) return String(item.dispdate);
  const start = formatApDate(item.start);
  const end = formatApDate(item.end);
  if (start && end) return `${start} – ${end}`;
  if (start) return `Since ${start}`;
  return end;
}

function inlineMarkdownToHtml(value) {
  const text = escapeHtml(value);
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const raw = String(markdown || "").trim();
  if (!raw) return "";

  const chunks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    chunks.push(`<ul>${listItems.map((line) => `<li>${inlineMarkdownToHtml(line)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }
    flushList();
    if (!trimmed) return;
    chunks.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  });

  flushList();
  return chunks.join("\n");
}

function renderEntry(item, options = {}) {
  const hideTitle = Boolean(options.hideEntryTitle);
  const parts = ["<article class=\"entry\">"];

  if (item.title && !hideTitle) parts.push(`<h4 class=\"entry-title\">${escapeHtml(item.title)}</h4>`);

  const meta = [item.subtitle, item.location].filter(Boolean).map((value) => escapeHtml(value)).join(" • ");
  if (meta) parts.push(`<div class=\"entry-meta\">${meta}</div>`);

  const date = displayDate(item);
  if (date) parts.push(`<div class=\"entry-date\">${escapeHtml(date)}</div>`);

  if (item.content) parts.push(`<div class=\"entry-content\">${markdownToHtml(item.content)}</div>`);
  parts.push("</article>");
  return parts.join("\n");
}

function renderSection(title, items, options = {}) {
  if (!items.length) return "";
  const normalizedTitle = key(title);

  const entries = sortItems(items)
    .map((item) => {
      const hideEntryTitle =
        options.hideEntryTitleWhenSameAsSection &&
        key(item.title) &&
        key(item.title) === normalizedTitle;
      return renderEntry(item, { hideEntryTitle });
    })
    .join("\n");

  const className = normalizedTitle === "skills" ? "section skills-section" : "section";
  return `<section class=\"${className}\"><h3>${escapeHtml(title)}</h3>${entries}</section>`;
}

function splitSkillsBullets(items) {
  const expanded = [];
  for (const item of items) {
    const lines = String(item?.content || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line));

    if (lines.length < 2) {
      expanded.push(item);
      continue;
    }

    lines.forEach((line, index) => {
      expanded.push({
        ...item,
        title: "",
        subtitle: "",
        location: "",
        start: "",
        end: "",
        dispdate: "",
        manualsort: item.manualsort ? `${item.manualsort}.${String(index + 1).padStart(3, "0")}` : "",
        content: line
      });
    });
  }
  return expanded;
}

function renderPlainRailSections(items) {
  return sortItems(items)
    .filter((item) => item.title)
    .map((item) => `<section class=\"section\"><h3>${escapeHtml(item.title)}</h3><div class=\"entry-content\">${markdownToHtml(item.content || "")}</div></section>`)
    .join("\n");
}

function groupBySection(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const section = key(item.section);
    if (!section || section === "header" || section === "contact") return;
    if (!grouped.has(section)) grouped.set(section, []);
    grouped.get(section).push(item);
  });
  return grouped;
}

function renderContact(contacts) {
  const entries = contacts.filter((item) => String(item?.content || "").trim() !== "");
  if (!entries.length) return "<section class=\"contact-bar\" id=\"contact\" style=\"display:none\"></section>";
  return `<section class=\"contact-bar\" id=\"contact\">${entries
    .map((item) => `<div class=\"contact-item\"><span>${escapeHtml(item.content)}</span></div>`)
    .join("")}</section>`;
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function renderDocument(cv, cssHref) {
  const items = Array.isArray(cv.items) ? cv.items : [];
  const header = items.find((item) => key(item.section) === "header") || {};
  const contacts = items.filter((item) => key(item.section) === "contact");
  const grouped = groupBySection(items);

  const mainOrder = [
    { key: "core competencies", title: "Core Competencies", hideTitle: true },
    { key: "work experience", title: "Work Experience", hideTitle: false },
    { key: "technical + it", title: "Technical + IT", hideTitle: false }
  ];

  const mainSections = mainOrder
    .map((cfg) => {
      const html = renderSection(cfg.title, grouped.get(cfg.key) || [], { hideEntryTitleWhenSameAsSection: cfg.hideTitle });
      grouped.delete(cfg.key);
      return html;
    })
    .join("\n");

  const skillsHtml = renderSection("Skills", splitSkillsBullets(grouped.get("topline skills") || []));
  const educationHtml = renderSection("Education", grouped.get("education") || []);
  const plainRailHtml = renderPlainRailSections(grouped.get("second page rail") || []);

  grouped.delete("topline skills");
  grouped.delete("education");
  grouped.delete("second page rail");

  const extraMainHtml = [...grouped.keys()]
    .sort()
    .map((extraKey) => renderSection(titleCase(extraKey), grouped.get(extraKey) || []))
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CV Print</title>
    <link rel="stylesheet" href="${cssHref}" />
  </head>
  <body>
    <main class="cv-print" id="cv-print-root">
      <header class="header" id="header">
        <h1>${escapeHtml(header?.title || "CV")}</h1>
        <h2>${escapeHtml(header?.subtitle || "")}</h2>
        <div class="header-summary">${markdownToHtml(header?.content || "")}</div>
      </header>
      ${renderContact(contacts)}
      <section class="content">
        <div class="main-col" id="main-col">${mainSections}\n${extraMainHtml}</div>
        <aside class="rail-col" id="rail-col">${skillsHtml}\n${educationHtml}\n${plainRailHtml}</aside>
      </section>
    </main>
  </body>
</html>`;
}

function buildPdfForSlug(slug, cssHref) {
  const jsonPath = path.join("data", "cv", `${slug}.json`);
  const outputPath = path.join("dist", `${slug}.pdf`);
  const tmpPath = path.join(".tmp", `cv-print-${slug}.html`);

  const cv = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, renderDocument(cv, cssHref), "utf8");

  execFileSync("npx", ["vivliostyle", "build", tmpPath, "-o", outputPath], { stdio: "inherit" });
}

function main() {
  fs.mkdirSync("dist", { recursive: true });
  fs.mkdirSync(".tmp", { recursive: true });

  const cssHref = pathToFileURL(path.resolve("cv-print.css")).href;

  try {
    const slugs = fs
      .readdirSync(path.join("data", "cv"))
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.replace(/\.json$/, ""))
      .sort();

    if (!slugs.length) throw new Error("No CV JSON files found in data/cv");

    slugs.forEach((slug) => {
      console.log(`[build-cv-pdf] Building PDF for slug: ${slug}`);
      buildPdfForSlug(slug, cssHref);
    });
  } finally {
    fs.rmSync(".tmp", { recursive: true, force: true });
  }
}

main();
