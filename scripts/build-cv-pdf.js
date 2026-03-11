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

function key(value) { return String(value || "").trim().toLowerCase(); }

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

function inlineMarkdownToHtml(text) {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((https?:[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const raw = String(markdown || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const chunks = [];
  let list = [];
  const flush = () => {
    if (!list.length) return;
    chunks.push(`<ul>${list.map((x) => `<li>${inlineMarkdownToHtml(x)}</li>`).join("")}</ul>`);
    list = [];
  };
  lines.forEach((line) => {
    const t = line.trim();
    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); return; }
    flush();
    if (t) chunks.push(`<p>${inlineMarkdownToHtml(t)}</p>`);
  });
  flush();
  return chunks.join("\n");
}

function estimateUnits(item, isRail = false) {
  const text = `${item.title || ""} ${item.subtitle || ""} ${item.location || ""} ${item.content || ""}`.trim();
  const chars = text.length;
  const perLine = isRail ? 80 : 120;
  const lines = Math.max(1, Math.ceil(chars / perLine));
  return lines + (item.content ? 0.25 : 0);
}

function splitSkillsBullets(items) {
  const out = [];
  for (const item of items) {
    const lines = String(item?.content || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l));
    if (lines.length < 2) { out.push(item); continue; }
    lines.forEach((line, index) => out.push({ ...item, title: "", subtitle: "", location: "", start: "", end: "", dispdate: "", manualsort: item.manualsort ? `${item.manualsort}.${String(index + 1).padStart(3, "0")}` : "", content: line }));
  }
  return out;
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

function sectionAtoms(title, items, opts = {}) {
  if (!items.length) return [];
  const normalized = key(title);
  const out = [{ type: "section-title", title, units: 0.5 }];
  sortItems(items).forEach((item) => {
    const hideTitle = opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized;
    out.push({ type: "entry", item, hideTitle, units: estimateUnits(item, opts.rail) });
  });
  return out;
}

function workAndTechAtoms(workItems, techItems) {
  const out = [];
  if (workItems.length || techItems.length) out.push({ type: "section-title", title: "Work Experience", units: 0.5 });
  sortItems(workItems).forEach((item) => out.push({ type: "entry", item, hideTitle: false, units: estimateUnits(item, false) }));
  sortItems(techItems).forEach((item) => out.push({ type: "entry", item, hideTitle: false, units: estimateUnits(item, false) }));
  return out;
}

function toAtoms(items) {
  const grouped = groupBySection(items);
  const mainFirst = [];
  const mainLater = [];
  const railSkills = [];
  const railPage2 = [];
  const railLater = [];

  mainFirst.push(...sectionAtoms("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true }));
  mainFirst.push(...workAndTechAtoms(grouped.get("work experience") || [], grouped.get("technical + it") || []));

  railSkills.push(...sectionAtoms("Skills", splitSkillsBullets(grouped.get("topline skills") || []), { rail: true }));
  railPage2.push(...sectionAtoms("Education", grouped.get("education") || [], { rail: true }));

  sortItems(grouped.get("second page rail") || []).forEach((item) => {
    if (!item.title) return;
    railLater.push({ type: "section-title", title: item.title, units: 0.5 });
    railLater.push({ type: "entry", item: { ...item, content: item.content || "" }, hideTitle: true, units: estimateUnits(item, true) });
  });

  grouped.delete("core competencies");
  grouped.delete("work experience");
  grouped.delete("technical + it");
  grouped.delete("topline skills");
  grouped.delete("education");
  grouped.delete("second page rail");

  [...grouped.keys()].sort().forEach((extraKey) => {
    const title = extraKey.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    mainLater.push(...sectionAtoms(title, grouped.get(extraKey) || []));
  });

  return { mainFirst, mainLater, railSkills, railPage2, railLater };
}


function fillPage(atoms, index, budget) {
  const out = [];
  let used = 0;
  let i = index;
  while (i < atoms.length) {
    const next = atoms[i];
    if (used + next.units > budget && out.length) break;
    out.push(next);
    used += next.units;
    i += 1;
  }
  return { nextIndex: i, atoms: out };
}

function paginate(mainFirstAtoms, mainLaterAtoms, railSkillsAtoms, railPage2Atoms, railLaterAtoms) {
  const pages = [];
  let mf = 0;
  let rs = 0;

  const firstMain = fillPage(mainFirstAtoms, mf, 85);
  const firstRail = fillPage(railSkillsAtoms, rs, 55);
  pages.push({ main: firstMain.atoms, rail: firstRail.atoms, first: true });
  mf = firstMain.nextIndex;
  rs = firstRail.nextIndex;

  const mainRemainder = mainFirstAtoms.slice(mf).concat(mainLaterAtoms);
  const railRemainder = railSkillsAtoms.slice(rs).concat(railPage2Atoms, railLaterAtoms);

  let mr = 0;
  let rr = 0;

  if (mr < mainRemainder.length || rr < railRemainder.length) {
    const secondMain = fillPage(mainRemainder, mr, 98);
    const secondRail = fillPage(railRemainder, rr, 72);
    pages.push({ main: secondMain.atoms, rail: secondRail.atoms, first: false });
    mr = secondMain.nextIndex;
    rr = secondRail.nextIndex;
  }

  let guard = 0;
  while (mr < mainRemainder.length || rr < railRemainder.length) {
    const mainSlice = fillPage(mainRemainder, mr, 110);
    const railSlice = fillPage(railRemainder, rr, 92);
    pages.push({ main: mainSlice.atoms, rail: railSlice.atoms, first: false });
    mr = mainSlice.nextIndex;
    rr = railSlice.nextIndex;
    guard += 1;
    if (guard > 20) break;
  }

  return pages.filter((p) => p.main.length || p.rail.length);
}


function renderEntry(atom) {
  const item = atom.item;
  const parts = ["<article class=\"entry\">"];
  if (item.title && !atom.hideTitle) parts.push(`<h4 class=\"entry-title\">${escapeHtml(item.title)}</h4>`);
  const meta = [item.subtitle, item.location].filter(Boolean).map((x) => escapeHtml(x)).join(" • ");
  if (meta) parts.push(`<div class=\"entry-meta\">${meta}</div>`);
  const date = displayDate(item);
  if (date) parts.push(`<div class=\"entry-date\">${escapeHtml(date)}</div>`);
  if (item.content) parts.push(`<div class=\"entry-content\">${markdownToHtml(item.content)}</div>`);
  parts.push("</article>");
  return parts.join("\n");
}

function renderColumn(atoms, cls) {
  const out = [];
  let open = false;
  atoms.forEach((atom) => {
    if (atom.type === "section-title") {
      if (open) out.push("</section>");
      out.push(`<section class=\"section ${cls}\"><h3>${escapeHtml(atom.title)}</h3>`);
      open = true;
      return;
    }
    if (!open) {
      out.push(`<section class=\"section ${cls}\">`);
      open = true;
    }
    out.push(renderEntry(atom));
  });
  if (open) out.push("</section>");
  return out.join("\n");
}

function renderContact(contacts) {
  const entries = contacts.filter((item) => String(item?.content || "").trim() !== "");
  if (!entries.length) return "";
  return `<section class=\"contact-bar\">${entries.map((item) => `<div class=\"contact-item\"><span>${escapeHtml(item.content)}</span></div>`).join("")}</section>`;
}

function renderDocument(cv, cssHref) {
  const items = Array.isArray(cv.items) ? cv.items : [];
  const header = items.find((item) => key(item.section) === "header") || {};
  const contacts = items.filter((item) => key(item.section) === "contact");
  const atoms = toAtoms(items);
  const pages = paginate(atoms.mainFirst, atoms.mainLater, atoms.railSkills, atoms.railPage2, atoms.railLater);

  const pageHtml = pages.map((page, idx) => {
    const headerHtml = idx === 0
      ? `<header class=\"header\"><h1>${escapeHtml(header?.title || "CV")}</h1><h2>${escapeHtml(header?.subtitle || "")}</h2><div class=\"header-summary\">${markdownToHtml(header?.content || "")}</div></header>${renderContact(contacts)}`
      : "";
    const contentHtml = idx === 0
      ? `<section class="content content-first"><aside class="rail-col rail-col-first">${renderColumn(page.rail, "col-rail")}</aside><div class="main-col main-col-first">${renderColumn(page.main, "col-main")}</div></section>`
      : `<section class="content"><aside class="rail-col">${renderColumn(page.rail, "col-rail")}</aside><div class="main-col">${renderColumn(page.main, "col-main")}</div></section>`;
    return `<section class="print-page${idx === 0 ? " first" : ""}">${headerHtml}${contentHtml}</section>`;
  }).join("\n");

  return `<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\" /><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" /><title>CV Print</title><link rel=\"stylesheet\" href=\"${cssHref}\" /></head><body><main class=\"cv-print\" id=\"cv-print-root\">${pageHtml}</main></body></html>`;
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
    const slugs = fs.readdirSync(path.join("data", "cv")).filter((file) => file.endsWith(".json")).map((file) => file.replace(/\.json$/, "")).sort();
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
