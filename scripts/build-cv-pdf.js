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
    const heading = t.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      chunks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      return;
    }
    if (t) chunks.push(`<p>${inlineMarkdownToHtml(t)}</p>`);
  });
  flush();
  return chunks.join("\n");
}

function estimateUnits(item, isRail = false) {
  const text = `${item.title || ""} ${item.subtitle || ""} ${item.location || ""} ${item.content || ""}`.trim();
  const chars = text.length;
  const perLine = isRail ? 52 : 68;
  const lines = Math.max(1, Math.ceil(chars / perLine));
  const base = isRail ? 0.9 : 1.2;
  const contentPenalty = item.content ? (isRail ? 0.8 : 1.1) : 0;
  return base + lines + contentPenalty;
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
  const source = Array.isArray(items) ? items : [];
  source.forEach((item) => {
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
  const out = [];
  if (!opts.hideSectionTitle) out.push({ type: "section-title", title, units: 0.5 });
  sortItems(items).forEach((item) => {
    const hideTitle = opts.hideAllEntryTitles || (opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized);
    out.push({ type: "entry", item, hideTitle, units: estimateUnits(item, opts.rail) });
  });
  return out;
}

function sectionAtomsOrdered(title, items, opts = {}) {
  if (!items.length) return [];
  const normalized = key(title);
  const out = [];
  if (!opts.hideSectionTitle) out.push({ type: "section-title", title, units: 0.5 });
  items.forEach((item) => {
    const hideTitle = opts.hideAllEntryTitles || (opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized);
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
  mainLater.push(...sectionAtoms("CV Footer", grouped.get("footer") || [], { hideSectionTitle: true, hideAllEntryTitles: true }));

  railSkills.push(...sectionAtoms("Skills", grouped.get("topline skills") || [], { rail: true }));
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
  grouped.delete("footer");

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
  const railRemainder = railPage2Atoms.concat(railSkillsAtoms.slice(rs), railLaterAtoms);

  let mr = 0;
  let rr = 0;

  if (mr < mainRemainder.length || rr < railRemainder.length) {
    const secondMain = fillPage(mainRemainder, mr, 98);
    const secondRail = fillPage(railRemainder, rr, 220);
    pages.push({ main: secondMain.atoms, rail: secondRail.atoms, first: false });
    mr = secondMain.nextIndex;
    rr = secondRail.nextIndex;
  }

  let guard = 0;
  while (mr < mainRemainder.length || rr < railRemainder.length) {
    const mainSlice = fillPage(mainRemainder, mr, 110);
    const railSlice = fillPage(railRemainder, rr, 110);
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

function iconClassForContact(text) {
  const v = String(text || "").toLowerCase();
  if (v.includes("@")) return "fa-solid fa-envelope";
  if (v.includes("http") || v.includes("www.")) return "fa-solid fa-globe";
  if (/[+()\d\s-]{7,}/.test(v)) return "fa-solid fa-phone";
  return "fa-solid fa-address-card";
}

function renderContact(contacts) {
  const entries = contacts.filter((item) => String(item?.content || "").trim() !== "");
  if (!entries.length) return "";
  return `<section class=\"contact-bar\">${entries.map((item) => `<div class=\"contact-item\"><i class=\"${iconClassForContact(item.content)}\" aria-hidden=\"true\"></i><span>${escapeHtml(item.content)}</span></div>`).join("")}</section>`;
}

function splitWorkPageOne(workItems, budget) {
  const page1WorkItems = [];
  const page2WorkItems = [];
  let used = 0;
  let overflowStarted = false;
  workItems.forEach((item, idx) => {
    const units = estimateUnits(item, false);
    if (!overflowStarted && (idx === 0 || used + units <= budget)) {
      page1WorkItems.push(item);
      used += units;
    } else {
      overflowStarted = true;
      page2WorkItems.push(item);
    }
  });
  return { page1WorkItems, page2WorkItems, used };
}

function composeFiveBlockLayout(items) {
  const source = Array.isArray(items) ? items : [];
  const grouped = groupBySection(source);

  const coreAtoms = sectionAtoms("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true });
  const workItems = grouped.get("work experience") || [];
  let workPage1Budget = 23;
  let split = splitWorkPageOne(workItems, workPage1Budget);
  const leftover = workPage1Budget - split.used;
  const firstOverflowUnits = split.page2WorkItems.length ? estimateUnits(split.page2WorkItems[0], false) : 0;
  const barelyMissed = split.page2WorkItems.length > 0 && firstOverflowUnits > leftover && (firstOverflowUnits - leftover) <= 1.2;
  if (barelyMissed) {
    workPage1Budget += 1.2;
    split = splitWorkPageOne(workItems, workPage1Budget);
  }
  const compact = barelyMissed;

  if (split.page2WorkItems.length) {
    const promoteUnits = estimateUnits(split.page2WorkItems[0], false);
    const promoteThreshold = compact ? 9.5 : 8.5;
    if (workPage1Budget - split.used + promoteUnits >= promoteThreshold) {
      split.page1WorkItems.push(split.page2WorkItems.shift());
    }
  }

  const mainPage1Atoms = coreAtoms.concat(sectionAtomsOrdered("Work Experience", split.page1WorkItems));
  const mainPage2Atoms = [];
  if (split.page2WorkItems.length) {
    mainPage2Atoms.push(...sectionAtomsOrdered("Work Experience (Cont.)", split.page2WorkItems));
  }

  const footerTechItems = sortItems(grouped.get("technical + it") || []);
  const footerItems = sortItems(grouped.get("footer") || []);

  grouped.delete("core competencies");
  grouped.delete("work experience");
  grouped.delete("technical + it");
  grouped.delete("footer");

  [...grouped.keys()].sort().forEach((extraKey) => {
    if (["topline skills", "education", "second page rail", "footer"].includes(extraKey)) return;
    const title = extraKey.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    mainPage2Atoms.push(...sectionAtoms(title, grouped.get(extraKey) || []));
  });

  const railFirstPageAtoms = [];
  railFirstPageAtoms.push(...sectionAtoms("Skills", grouped.get("topline skills") || [], { rail: true }));

  const railSecondPageAtoms = [];
  railSecondPageAtoms.push(...sectionAtoms("Education", grouped.get("education") || [], { rail: true }));
  sortItems(grouped.get("second page rail") || []).forEach((item) => {
    if (!item.title) return;
    railSecondPageAtoms.push({ type: "section-title", title: item.title, units: 0.5 });
    railSecondPageAtoms.push({ type: "entry", item: { ...item, content: item.content || "" }, hideTitle: true, units: estimateUnits(item, true) });
  });

  return { mainPage1Atoms, mainPage2Atoms, railPage1Atoms: railFirstPageAtoms, railPage2Atoms: railSecondPageAtoms, footerTechItems, footerItems, compact };
}

function renderPdfDocumentHtml(cv, cssHref) {
  const items = Array.isArray(cv.items) ? cv.items : [];
  const header = items.find((item) => key(item.section) === "header") || {};
  const contacts = items.filter((item) => key(item.section) === "contact");
  const blocks = composeFiveBlockLayout(items);

  const headerHtml = `<header class="header"><h1>${escapeHtml(header?.title || "CV")}</h1><h2>${escapeHtml(header?.subtitle || "")}</h2><div class="header-summary">${markdownToHtml(header?.content || "")}</div></header>${renderContact(contacts)}`;

  const fullContainer = `<div class="full-container"><div class="header-container">${headerHtml}</div><div class="rail-page-1">${renderColumn(blocks.railPage1Atoms, "col-rail")}</div><div class="main-content-1">${renderColumn(blocks.mainPage1Atoms, "col-main")}</div><div class="rail-page-2">${renderColumn(blocks.railPage2Atoms, "col-rail")}</div><div class="main-content-2">${renderColumn(blocks.mainPage2Atoms, "col-main")}</div><div class="footer">${renderFooterHtml(blocks.footerTechItems, blocks.footerItems)}</div></div>`;

  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>CV Print</title><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" referrerpolicy="no-referrer" /><link rel="stylesheet" href="${cssHref}" /></head><body><main class="cv-print${blocks.compact ? " compact" : ""}" id="cv-print-root">${fullContainer}</main></body></html>`;
}


function buildPdfForSlug(slug, cssHref) {
  const jsonPath = path.join("data", "cv", `${slug}.json`);
  const outputPath = path.join("dist", `${slug}.pdf`);
  const tmpPath = path.join(".tmp", `cv-print-${slug}.html`);
  const cv = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
  fs.writeFileSync(tmpPath, renderPdfDocumentHtml(cv, cssHref), "utf8");
  // Keep local-file rendering as default so existing layout styling remains stable.
  // For HTTP-mode debugging, set CV_PDF_USE_HTTP=1.
  const useHttpMode = process.env.CV_PDF_USE_HTTP === "1";
  // Keep text selectable/searchable by default; opt into legacy PDF/X if needed.
  const useLegacyPressReady = process.env.CV_PDF_LEGACY_PRESS_READY === "1";
  const cmd = ["vivliostyle", "build", tmpPath, "-o", outputPath];
  if (useHttpMode) {
    cmd.push("--http");
  }
  if (useLegacyPressReady) {
    cmd.push("--press-ready");
  }
  execFileSync("npx", cmd, { stdio: "inherit" });
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
