export const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function icon(name = "globe") {
  const shapes = {
    layers:
      '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
    linkedin:
      '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 10v7m0-10v.1M11 17v-7m0 3c0-4 6-4 6 0v4"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>',
    instagram:
      '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    phone:
      '<path d="M7 3H4a1 1 0 0 0-1 1c0 9 8 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.globe}</svg>`;
}
export const copy = {
  ar: {
    soon: "الرابط قريبًا",
    work: "من شغلي",
    files: "السيرة الذاتية والشهادات",
    cv: "تحميل السيرة الذاتية",
    certificate: "عرض الشهادة",
    language: "English",
    loading: "جاري التحميل…",
    error: "تعذّر تحميل الصفحة",
    retry: "إعادة المحاولة",
  },
  en: {
    soon: "Coming soon",
    work: "Selected work",
    files: "CV & Certificates",
    cv: "Download CV",
    certificate: "View certificate",
    language: "العربية",
    loading: "Loading…",
    error: "Unable to load this page",
    retry: "Try again",
  },
};
function card(x, i, kind, lang) {
  const t = copy[lang],
    project = kind === "projects",
    resource = kind === "resources",
    target = x.file || x.url,
    disabled = !target;
  return `<a class="link-card ${x.featured ? "featured" : ""} ${project ? "project-card" : ""} ${disabled ? "unconfigured" : ""}" data-card-id="${esc(x.id)}" data-card-kind="${kind}" ${disabled ? 'aria-disabled="true"' : `href="${esc(target)}" target="_blank" rel="noopener noreferrer" ${x.file ? "download" : ""}`}>
${project && x.image ? `<img class="project-cover" src="${esc(x.image)}" alt="" loading="lazy">` : ""}
<span class="card-number">${String(i + 1).padStart(2, "0")}</span><span class="card-symbol">${icon(project || resource ? "layers" : x.icon)}</span><div class="card-copy"><h2 dir="auto">${esc(x.title)}</h2><p dir="auto">${esc(x.description)}</p>${resource ? `<p dir="auto">${esc([x.issuer, x.date].filter(Boolean).join(" · "))}</p><span class="file-action">${x.type === "cv" ? t.cv : t.certificate}${x.file?.endsWith(".pdf") ? " · PDF" : ""}</span>` : ""}${disabled ? `<small>${t.soon}</small>` : ""}</div><span class="card-arrow">${icon("arrow")}</span>${x.featured ? '<div class="server-art" aria-hidden="true"><i></i><i></i><i></i><b></b><b></b></div>' : ""}</a>`;
}
export function renderPage(
  container,
  data,
  { preview = false, lang = "ar" } = {},
) {
  const p = data.profile,
    t = copy[lang];
  container.style.setProperty("--accent", p.accent);
  container.dir = lang === "ar" ? "rtl" : "ltr";
  container.lang = lang;
  const group = (kind, title, label) =>
    data[kind]?.some((x) => x.visible)
      ? `<section class="projects"><div class="section-title"><h2>${title}</h2><span>${label}</span></div><div class="projects-grid">${data[
          kind
        ]
          .filter((x) => x.visible)
          .map((x, i) => card(x, i, kind, lang))
          .join("")}</div></section>`
      : "";
  container.innerHTML = `<div class="public-page ${preview ? "in-preview" : ""}"><header class="public-top"><a class="wordmark" href="/" aria-label="Home">FA<span>.</span></a><a class="language-switch" href="/?lang=${lang === "ar" ? "en" : "ar"}" lang="${lang === "ar" ? "en" : "ar"}" ${preview ? 'tabindex="-1"' : ""}>${t.language} ↗</a></header><section class="hero"><div class="system-lines" aria-hidden="true"></div><div class="avatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.name)}">` : "<span>FA</span>"}<i></i></div><p class="eyebrow">DESIGNED TO CONNECT</p><h1>${esc(p.name)}</h1><p class="role" dir="auto">${esc(p.role)}</p><p class="bio" dir="auto">${esc(p.bio)}</p></section><div class="links-grid">${data.links
    .filter((x) => x.visible)
    .map((x, i) => card(x, i, "links", lang))
    .join(
      "",
    )}</div>${group("projects", t.work, "SELECTED WORK")}${group("resources", t.files, "DOCUMENTS & CREDENTIALS")}<footer class="public-footer"><span></span><p dir="auto"><b>&lt;/&gt;</b> ${esc(p.footer)}</p><span></span></footer></div>`;
}
const mount = document.querySelector("#public-page");
if (mount) {
  const lang =
      new URLSearchParams(location.search).get("lang") === "en" ? "en" : "ar",
    t = copy[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  mount.textContent = t.loading;
  fetch("/api/content?lang=" + lang)
    .then((r) => {
      if (!r.ok) throw Error();
      return r.json();
    })
    .then((data) => {
      renderPage(mount, data, { lang });
      document.title = `${data.profile.name} | ${lang === "ar" ? "روابط وأعمال" : "Links & Work"}`;
      document.querySelector('meta[name="description"]').content =
        data.profile.bio;
      const event = (payload) =>
        fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, lang, token: data.trackingToken }),
          keepalive: true,
        }).catch(() => {});
      event({ type: "view" });
      mount.addEventListener("click", (e) => {
        const a = e.target.closest("a[data-card-id][href]");
        if (a)
          event({
            type: "click",
            kind: a.dataset.cardKind,
            id: a.dataset.cardId,
          });
      });
    })
    .catch(() => {
      mount.innerHTML = `<div class="error-state"><h1>${t.error}</h1><button id="retry-load">${t.retry}</button></div>`;
      mount
        .querySelector("#retry-load")
        .addEventListener("click", () => location.reload());
    });
}
