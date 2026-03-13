(function initCvRender(global) {
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

  function markdownToHtml(markdown) {
    const raw = String(markdown || "").trim();
    if (!raw) return "";
    if (global.marked) return global.marked.parse(raw, { breaks: true });
    return raw.replace(/\n/g, "<br />");
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

  function estimateUnits(item, isRail = false) {
    const text = `${item.title || ""} ${item.subtitle || ""} ${item.location || ""} ${item.content || ""}`.trim();
    const chars = text.length;
    const perLine = isRail ? 52 : 68;
    const lines = Math.max(1, Math.ceil(chars / perLine));
    const base = isRail ? 0.9 : 1.2;
    const contentPenalty = item.content ? (isRail ? 0.8 : 1.1) : 0;
    return base + lines + contentPenalty;
  }

  function makeEntry(item, hideTitle) {
    return { item, hideTitle, units: estimateUnits(item, false), type: "entry" };
  }

  function sectionEntries(title, items, opts = {}) {
    if (!items.length) return [];
    const normalized = key(title);
    const out = [];
    if (!opts.hideSectionTitle) out.push({ type: "section-title", title, units: 0.5 });
    sortItems(items).forEach((item) => {
      const hideTitle = opts.hideAllEntryTitles || (opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized);
      out.push(makeEntry(item, hideTitle));
    });
    return out;
  }

  function sectionEntriesOrdered(title, items, opts = {}) {
    if (!items.length) return [];
    const normalized = key(title);
    const out = [];
    if (!opts.hideSectionTitle) out.push({ type: "section-title", title, units: 0.5 });
    items.forEach((item) => {
      const hideTitle = opts.hideAllEntryTitles || (opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized);
      out.push(makeEntry(item, hideTitle));
    });
    return out;
  }

  function workAndTechEntries(workItems, techItems) {
    const merged = [];
    if (workItems.length || techItems.length) merged.push({ type: "section-title", title: "Work Experience", units: 0.5 });
    sortItems(workItems).forEach((item) => merged.push(makeEntry(item, false)));
    sortItems(techItems).forEach((item) => merged.push(makeEntry(item, false)));
    return merged;
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

  function toAtoms(items) {
    const grouped = groupBySection(items);
    const mainFirst = [];
    const mainLater = [];
    const railSkills = [];
    const railPage2 = [];
    const railLater = [];

    mainFirst.push(...sectionEntries("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true }));
    mainFirst.push(...workAndTechEntries(grouped.get("work experience") || [], grouped.get("technical + it") || []));

    railSkills.push(...sectionEntries("Skills", splitSkillsBullets(grouped.get("topline skills") || [])));
    railPage2.push(...sectionEntries("Education", grouped.get("education") || []));

    sortItems(grouped.get("second page rail") || []).forEach((item) => {
      if (!item.title) return;
      railLater.push({ type: "section-title", title: item.title, units: 0.5 });
      railLater.push({ type: "entry", item: { ...item, content: item.content || "" }, hideTitle: true, units: estimateUnits(item, true) });
    });

    grouped.delete("core competencies");
    grouped.delete("work experience");
    mainLater.push(...sectionEntries("CV Footer", grouped.get("footer") || [], { hideSectionTitle: true, hideAllEntryTitles: true }));

    grouped.delete("technical + it");
    grouped.delete("topline skills");
    grouped.delete("education");
    grouped.delete("second page rail");
    grouped.delete("footer");

    [...grouped.keys()].sort().forEach((extraKey) => {
      const title = extraKey.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      mainLater.push(...sectionEntries(title, grouped.get(extraKey) || []));
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



  function renderEntryAtom(atom) {
    const { item, hideTitle } = atom;
    const article = document.createElement("article");
    article.className = "entry";
    if (item.title && !hideTitle) {
      const el = document.createElement("h4");
      el.className = "entry-title";
      el.textContent = item.title;
      article.appendChild(el);
    }
    if (item.subtitle || item.location) {
      const meta = document.createElement("div");
      meta.className = "entry-meta";
      meta.textContent = [item.subtitle, item.location].filter(Boolean).join(" • ");
      article.appendChild(meta);
    }
    const dateText = displayDate(item);
    if (dateText) {
      const date = document.createElement("div");
      date.className = "entry-date";
      date.textContent = dateText;
      article.appendChild(date);
    }
    if (item.content) {
      const content = document.createElement("div");
      content.className = "entry-content";
      content.innerHTML = markdownToHtml(item.content);
      article.appendChild(content);
    }
    return article;
  }

  function renderColumnAtoms(host, atoms, cls) {
    host.innerHTML = "";
    let section = null;
    atoms.forEach((atom) => {
      if (atom.type === "section-title") {
        section = document.createElement("section");
        section.className = `section ${cls}`;
        section.innerHTML = `<h3>${atom.title}</h3>`;
        host.appendChild(section);
        return;
      }
      if (!section) {
        section = document.createElement("section");
        section.className = `section ${cls}`;
        host.appendChild(section);
      }
      section.appendChild(renderEntryAtom(atom));
    });
  }

  function renderHeader(host, item) {
    host.innerHTML = `<h1>${item?.title || "CV"}</h1><h2>${item?.subtitle || ""}</h2><div class="header-summary">${markdownToHtml(item?.content || "")}</div>`;
  }

  function iconClassForContact(text) {
    const v = String(text || "").toLowerCase();
    if (v.includes("@")) return "fa-solid fa-envelope";
    if (v.includes("http") || v.includes("www.")) return "fa-solid fa-globe";
    if (/[+()\d\s-]{7,}/.test(v)) return "fa-solid fa-phone";
    return "fa-solid fa-address-card";
  }

  function renderContact(host, items) {
    const entries = items.filter((item) => String(item?.content || "").trim() !== "");
    if (!entries.length) { host.style.display = "none"; return; }
    host.style.display = "grid";
    host.innerHTML = entries.map((item) => `<div class="contact-item"><i class="${iconClassForContact(item.content)}" aria-hidden="true"></i><span>${item.content || ""}</span></div>`).join("");
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

    const coreAtoms = sectionEntries("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true });
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

    const mainPage1Atoms = coreAtoms.concat(sectionEntriesOrdered("Work Experience", split.page1WorkItems));
    const mainPage2Atoms = [];
    if (split.page2WorkItems.length) {
      mainPage2Atoms.push(...sectionEntriesOrdered("Work Experience (Cont.)", split.page2WorkItems));
    }
    mainPage2Atoms.push(...sectionEntries("Technical + IT", grouped.get("technical + it") || []));
    mainPage2Atoms.push(...sectionEntries("CV Footer", grouped.get("footer") || [], { hideSectionTitle: true, hideAllEntryTitles: true }));

    grouped.delete("core competencies");
    grouped.delete("work experience");
    grouped.delete("technical + it");
    grouped.delete("footer");

    [...grouped.keys()].sort().forEach((extraKey) => {
      if (["topline skills", "education", "second page rail", "footer"].includes(extraKey)) return;
      const title = extraKey.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      mainPage2Atoms.push(...sectionEntries(title, grouped.get(extraKey) || []));
    });

    const railPage1Atoms = [];
    railPage1Atoms.push(...sectionEntries("Skills", grouped.get("topline skills") || []));

    const railPage2Atoms = [];
    railPage2Atoms.push(...sectionEntries("Education", grouped.get("education") || []));
    sortItems(grouped.get("second page rail") || []).forEach((item) => {
      if (!item.title) return;
      railPage2Atoms.push({ type: "section-title", title: item.title, units: 0.5 });
      railPage2Atoms.push({ type: "entry", item: { ...item, content: item.content || "" }, hideTitle: true, units: estimateUnits(item, true) });
    });

    return { mainPage1Atoms, mainPage2Atoms, railPage1Atoms, railPage2Atoms, compact };
  }

  function renderStandardCv({ items, headerEl, contactEl, mainEl, railEl }) {
    const source = Array.isArray(items) ? items : [];
    const grouped = groupBySection(source);
    const header = source.find((item) => key(item.section) === "header") || {};
    const contacts = source.filter((item) => key(item.section) === "contact");

    renderHeader(headerEl, header);
    renderContact(contactEl, contacts);

    const mainAtoms = [];
    mainAtoms.push(...sectionEntries("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true }));
    mainAtoms.push(...workAndTechEntries(grouped.get("work experience") || [], grouped.get("technical + it") || []));
    mainAtoms.push(...sectionEntries("CV Footer", grouped.get("footer") || [], { hideSectionTitle: true, hideAllEntryTitles: true }));

    grouped.delete("core competencies");
    grouped.delete("work experience");
    grouped.delete("technical + it");
    grouped.delete("footer");

    [...grouped.keys()].sort().forEach((extraKey) => {
      if (["topline skills", "education", "second page rail", "footer"].includes(extraKey)) return;
      const title = extraKey.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      mainAtoms.push(...sectionEntries(title, grouped.get(extraKey) || []));
    });

    const railAtoms = [];
    railAtoms.push(...sectionEntries("Skills", grouped.get("topline skills") || []));
    railAtoms.push(...sectionEntries("Education", grouped.get("education") || []));
    sortItems(grouped.get("second page rail") || []).forEach((item) => {
      if (!item.title) return;
      railAtoms.push({ type: "section-title", title: item.title, units: 0.5 });
      railAtoms.push({ type: "entry", item: { ...item, content: item.content || "" }, hideTitle: true, units: estimateUnits(item, true) });
    });

    renderColumnAtoms(mainEl, mainAtoms, "col-main");
    renderColumnAtoms(railEl, railAtoms, "col-rail");
  }

  function renderPaginatedCv(root, cv) {
    const items = Array.isArray(cv?.items) ? cv.items : [];
    const header = items.find((item) => key(item.section) === "header") || {};
    const contacts = items.filter((item) => key(item.section) === "contact");
    const blocks = composeFiveBlockLayout(items);

    root.innerHTML = "";
    root.classList.toggle("compact", Boolean(blocks.compact));

    const full = document.createElement("div");
    full.className = "full-container";

    const headerContainer = document.createElement("div");
    headerContainer.className = "header-container";
    const headerEl = document.createElement("header");
    headerEl.className = "header";
    renderHeader(headerEl, header);
    headerContainer.appendChild(headerEl);
    const contactEl = document.createElement("section");
    contactEl.className = "contact-bar";
    renderContact(contactEl, contacts);
    headerContainer.appendChild(contactEl);

    const railPage1 = document.createElement("div");
    railPage1.className = "rail-page-1";
    renderColumnAtoms(railPage1, blocks.railPage1Atoms, "col-rail");

    const mainPage1 = document.createElement("div");
    mainPage1.className = "main-content-1";
    renderColumnAtoms(mainPage1, blocks.mainPage1Atoms, "col-main");

    const railPage2 = document.createElement("div");
    railPage2.className = "rail-page-2";
    renderColumnAtoms(railPage2, blocks.railPage2Atoms, "col-rail");

    const mainPage2 = document.createElement("div");
    mainPage2.className = "main-content-2";
    renderColumnAtoms(mainPage2, blocks.mainPage2Atoms, "col-main");

    full.append(headerContainer, railPage1, mainPage1, railPage2, mainPage2);
    root.appendChild(full);
  }


  global.CvRender = { key, sortItems, renderStandardCv, renderPaginatedCv };
})(window);
