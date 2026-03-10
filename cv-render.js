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

  function renderEntry(item, options = {}) {
    const wrap = document.createElement("article");
    wrap.className = "entry";

    const hideTitle = Boolean(options.hideEntryTitle);

    if (item.title && !hideTitle) {
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

  function renderSection(host, title, items, options = {}) {
    if (!items.length) return;
    const section = document.createElement("section");
    section.className = "section";

    const normalizedTitle = String(title || "").trim().toLowerCase();
    if (normalizedTitle === "skills") section.classList.add("skills-section");
    section.innerHTML = `<h3>${title}</h3>`;
    sortItems(items).forEach((item) => {
      const itemTitle = String(item?.title || "").trim().toLowerCase();
      const hideEntryTitle = options.hideEntryTitleWhenSameAsSection && itemTitle && itemTitle === normalizedTitle;
      section.appendChild(renderEntry(item, { hideEntryTitle }));
    });

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


  function expandSkillsItems(items) {
    const expanded = [];
    for (const item of items) {
      const content = String(item?.content || "");
      const bulletLines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+/.test(line));

      if (bulletLines.length >= 2) {
        bulletLines.forEach((line, index) => {
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
      } else {
        expanded.push(item);
      }
    }
    return expanded;
  }

  function packRailForPagedLayout(root, railHost) {
    if (!root || !railHost) return;

    const page1 = railHost.querySelector(":scope > .rail-page1");
    const overflow = railHost.querySelector(":scope > .rail-overflow");
    if (!page1 || !overflow) return;

    const sections = [...page1.querySelectorAll(":scope > .section")];
    const skillsSection = sections.find((section) => section.querySelector("h3")?.textContent?.trim().toLowerCase() === "skills");
    const educationSection = sections.find((section) => section.querySelector("h3")?.textContent?.trim().toLowerCase() === "education");
    if (!skillsSection) return;

    const overflowSkills = document.createElement("section");
    overflowSkills.className = "section skills-section";
    overflowSkills.innerHTML = "<h3>Skills</h3>";

    const mmProbe = document.createElement("div");
    mmProbe.style.width = "1mm";
    mmProbe.style.position = "absolute";
    mmProbe.style.visibility = "hidden";
    document.body.appendChild(mmProbe);
    const pxPerMm = mmProbe.getBoundingClientRect().width || 3.7795;
    mmProbe.remove();

    const firstPageBottom = root.getBoundingClientRect().top + (297 - 12) * pxPerMm;
    const page1Top = page1.getBoundingClientRect().top;
    const availableHeight = firstPageBottom - page1Top;

    if (availableHeight > 0) {
      while (skillsSection.querySelectorAll(":scope > .entry").length > 1 && page1.getBoundingClientRect().height > availableHeight) {
        const entries = skillsSection.querySelectorAll(":scope > .entry");
        const last = entries[entries.length - 1];
        overflowSkills.appendChild(last);
      }
    }

    if (overflowSkills.querySelector(":scope > .entry")) {
      const movedEntries = [...overflowSkills.querySelectorAll(":scope > .entry")];
      overflowSkills.innerHTML = "<h3>Skills</h3>";
      movedEntries.reverse().forEach((entry) => overflowSkills.appendChild(entry));
      overflow.prepend(overflowSkills);
    }

    if (educationSection) overflow.appendChild(educationSection);

    if (overflow.children.length) overflow.classList.add("rail-page-break");
    else overflow.classList.remove("rail-page-break");
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


    mainConfig.forEach((cfg) => {
      const sectionItems = grouped.get(cfg.key) || [];
      const hideTitle = cfg.key === "core competencies";
      renderSection(mainHost, cfg.title, sectionItems, { hideEntryTitleWhenSameAsSection: hideTitle });
      grouped.delete(cfg.key);
    });

    const railPage1 = document.createElement("div");
    railPage1.className = "rail-page1";
    const railOverflow = document.createElement("div");
    railOverflow.className = "rail-overflow";
    railHost.appendChild(railPage1);
    railHost.appendChild(railOverflow);

    const skillsItems = grouped.get("topline skills") || [];
    const educationItems = grouped.get("education") || [];
    const secondRailItems = grouped.get("second page rail") || [];
    renderSection(railPage1, "Skills", expandSkillsItems(skillsItems), { hideEntryTitleWhenSameAsSection: false });
    renderSection(railPage1, "Education", educationItems, { hideEntryTitleWhenSameAsSection: false });
    renderSecondRail(railOverflow, secondRailItems);

    grouped.delete("topline skills");
    grouped.delete("education");
    grouped.delete("second page rail");

    [...grouped.keys()].sort().forEach((extraKey) => {
      renderSection(mainHost, titleCase(extraKey), grouped.get(extraKey), { hideEntryTitleWhenSameAsSection: false });
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
    packRailForPagedLayout,
    renderColumns,
    renderSection,
    renderSecondRail,
    renderHeader,
    renderContact
  };
})(window);
