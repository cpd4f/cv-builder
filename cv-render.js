(function initCvRender(global) {
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

  function titleCase(value) {
    return String(value || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
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

  function renderHeader(host, item) {
    host.innerHTML = `
      <h1>${item?.title || "CV"}</h1>
      <h2>${item?.subtitle || ""}</h2>
      <div class="header-summary">${markdownToHtml(item?.content || "")}</div>
    `;
  }

  function renderContact(host, items) {
    const entries = items.filter((item) => String(item?.content || "").trim() !== "");
    if (!entries.length) {
      host.style.display = "none";
      return;
    }

    host.style.display = "grid";
    host.innerHTML = entries
      .map((item) => `<div class="contact-item"><span>${item.content || ""}</span></div>`)
      .join("");
  }

  function renderEntry(item, options = {}) {
    const article = document.createElement("article");
    article.className = "entry";

    const hideTitle = Boolean(options.hideEntryTitle);
    if (item.title && !hideTitle) {
      const title = document.createElement("h4");
      title.className = "entry-title";
      title.textContent = item.title;
      article.appendChild(title);
    }

    if (item.subtitle || item.location) {
      const meta = document.createElement("div");
      meta.className = "entry-meta";
      meta.textContent = [item.subtitle, item.location].filter(Boolean).join(" • ");
      article.appendChild(meta);
    }

    const date = displayDate(item);
    if (date) {
      const dateEl = document.createElement("div");
      dateEl.className = "entry-date";
      dateEl.textContent = date;
      article.appendChild(dateEl);
    }

    if (item.content) {
      const content = document.createElement("div");
      content.className = "entry-content";
      content.innerHTML = markdownToHtml(item.content);
      article.appendChild(content);
    }

    return article;
  }

  function renderSection(host, title, items, options = {}) {
    if (!items.length) return;
    const section = document.createElement("section");
    const normalizedTitle = key(title);
    section.className = normalizedTitle === "skills" ? "section skills-section" : "section";
    if (options.column === "main") section.classList.add("col-main");
    if (options.column === "rail") section.classList.add("col-rail");
    section.innerHTML = `<h3>${title}</h3>`;

    sortItems(items).forEach((item) => {
      const hideEntryTitle =
        options.hideEntryTitleWhenSameAsSection &&
        key(item.title) &&
        key(item.title) === normalizedTitle;
      section.appendChild(renderEntry(item, { hideEntryTitle }));
    });

    host.appendChild(section);
  }

  function renderPlainRailSections(host, items) {
    sortItems(items).forEach((item) => {
      if (!item.title) return;
      const section = document.createElement("section");
      section.className = "section col-rail";
      section.innerHTML = `<h3>${item.title}</h3>`;
      if (item.content) {
        const body = document.createElement("div");
        body.className = "entry-content";
        body.innerHTML = markdownToHtml(item.content);
        section.appendChild(body);
      }
      host.appendChild(section);
    });
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

  function renderColumns(items, mainHost, railHost) {
    const grouped = groupBySection(items);
    mainHost.innerHTML = "";
    railHost.innerHTML = "";

    const mainOrder = [
      { key: "core competencies", title: "Core Competencies", hideTitle: true },
      { key: "work experience", title: "Work Experience", hideTitle: false },
      { key: "technical + it", title: "Technical + IT", hideTitle: false }
    ];

    mainOrder.forEach((cfg) => {
      renderSection(mainHost, cfg.title, grouped.get(cfg.key) || [], {
        hideEntryTitleWhenSameAsSection: cfg.hideTitle,
        column: "main"
      });
      grouped.delete(cfg.key);
    });

    renderSection(railHost, "Skills", splitSkillsBullets(grouped.get("topline skills") || []), { column: "rail" });
    renderSection(railHost, "Education", grouped.get("education") || [], { column: "rail" });
    renderPlainRailSections(railHost, grouped.get("second page rail") || []);

    grouped.delete("topline skills");
    grouped.delete("education");
    grouped.delete("second page rail");

    [...grouped.keys()].sort().forEach((extraKey) => {
      renderSection(mainHost, titleCase(extraKey), grouped.get(extraKey) || [], { column: "main" });
    });
  }

  function renderStandardCv({ items, headerEl, contactEl, mainEl, railEl }) {
    const header = items.find((item) => key(item.section) === "header") || {};
    const contacts = items.filter((item) => key(item.section) === "contact");
    renderHeader(headerEl, header);
    renderContact(contactEl, contacts);
    renderColumns(items, mainEl, railEl);
  }

  global.CvRender = {
    key,
    sortItems,
    renderHeader,
    renderContact,
    renderColumns,
    renderStandardCv
  };
})(window);
