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

  function contactIconClass(title) {
    const t = String(title || "").trim().toLowerCase();
    if (t === "email") return "fa-solid fa-envelope";
    if (t === "website") return "fa-solid fa-link";
    if (t === "phone") return "fa-solid fa-phone";
    return "fa-solid fa-circle-info";
  }

  function renderHeader(host, item) {
    host.innerHTML = `
      <h1>${item?.title || "CV"}</h1>
      <h2>${item?.subtitle || ""}</h2>
      <div class="header-summary">${markdownToHtml(item?.content || "")}</div>
    `;
  }

  function renderContact(host, items, withIcons = true) {
    const entries = items.filter((item) => String(item?.content || "").trim() !== "");
    if (!entries.length) {
      host.style.display = "none";
      return;
    }

    host.style.display = "grid";
    host.innerHTML = "";
    entries.forEach((item) => {
      const el = document.createElement("div");
      el.className = "contact-item";
      el.innerHTML = withIcons
        ? `<i class="${contactIconClass(item.title)}" aria-hidden="true"></i><span>${item.content || ""}</span>`
        : `<span>${item.content || ""}</span>`;
      host.appendChild(el);
    });
  }

  function renderEntry(item) {
    const wrap = document.createElement("article");
    wrap.className = "entry";

    if (item.title) {
      const title = document.createElement("h4");
      title.className = "entry-title";
      title.textContent = item.title;
      wrap.appendChild(title);
    }

    if (item.subtitle || item.location) {
      const meta = document.createElement("div");
      meta.className = "entry-meta";
      meta.textContent = [item.subtitle, item.location].filter(Boolean).join(" • ");
      wrap.appendChild(meta);
    }

    if (item.start || item.end || item.dispdate) {
      const date = document.createElement("div");
      date.className = "entry-date";
      date.textContent = displayDate(item);
      wrap.appendChild(date);
    }

    if (item.content) {
      const content = document.createElement("div");
      content.className = "entry-content";
      content.innerHTML = markdownToHtml(item.content);
      wrap.appendChild(content);
    }

    return wrap;
  }

  function renderSection(host, title, items) {
    if (!items.length) return;
    const section = document.createElement("section");
    section.className = "section";
    section.innerHTML = `<h3>${title}</h3>`;
    sortItems(items).forEach((item) => section.appendChild(renderEntry(item)));
    host.appendChild(section);
  }

  function renderSecondRail(host, items) {
    sortItems(items).forEach((item) => {
      if (!item.title) return;
      const section = document.createElement("section");
      section.className = "section";
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

    const mainConfig = [
      { key: "core competencies", title: "Core Competencies" },
      { key: "work experience", title: "Work Experience" },
      { key: "technical + it", title: "Technical + IT" }
    ];

    const railConfig = [
      { key: "topline skills", title: "Skills" },
      { key: "education", title: "Education" },
      { key: "second page rail", title: null }
    ];

    mainConfig.forEach((cfg) => {
      const sectionItems = grouped.get(cfg.key) || [];
      renderSection(mainHost, cfg.title, sectionItems);
      grouped.delete(cfg.key);
    });

    railConfig.forEach((cfg) => {
      const sectionItems = grouped.get(cfg.key) || [];
      if (!sectionItems.length) {
        grouped.delete(cfg.key);
        return;
      }
      if (cfg.key === "second page rail") renderSecondRail(railHost, sectionItems);
      else renderSection(railHost, cfg.title, sectionItems);
      grouped.delete(cfg.key);
    });

    [...grouped.keys()].sort().forEach((extraKey) => {
      renderSection(mainHost, titleCase(extraKey), grouped.get(extraKey));
    });
  }

  function renderStandardCv({ items, headerEl, contactEl, mainEl, railEl }) {
    const header = items.find((item) => key(item.section) === "header") || {};
    const contacts = items.filter((item) => key(item.section) === "contact");
    renderHeader(headerEl, header);
    renderContact(contactEl, contacts, true);
    renderColumns(items, mainEl, railEl);
  }

  global.CvRender = {
    key,
    sortItems,
    renderStandardCv,
    groupBySection,
    renderSection,
    renderSecondRail,
    renderHeader,
    renderContact
  };
})(window);
