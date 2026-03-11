(function () {
  const scripts = document.querySelectorAll('script[src*="cv-embed.js"]');
  const scriptEl = scripts[scripts.length - 1];
  if (!scriptEl) return;

  const slug = (scriptEl.dataset.cv || "").trim().toLowerCase();
  if (!slug) {
    console.error('[cv-embed] Missing required data-cv attribute on cv-embed.js script tag.');
    return;
  }

  const baseUrl = (scriptEl.dataset.baseUrl || scriptEl.src).replace(/\/cv-embed\.js(?:\?.*)?$/, "").replace(/\/$/, "");
  const height = scriptEl.dataset.height || "1700";
  const targetId = scriptEl.dataset.target || "";

  const frame = document.createElement("iframe");
  frame.src = `${baseUrl}/cv.html?cv=${encodeURIComponent(slug)}`;
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer-when-downgrade";
  frame.style.width = "100%";
  frame.style.height = /^\d+$/.test(height) ? `${height}px` : height;
  frame.style.border = "0";
  frame.style.display = "block";
  frame.setAttribute("title", `CV Embed: ${slug}`);

  const target = targetId ? document.getElementById(targetId) : null;
  if (target) {
    target.appendChild(frame);
    return;
  }

  scriptEl.insertAdjacentElement("afterend", frame);
})();
