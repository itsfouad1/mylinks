import { renderPage, esc, icon } from "./app.js";
let drafts,
  language = "ar",
  statsRange = 30;
let draft,
  published,
  revision,
  csrf,
  dirty = false,
  section = "content",
  busy = false;
const root = document.querySelector("#admin-root"),
  dialog = document.querySelector("#editor-dialog");
let timer;
function toast(text, error = false) {
  const t = document.querySelector("#toast");
  t.textContent = text;
  t.className = "show " + (error ? "bad" : "");
  clearTimeout(timer);
  timer = setTimeout(() => (t.className = ""), 5000);
}
async function api(path, method = "GET", data) {
  const response = await fetch("/api/" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "login") {
      dirty = false;
      dialog.close();
      login();
    }
    throw Error(result.error || "تعذّر إتمام الطلب.");
  }
  return result;
}
function login() {
  root.innerHTML = `<main class="login-layout"><section class="login-intro"><a class="wordmark" href="/">FA<span>.</span></a><p class="eyebrow">YOUR SPACE. YOUR SIGNAL.</p><h1>كل روابطك.<br><em>بصمتك أنت.</em></h1><p>مساحة صغيرة، تحكي عن كل اللي بتبنيه.</p><div class="login-art">${icon("layers")}</div></section><form class="login-panel"><span class="eyebrow">FOUAD / ADMIN</span><h2>أهلًا برجعتك</h2><p>سجّل دخولك لإدارة صفحتك.</p><label>كلمة المرور<input type="password" name="password" autocomplete="current-password" required maxlength="256" autofocus></label><button class="primary" type="submit">الدخول إلى لوحتي ${icon("arrow")}</button><p class="form-error" role="alert"></p><a href="/" class="text-link">العودة للصفحة العامة ↗</a></form></main>`;
  root.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button");
    b.disabled = true;
    try {
      await api("login", "POST", {
        password: new FormData(e.target).get("password"),
      });
      await load();
    } catch (err) {
      e.target.querySelector(".form-error").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  });
}
async function load() {
  try {
    const data = await api("admin");
    drafts = data.draft;
    draft = drafts.locales[language];
    published = data.published;
    revision = data.revision;
    csrf = data.csrf;
    dirty = false;
    render();
  } catch (e) {
    login();
  }
}
function mark() {
  dirty = true;
  refreshPreview();
  const status = document.querySelector("#save-status");
  if (status) status.textContent = "تغييرات غير محفوظة";
}
function refreshPreview() {
  const target = document.querySelector("#live-preview");
  if (target) renderPage(target, draft, { preview: true, lang: language });
}
function row(x, i, kind) {
  return `<article class="edit-row" draggable="true" data-id="${esc(x.id)}" data-kind="${kind}"><span class="drag-grip" title="اسحب لتغيير الترتيب" aria-hidden="true">⠿</span><span class="row-icon">${icon(kind === "projects" ? "layers" : x.icon)}</span><div class="row-copy"><strong dir="auto">${esc(x.title)}</strong><small>${x.file || x.url ? esc(x.description || x.file || x.url) : "أضف رابطًا أو ملفًا لتفعيل البطاقة"}</small></div><div class="row-actions"><button class="toggle ${x.visible ? "on" : ""}" aria-label="${x.visible ? "إخفاء" : "إظهار"} ${esc(x.title)}" aria-pressed="${x.visible}" data-action="toggle" data-kind="${kind}" data-id="${esc(x.id)}"><span></span></button><button class="icon-button" aria-label="تعديل ${esc(x.title)}" data-action="edit" data-kind="${kind}" data-id="${esc(x.id)}">✎</button><button class="icon-button small" aria-label="تحريك لأعلى" ${i === 0 ? "disabled" : ""} data-action="up" data-kind="${kind}" data-id="${esc(x.id)}">↑</button><button class="icon-button small" aria-label="تحريك لأسفل" ${i === draft[kind].length - 1 ? "disabled" : ""} data-action="down" data-kind="${kind}" data-id="${esc(x.id)}">↓</button></div></article>`;
}
function field(label, name, value, type = "text", max = 100) {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" maxlength="${max}"></label>`;
}
function profileForm() {
  const p = draft.profile;
  return `<form id="profile-form" class="settings-panel"><div class="panel-heading"><span class="eyebrow">01 / IDENTITY</span><h2>الملف الشخصي</h2><p>عرّف عن نفسك بكلماتك.</p></div><div class="avatar-setting"><div class="avatar small-avatar">${p.avatar ? `<img src="${esc(p.avatar)}" alt="صورتك">` : "FA"}</div><label class="upload-button">رفع صورة<input id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></label><button type="button" class="subtle" id="remove-avatar">إزالة الصورة</button></div>${field("الاسم", "name", p.name, "text", 80)}${field("المسمّى المهني", "role", p.role)}<label>نبذة عنك<textarea name="bio" maxlength="400" rows="4">${esc(p.bio)}</textarea></label><p class="hint">يُفضّل صورة مربعة. PNG أو JPEG أو WebP حتى 2MB.</p><button class="primary" type="submit">تطبيق على المسودة</button></form>`;
}
function appearance() {
  return `<form id="appearance-form" class="settings-panel"><div class="panel-heading"><span class="eyebrow">02 / PERSONALITY</span><h2>المظهر</h2><p>لمسة بسيطة، وهوية واضحة.</p></div><label>اللون المميز<input type="color" name="accent" value="${esc(draft.profile.accent)}"></label><p class="hint">اختَر لونًا فاتحًا ليظهر بوضوح على الخلفية الداكنة.</p><div class="color-presets">${["#b7ff4a", "#64e4cf", "#8cb4ff", "#ffc570", "#edb3ff"].map((c) => `<button type="button" data-color="${c}" style="background:${c}" aria-label="اختيار اللون ${c}"></button>`).join("")}</div>${field("توقيع أسفل الصفحة", "footer", draft.profile.footer, "text", 80)}<button class="primary">تطبيق على المسودة</button></form>`;
}
function render() {
  root.innerHTML = `<div class="dashboard"><aside class="sidebar"><a class="side-brand" href="/" target="_blank"><b>FA</b><span>Fouad Links<small>مساحتك الشخصية</small></span></a><p class="nav-label">إدارة الصفحة</p><nav>${[
    ["content", "layers", "محتوى الصفحة"],
    ["profile", "code", "الملف الشخصي"],
    ["appearance", "globe", "المظهر"],
    ["analytics", "layers", "الإحصائيات"],
  ]
    .map(
      ([id, ic, title]) =>
        `<button data-tab="${id}" class="${section === id ? "active" : ""}">${icon(ic)}${title}</button>`,
    )
    .join(
      "",
    )}</nav><div class="sidebar-bottom"><a href="/" target="_blank">عرض صفحتي ↗</a><button id="logout">تسجيل الخروج</button></div></aside><main class="workspace"><header class="workspace-header"><div><p class="eyebrow">MY DIGITAL SPACE</p><h1>${section === "content" ? "محتوى الصفحة" : section === "profile" ? "الملف الشخصي" : section === "analytics" ? "الإحصائيات" : "المظهر"}</h1><p>روابطك ومشاريعك، من مكان واحد.</p></div><div class="publish-actions"><button class="primary" id="publish">نشر التغييرات ↗</button><button id="save" class="secondary">حفظ المسودة</button><span id="save-status">${dirty ? "تغييرات غير محفوظة" : JSON.stringify(drafts) === JSON.stringify(published) ? "الصفحة محدّثة ✓" : "مسودة محفوظة — لم تُنشر بعد"}</span></div></header><div class="language-editor"><label>لغة المحتوى الذي تعدّله<select id="content-language"><option value="ar" ${language === "ar" ? "selected" : ""}>العربية — Arabic</option><option value="en" ${language === "en" ? "selected" : ""}>English — الإنجليزية</option></select></label><p>لكل لغة اسم ونبذة وبطاقات وملفات مستقلة. الحفظ والنشر يشملان اللغتين.</p></div><div class="editor-layout ${section === "analytics" ? "stats-layout" : ""}"><section class="editor-content">${section === "content" ? `<div class="profile-strip"><div class="avatar mini">${draft.profile.avatar ? `<img src="${esc(draft.profile.avatar)}" alt="">` : "FA"}</div><div><h2>${esc(draft.profile.name)}</h2><p>${esc(draft.profile.role)}</p></div><button class="subtle" data-tab="profile">تعديل الملف ✎</button></div><section class="list-section"><div class="section-heading"><div><span class="eyebrow">01 / CONNECTIONS</span><h2>الروابط والبطاقات</h2></div><button class="outline" data-add="links">${icon("plus")} إضافة بطاقة</button></div><div class="rows">${draft.links.map((x, i) => row(x, i, "links")).join("") || '<p class="empty">ابدأ بإضافة أول رابط إلك.</p>'}</div><p class="hint">اسحب لترتيب البطاقات، أو استخدم أسهم الترتيب.</p></section><section class="list-section"><div class="section-heading"><div><span class="eyebrow">02 / SELECTED WORK</span><h2>مشاريع مختارة</h2></div><button class="outline" data-add="projects">${icon("plus")} إضافة مشروع</button></div><div class="rows">${draft.projects.map((x, i) => row(x, i, "projects")).join("") || '<p class="empty">أضف مشروعًا تفتخر فيه.</p>'}</div></section><section class="list-section"><div class="section-heading"><div><span class="eyebrow">03 / DOCUMENTS</span><h2>الـCV والشهادات</h2></div><button class="outline" data-add="resources">${icon("plus")} إضافة ملف</button></div><div class="rows">${draft.resources.map((x, i) => row(x, i, "resources")).join("") || '<p class="empty">أضف سيرتك الذاتية أو شهادة، كملف أو رابط.</p>'}</div></section><div class="editor-note">التعديل والحفظ يحدّثان المسودة فقط. اضغط «نشر التغييرات» ليظهر المحتوى للزوار.</div>` : section === "profile" ? profileForm() : section === "analytics" ? '<div id="analytics-panel" class="settings-panel">جاري تحميل الإحصائيات…</div>' : appearance()}</section><aside class="preview-panel"><div class="preview-heading"><strong>معاينة مباشرة</strong><span class="live-dot"></span></div><p>هكذا ستظهر صفحتك للزوار</p><div class="preview-phone"><div id="live-preview"></div></div></aside></div></main></div>`;
  refreshPreview();
  bind();
  if (section === "analytics") loadStats();
}
async function save() {
  const r = await api("admin/draft", "PUT", { content: drafts, revision });
  revision = r.revision;
  dirty = false;
}
async function action(task) {
  if (busy) return;
  busy = true;
  document
    .querySelectorAll("#publish,#save")
    .forEach((b) => (b.disabled = true));
  try {
    await task();
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
    document
      .querySelectorAll("#publish,#save")
      .forEach((b) => (b.disabled = false));
  }
}
function move(kind, id, offset) {
  const list = draft[kind],
    i = list.findIndex((x) => x.id === id),
    to = i + offset;
  if (i < 0 || to < 0 || to >= list.length) return;
  [list[i], list[to]] = [list[to], list[i]];
  mark();
  render();
}
function bind() {
  root.querySelector("#content-language").onchange = (e) => {
    language = e.target.value;
    draft = drafts.locales[language];
    render();
  };
  root.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        section = b.dataset.tab;
        render();
      }),
  );
  root.querySelector("#save").onclick = () =>
    action(async () => {
      await save();
      render();
      toast("تم حفظ المسودة.");
    });
  root.querySelector("#publish").onclick = () =>
    action(async () => {
      await save();
      const r = await api("admin/publish", "POST", { revision });
      revision = r.revision;
      published = structuredClone(drafts);
      render();
      toast("تم النشر! التغييرات ظاهرة الآن على صفحتك.");
    });
  root.querySelector("#logout").onclick = () =>
    action(async () => {
      if (dirty && !confirm("عندك تعديلات غير محفوظة. الخروج بدون حفظ؟"))
        return;
      await api("admin/logout", "POST", {});
      dirty = false;
      csrf = null;
      login();
    });
  root
    .querySelectorAll("[data-add]")
    .forEach((b) => (b.onclick = () => edit(b.dataset.add)));
  root.querySelectorAll("[data-action]").forEach(
    (b) =>
      (b.onclick = () => {
        const { action, kind, id } = b.dataset;
        if (action === "edit") edit(kind, id);
        if (action === "toggle") {
          const x = draft[kind].find((x) => x.id === id);
          x.visible = !x.visible;
          mark();
          render();
        }
        if (action === "up" || action === "down")
          move(kind, id, action === "up" ? -1 : 1);
      }),
  );
  let dragging;
  root.querySelectorAll(".edit-row").forEach((row) => {
    row.ondragstart = (e) => {
      dragging = { id: row.dataset.id, kind: row.dataset.kind };
      e.dataTransfer.setData("text/plain", dragging.id);
      row.classList.add("dragging");
    };
    row.ondragend = () => {
      dragging = null;
      row.classList.remove("dragging");
    };
    row.ondragover = (e) => {
      if (dragging?.kind === row.dataset.kind) e.preventDefault();
    };
    row.ondrop = (e) => {
      e.preventDefault();
      if (!dragging || dragging.kind !== row.dataset.kind) return;
      const list = draft[dragging.kind],
        from = list.findIndex((x) => x.id === dragging.id),
        to = list.findIndex((x) => x.id === row.dataset.id);
      list.splice(to, 0, list.splice(from, 1)[0]);
      mark();
      render();
    };
  });
  const form = root.querySelector("#profile-form");
  if (form) {
    form.addEventListener("input", (e) => {
      if (["name", "role", "bio"].includes(e.target.name)) {
        draft.profile[e.target.name] = e.target.value;
        mark();
      }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      for (const key of ["name", "role", "bio"])
        draft.profile[key] = fd.get(key).trim();
      mark();
      toast("تم التطبيق على المسودة. احفظ أو انشر عند الانتهاء.");
    };
    form.querySelector("#avatar-file").onchange = (e) =>
      action(async () => {
        const url = await upload(e.target.files[0]);
        if (url) {
          draft.profile.avatar = url;
          mark();
          render();
        }
      });
    form.querySelector("#remove-avatar").onclick = () => {
      draft.profile.avatar = "";
      mark();
      render();
    };
  }
  const appearanceForm = root.querySelector("#appearance-form");
  if (appearanceForm) {
    appearanceForm.addEventListener("input", (e) => {
      if (["accent", "footer"].includes(e.target.name)) {
        draft.profile[e.target.name] = e.target.value;
        mark();
      }
    });
    appearanceForm.querySelectorAll("[data-color]").forEach(
      (b) =>
        (b.onclick = () => {
          appearanceForm.elements.accent.value = b.dataset.color;
          draft.profile.accent = b.dataset.color;
          mark();
        }),
    );
    appearanceForm.onsubmit = (e) => {
      e.preventDefault();
      draft.profile.accent = appearanceForm.elements.accent.value;
      draft.profile.footer = appearanceForm.elements.footer.value.trim();
      mark();
      toast("تم التطبيق على المسودة.");
    };
  }
}
async function upload(file, documentFile = false) {
  if (!file) return;
  if (
    ![
      ...(documentFile ? ["application/pdf"] : []),
      "image/png",
      "image/jpeg",
      "image/webp",
    ].includes(file.type) ||
    file.size > (file.type === "application/pdf" ? 5 : 2) * 1024 * 1024
  )
    throw Error("اختَر صورة حتى 2MB، أو PDF حتى 5MB للـCV والشهادات.");
  const data = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("تعذّر قراءة الصورة."));
    r.readAsDataURL(file);
  });
  return (await api("admin/upload", "POST", { data })).url;
}
function edit(kind, id) {
  const existing = draft[kind].find((x) => x.id === id);
  const x = structuredClone(
    existing || {
      id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join(""),
      title: "",
      description: "",
      url: "",
      visible: true,
      featured: false,
      icon: "globe",
      image: "",
      type: "cv",
      file: "",
      issuer: "",
      date: "",
    },
  );
  dialog.innerHTML = `<form id="card-form"><div class="dialog-heading"><div><span class="eyebrow">${kind === "links" ? "LINK CARD" : kind === "resources" ? "DOCUMENT" : "PROJECT"}</span><h2>${existing ? "تعديل" : "إضافة"} ${kind === "links" ? "بطاقة" : kind === "resources" ? "ملف" : "مشروع"}</h2></div><button type="button" id="close-dialog" class="icon-button" aria-label="إغلاق">×</button></div>${field("العنوان", "title", x.title)}<label>الوصف<textarea name="description" maxlength="400" rows="3">${esc(x.description)}</textarea></label>${field("الرابط (اتركه فارغًا ليظهر «قريبًا»)", "url", x.url, "text", 2048)}${kind === "resources" ? `<label>نوع البطاقة<select name="type"><option value="cv" ${x.type === "cv" ? "selected" : ""}>سيرة ذاتية CV</option><option value="certificate" ${x.type === "certificate" ? "selected" : ""}>شهادة</option></select></label>${field("الجهة المانحة (اختياري)", "issuer", x.issuer || "")}${field("التاريخ (اختياري)", "date", x.date || "", "text", 40)}<label>رفع PDF أو صورة<input type="file" name="documentFile" accept="application/pdf,image/png,image/jpeg,image/webp"></label>${x.file ? `<a class="text-link" href="${esc(x.file)}" target="_blank" rel="noopener">الملف الحالي ↗</a><label class="check"><input name="removeFile" type="checkbox"> إزالة الملف الحالي</label>` : ""}<p class="hint">PDF حتى 5MB، الصور حتى 2MB. الملف المرفوع يأخذ الأولوية على الرابط.</p>` : kind === "links" ? `<label>الأيقونة<select name="icon">${["globe", "code", "linkedin", "mail", "instagram", "layers", "phone"].map((ic) => `<option ${ic === x.icon ? "selected" : ""} value="${ic}">${ic}</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="featured" ${x.featured ? "checked" : ""}> بطاقة رئيسية بعرض كامل</label>` : `<div class="image-editor">${x.image ? `<img src="${esc(x.image)}" alt="غلاف المشروع">` : ""}<label>غلاف المشروع<input type="file" name="imageFile" accept="image/png,image/jpeg,image/webp"></label><label class="check"><input type="checkbox" name="removeImage"> إزالة الصورة الحالية</label><p class="hint">PNG / JPEG / WebP — حتى 2MB</p></div>`}<label class="check"><input type="checkbox" name="visible" ${x.visible ? "checked" : ""}> إظهار البطاقة</label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="primary" type="submit">تطبيق على المسودة</button>${existing ? '<button type="button" class="danger" id="delete-card">حذف</button>' : ""}</div></form>`;
  dialog.showModal();
  const form = dialog.querySelector("form");
  dialog.querySelector("#close-dialog").onclick = () => dialog.close();
  form.elements.title.required = true;
  dialog.querySelector("#delete-card")?.addEventListener("click", () => {
    if (!confirm("حذف البطاقة من المسودة؟")) return;
    draft[kind] = draft[kind].filter((c) => c.id !== id);
    dialog.close();
    mark();
    render();
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const fd = new FormData(form),
        url = fd.get("url").trim();
      if (url) {
        let u;
        try {
          u = new URL(url);
        } catch {
          throw Error("اكتب رابطًا كاملًا يبدأ بـ https:// أو mailto: أو tel:");
        }
        if (
          !["https:", "http:", "mailto:", "tel:"].includes(u.protocol) ||
          u.username ||
          u.password
        )
          throw Error("صيغة الرابط غير مسموحة.");
      }
      Object.assign(x, {
        title: fd.get("title").trim(),
        description: fd.get("description").trim(),
        url,
        visible: fd.has("visible"),
      });
      if (!x.title) throw Error("العنوان مطلوب.");
      if (kind === "links") {
        x.icon = fd.get("icon");
        x.featured = fd.has("featured");
      } else if (kind === "resources") {
        x.type = fd.get("type");
        x.issuer = fd.get("issuer").trim();
        x.date = fd.get("date").trim();
        if (fd.has("removeFile")) x.file = "";
        const f = fd.get("documentFile");
        if (f?.size) x.file = await upload(f, true);
      } else {
        if (fd.has("removeImage")) x.image = "";
        const f = fd.get("imageFile");
        if (f?.size) x.image = await upload(f);
      }
      if (existing) draft[kind][draft[kind].findIndex((c) => c.id === id)] = x;
      else {
        if (draft[kind].length >= (kind === "links" ? 50 : 30))
          throw Error("وصلت للحد الأقصى للبطاقات.");
        draft[kind].push(x);
      }
      dialog.close();
      mark();
      render();
    } catch (err) {
      form.querySelector(".form-error").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
}
async function loadStats() {
  const panel = document.querySelector("#analytics-panel");
  try {
    const stats = await api("admin/analytics?days=" + statsRange);
    if (!panel.isConnected) return;
    const cardRows = Object.entries(stats.cards)
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => {
        let lang, kind, id;
        try {
          [lang, kind, id] = JSON.parse(key);
        } catch {
          return "";
        }
        const item = published.locales[lang]?.[kind]?.find((x) => x.id === id);
        return `<tr><td dir="auto">${esc(item?.title || "بطاقة محذوفة")}</td><td>${lang === "ar" ? "عربي" : "English"}</td><td>${kind === "resources" ? "ملف" : kind === "projects" ? "مشروع" : "رابط"}</td><td>${count}</td></tr>`;
      })
      .join("");
    panel.innerHTML = `<div class="section-heading"><div><span class="eyebrow">ANALYTICS</span><h2>كيف يتفاعل زوّارك؟</h2></div><select id="stats-range" aria-label="فترة الإحصائيات">${[7, 30, 90].map((n) => `<option value="${n}" ${n === statsRange ? "selected" : ""}>آخر ${n} يومًا</option>`).join("")}</select></div><div class="stats-counters"><article><span>مرات فتح الصفحة</span><strong>${stats.views}</strong></article><article><span>ضغطات البطاقات</span><strong>${stats.clicks}</strong></article><article><span>الفتح حسب اللغة</span><strong>${stats.languages.ar} / ${stats.languages.en}</strong><small>العربية / English</small></article></div><p class="hint">أرقام تقريبية لمرات الفتح والضغط، وليست أشخاصًا فريدين أو إثبات اكتمال التحميل. المعاينة داخل الإدارة لا تُحتسب. الأيام حسب UTC.</p><h3>أكثر البطاقات تفاعلًا</h3><div class="table-scroll"><table><thead><tr><th>البطاقة</th><th>اللغة</th><th>النوع</th><th>الضغطات</th></tr></thead><tbody>${cardRows || '<tr><td colspan="4">لا توجد ضغطات خلال هذه الفترة.</td></tr>'}</tbody></table></div><h3>النشاط اليومي</h3><div class="table-scroll daily-table"><table><thead><tr><th>اليوم UTC</th><th>مرات الفتح</th><th>الضغطات</th></tr></thead><tbody>${[
      ...stats.days,
    ]
      .reverse()
      .map(
        (d) =>
          `<tr><td>${d.date}</td><td>${d.views}</td><td>${d.clicks}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><p class="hint">يحتفظ النظام بآخر 90 يومًا فقط. تحديث الأرقام عند فتح هذا التبويب أو تغيير الفترة.</p>`;
    panel.querySelector("#stats-range").onchange = (e) => {
      statsRange = Number(e.target.value);
      loadStats();
    };
  } catch (e) {
    if (panel.isConnected) panel.textContent = e.message;
  }
}
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
load();
