export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
function string(v, max = 300) {
  if (typeof v !== "string" || v.length > max)
    throw fail(400, "نص غير صالح أو أطول من الحد المسموح.");
  return v.trim();
}
function address(v) {
  v = string(v, 2048);
  if (!v) return "";
  try {
    const u = new URL(v);
    if (
      !["https:", "http:", "mailto:", "tel:"].includes(u.protocol) ||
      u.username ||
      u.password
    )
      throw 0;
    return v;
  } catch {
    throw fail(400, "الرابط غير صالح. استخدم https:// أو mailto: أو tel:");
  }
}
function image(v) {
  v = string(v, 200);
  if (v && !/^\/uploads\/[a-f0-9]{48}\.(png|jpg|webp)$/.test(v))
    throw fail(400, "مسار الصورة غير صالح.");
  return v;
}
export function validateContent(v, localized = true) {
  if (v?.locales) {
    if (!localized) throw fail(400, "بنية المحتوى غير صالحة.");
    if (!v.locales.ar || !v.locales.en)
      throw fail(400, "المحتوى العربي والإنجليزي مطلوب.");
    return {
      locales: {
        ar: validateContent(v.locales.ar, false),
        en: validateContent(v.locales.en, false),
      },
    };
  }
  if (
    !v ||
    !v.profile ||
    !Array.isArray(v.links) ||
    !Array.isArray(v.projects) ||
    v.links.length > 50 ||
    v.projects.length > 30
  )
    throw fail(400, "بيانات الصفحة غير صالحة.");
  const p = v.profile;
  if (!/^#[a-f0-9]{6}$/i.test(p.accent)) throw fail(400, "اللون غير صالح.");
  const profile = {
    name: string(p.name, 80),
    role: string(p.role, 100),
    bio: string(p.bio, 400),
    avatar: image(p.avatar),
    accent: p.accent,
    footer: string(p.footer, 80),
    email: string(p.email || "", 150),
  };
  if (!profile.name) throw fail(400, "الاسم مطلوب.");
  const resources = v.resources || [];
  if (!Array.isArray(resources) || resources.length > 30)
    throw fail(400, "عدد الملفات غير صالح.");
  const ids = new Set();
  function common(x) {
    if (!x || typeof x !== "object") throw fail(400, "البطاقة غير صالحة.");
    const id = string(x.id, 80);
    if (!id || ids.has(id)) throw fail(400, "معرّف البطاقة مكرر.");
    ids.add(id);
    const title = string(x.title, 100);
    if (!title) throw fail(400, "عنوان البطاقة مطلوب.");
    return {
      id,
      title,
      description: string(x.description, 400),
      url: address(x.url),
      visible: !!x.visible,
    };
  }
  return {
    profile,
    resources: resources.map((x) => {
      if (!x || typeof x !== "object") throw fail(400, "البطاقة غير صالحة.");
      if (!["cv", "certificate"].includes(x.type))
        throw fail(400, "نوع البطاقة غير صالح.");
      const file = string(x.file || "", 200);
      if (file && !/^\/uploads\/[a-f0-9]{48}\.(pdf|png|jpg|webp)$/.test(file))
        throw fail(400, "مسار الملف غير صالح.");
      return {
        ...common(x),
        type: x.type,
        file,
        issuer: string(x.issuer || "", 100),
        date: string(x.date || "", 40),
      };
    }),
    links: v.links.map((x) => ({
      ...common(x),
      icon: [
        "layers",
        "code",
        "linkedin",
        "mail",
        "instagram",
        "globe",
        "phone",
      ].includes(x.icon)
        ? x.icon
        : "globe",
      featured: !!x.featured,
    })),
    projects: v.projects.map((x) => ({ ...common(x), image: image(x.image) })),
  };
}
