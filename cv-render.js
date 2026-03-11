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
    const perLine = isRail ? 80 : 120;
    const lines = Math.max(1, Math.ceil(chars / perLine));
    return lines + (item.content ? 0.25 : 0);
  }

  function makeEntry(item, hideTitle) {
    return { item, hideTitle, units: estimateUnits(item, false), type: "entry" };
  }

  function sectionEntries(title, items, opts = {}) {
    if (!items.length) return [];
    const normalized = key(title);
    const out = [{ type: "section-title", title, units: 0.5 }];
    sortItems(items).forEach((item) => {
      const hideTitle = opts.hideEntryTitleWhenSameAsSection && key(item.title) && key(item.title) === normalized;
      out.push(makeEntry(item, hideTitle));
    });
    return out;
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

  function toAtoms(items) {
    const grouped = groupBySection(items);
    const main = [];
    const railSkills = [];
    const railLater = [];

    main.push(...sectionEntries("Core Competencies", grouped.get("core competencies") || [], { hideEntryTitleWhenSameAsSection: true }));
    main.push(...sectionEntries("Work Experience", grouped.get("work experience") || []));
    main.push(...sectionEntries("Technical + IT", grouped.get("technical + it") || []));

    railSkills.push(...sectionEntries("Skills", splitSkillsBullets(grouped.get("topline skills") || [])));
    railLater.push(...sectionEntries("Education", grouped.get("education") || []));

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
      main.push(...sectionEntries(title, grouped.get(extraKey) || []));
    });

    return { main, railSkills, railLater };
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

  function paginate(mainAtoms, railSkillsAtoms, railLaterAtoms) {
    const pages = [];
    let m = 0;
    let rs = 0;

    const firstMain = fillPage(mainAtoms, m, 85);
    const firstRailSkills = fillPage(railSkillsAtoms, rs, 55);
    pages.push({ main: firstMain.atoms, rail: firstRailSkills.atoms, first: true });
    m = firstMain.nextIndex;
    rs = firstRailSkills.nextIndex;

    const railRemainder = railSkillsAtoms.slice(rs).concat(railLaterAtoms);
    let rr = 0;

    if (m < mainAtoms.length || rr < railRemainder.length) {
      const secondMain = fillPage(mainAtoms, m, 102);
      const secondRail = fillPage(railRemainder, rr, 86);
      pages.push({ main: secondMain.atoms, rail: secondRail.atoms, first: false });
      m = secondMain.nextIndex;
      rr = secondRail.nextIndex;
    }

    let guard = 0;
    while (m < mainAtoms.length || rr < railRemainder.length) {
      const mainSlice = fillPage(mainAtoms, m, 110);
      const railSlice = fillPage(railRemainder, rr, 96);
      pages.push({ main: mainSlice.atoms, rail: railSlice.atoms, first: false });
      m = mainSlice.nextIndex;
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
        const normalized = key(atom.title);
        const extraClass = normalized === "education" ? " section-education" : "";
        section.className = `section ${cls}${extraClass}`;
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

  function renderContact(host, items) {
    const entries = items.filter((item) => String(item?.content || "").trim() !== "");
    if (!entries.length) { host.style.display = "none"; return; }
    host.style.display = "grid";
    host.innerHTML = entries.map((item) => `<div class="contact-item"><span>${item.content || ""}</span></div>`).join("");
  }

  function renderPaginatedCv(root, cv) {
    const items = Array.isArray(cv?.items) ? cv.items : [];
    const header = items.find((item) => key(item.section) === "header") || {};
    const contacts = items.filter((item) => key(item.section) === "contact");
    const atoms = toAtoms(items);
    const pages = paginate(atoms.main, atoms.railSkills, atoms.railLater);

    root.innerHTML = "";
    pages.forEach((page, idx) => {
      const pageEl = document.createElement("section");
      pageEl.className = `print-page${idx === 0 ? " first" : ""}`;

      if (idx === 0) {
        const headerEl = document.createElement("header");
        headerEl.className = "header";
        renderHeader(headerEl, header);
        pageEl.appendChild(headerEl);

        const contactEl = document.createElement("section");
        contactEl.className = "contact-bar";
        renderContact(contactEl, contacts);
        pageEl.appendChild(contactEl);
      }

      const content = document.createElement("section");
      content.className = `content${idx === 0 ? " content-first" : ""}`;
      const main = document.createElement("div");
      main.className = `main-col${idx === 0 ? " main-col-first" : ""}`;
      const rail = document.createElement("aside");
      rail.className = `rail-col${idx === 0 ? " rail-col-first" : ""}`;
      renderColumnAtoms(main, page.main, "col-main");
      renderColumnAtoms(rail, page.rail, "col-rail");
      content.append(rail, main);
      pageEl.appendChild(content);
      root.appendChild(pageEl);
    });
  }

  global.CvRender = { key, sortItems, renderPaginatedCv };
})(window);
