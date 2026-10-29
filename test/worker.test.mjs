import { test } from "node:test";
import assert from "node:assert/strict";
import { Miniflare } from "miniflare";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { initial } from "../seed.mjs";
import { importStatements } from "../scripts/migrate-legacy.mjs";
const password = "local-test-password-123",
  salt = randomBytes(32).toString("hex");
const credential = JSON.stringify({
  algorithm: "PBKDF2-SHA256",
  iterations: 100000,
  salt,
  hash: pbkdf2Sync(
    password,
    Buffer.from(salt, "hex"),
    100000,
    32,
    "sha256",
  ).toString("hex"),
});
const bindings = {
  ADMIN_CREDENTIAL: credential,
  SESSION_SECRET: randomBytes(48).toString("hex"),
};
async function init(mf) {
  const db = await mf.getD1Database("DB");
  const schema = await readFile("migrations/0001_initial.sql", "utf8");
  await db.batch(
    schema
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((sql) => db.prepare(sql)),
  );
  return db;
}
function options(dir) {
  return {
    modules: true,
    scriptPath: resolve(".build/index.js"),
    compatibilityDate: "2026-07-30",
    d1Databases: { DB: "test-db" },
    r2Buckets: ["FILES"],
    d1Persist: join(dir, "d1"),
    r2Persist: join(dir, "r2"),
    bindings,
    serviceBindings: {
      ASSETS: async (request) => {
        const path = new URL(request.url).pathname;
        const content = await readFile(join("public", path));
        return new Response(content, {
          headers: {
            "Content-Type": path.endsWith(".html") ? "text/html" : "text/plain",
          },
        });
      },
    },
  };
}

test("Cloudflare runtime: D1, R2, Web Crypto, content, metrics and session persistence", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "fouad-worker-"));
  const opts = options(dir);
  let mf = new Miniflare(opts),
    db = await init(mf),
    cookie,
    csrf,
    revision,
    content,
    ar,
    en;
  const call = async (path, method = "GET", body, extra = {}) => {
    const r = await mf.dispatchFetch("https://links.test" + path, {
      method,
      headers: {
        Origin: "https://links.test",
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.10",
        "User-Agent": "IntegrationTest",
        ...(cookie ? { Cookie: cookie, "X-CSRF-Token": csrf } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const isJson = r.headers.get("Content-Type")?.includes("application/json");
    return {
      status: r.status,
      headers: r.headers,
      data: isJson ? await r.json() : await r.text(),
    };
  };
  try {
    await t.test(
      "public bilingual content; hidden state and server files stay private",
      async () => {
        assert.equal((await call("/api/admin")).status, 401);
        ar = (await call("/api/content?lang=ar")).data;
        en = (await call("/api/content?lang=en")).data;
        assert.equal(ar.profile.name, "فؤاد عادل");
        assert.equal(en.profile.name, "Fouad Adel");
        assert.equal(ar.draft, undefined);
        assert.ok(ar.trackingToken);
        for (const p of ["/worker/index.mjs", "/.dev.vars", "/data/admin.json"])
          assert.equal((await call(p)).status, 404);
        const publicPage = await call("/");
        assert.equal(publicPage.status, 200);
        assert.match(publicPage.data, /public-page/);
        assert.match(
          publicPage.headers.get("Content-Security-Policy"),
          /script-src 'self'/,
        );
        assert.equal((await call("/admin")).status, 200);
      },
    );
    await t.test(
      "Web Crypto login, SameSite secure cookies and origin protection",
      async () => {
        assert.equal(
          (await call("/api/login", "POST", { password: "wrong" })).status,
          401,
        );
        assert.equal(
          (
            await call(
              "/api/login",
              "POST",
              { password },
              { Origin: "https://evil.test" },
            )
          ).status,
          403,
        );
        const r = await call("/api/login", "POST", { password });
        assert.equal(r.status, 200);
        cookie = r.headers.get("Set-Cookie").split(";")[0];
        csrf = r.data.csrf;
        assert.match(r.headers.get("Set-Cookie"), /HttpOnly/);
        assert.match(r.headers.get("Set-Cookie"), /Secure/);
        const a = (await call("/api/admin")).data;
        revision = a.revision;
        content = a.draft;
      },
    );
    await t.test(
      "save validates and does not publish; parallel revision writes are atomic",
      async () => {
        content.locales.ar.profile.name = "العربية المستقلة";
        content.locales.en.profile.name = "Independent English";
        content.locales.ar.links[0].url = "https://example.com/work";
        content.locales.ar.links[1].visible = false;
        const bad = structuredClone(content);
        bad.locales.ar.links[0].url = "javascript:alert(1)";
        assert.equal(
          (await call("/api/admin/draft", "PUT", { content: bad, revision }))
            .status,
          400,
        );
        assert.equal(
          (
            await call(
              "/api/admin/draft",
              "PUT",
              { content, revision },
              { "X-CSRF-Token": "wrong" },
            )
          ).status,
          403,
        );
        const attempts = await Promise.all([
          call("/api/admin/draft", "PUT", { content, revision }),
          call("/api/admin/draft", "PUT", { content, revision }),
        ]);
        assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
        revision = attempts.find((x) => x.status === 200).data.revision;
        assert.equal(
          (await call("/api/content")).data.profile.name,
          "فؤاد عادل",
        );
      },
    );
    let imageUrl, pdfUrl;
    await t.test(
      "R2 upload and download validate type, size and traversal",
      async () => {
        const pixel =
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lN8AAAAASUVORK5CYII=";
        const image = await call("/api/admin/upload", "POST", {
          data: "data:image/png;base64," + pixel,
        });
        assert.equal(image.status, 201);
        imageUrl = image.data.url;
        const pdf = await call("/api/admin/upload", "POST", {
          data:
            "data:application/pdf;base64," +
            Buffer.from("%PDF-1.4\n%%EOF").toString("base64"),
        });
        assert.equal(pdf.status, 201);
        pdfUrl = pdf.data.url;
        const download = await call(pdfUrl);
        assert.equal(download.status, 200);
        assert.equal(download.headers.get("Content-Type"), "application/pdf");
        assert.match(download.headers.get("Content-Disposition"), /attachment/);
        assert.equal((await call(imageUrl, "HEAD")).status, 200);
        assert.equal(
          (
            await call("/api/admin/upload", "POST", {
              data: "data:image/png;base64,SGVsbG8=",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call("/api/admin/upload", "POST", {
              data: "data:text/html;base64,SGVsbG8=",
            })
          ).status,
          400,
        );
        assert.equal(
          (await call("/uploads/%2e%2e/worker/index.mjs")).status,
          404,
        );
        const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1);
        tooBig.set([137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(
          (
            await call("/api/admin/upload", "POST", {
              data: "data:image/png;base64," + tooBig.toString("base64"),
            })
          ).status,
          413,
        );
      },
    );
    await t.test(
      "publish includes localized CV cards and filters hidden links",
      async () => {
        content.locales.ar.profile.avatar = imageUrl;
        content.locales.ar.resources = [
          {
            id: "cv",
            type: "cv",
            title: "السيرة الذاتية",
            description: "نسخة عربية",
            url: "",
            file: pdfUrl,
            visible: true,
            issuer: "",
            date: "",
          },
        ];
        content.locales.en.resources = [
          { ...content.locales.ar.resources[0], title: "English CV" },
        ];
        let saved = await call("/api/admin/draft", "PUT", {
          content,
          revision,
        });
        revision = saved.data.revision;
        const r = await call("/api/admin/publish", "POST", { revision });
        assert.equal(r.status, 200);
        revision = r.data.revision;
        ar = (await call("/api/content")).data;
        en = (await call("/api/content?lang=en")).data;
        assert.equal(ar.profile.name, "العربية المستقلة");
        assert.equal(en.profile.name, "Independent English");
        assert.equal(ar.resources[0].file, pdfUrl);
        assert.equal(en.resources[0].title, "English CV");
        assert.equal(
          ar.links.some((x) => x.id === "github"),
          false,
        );
        assert.equal(
          (await call("/api/admin/publish", "POST", { revision: 0 })).status,
          409,
        );
      },
    );
    await t.test(
      "analytics increments atomically; forged and hidden clicks rejected",
      async () => {
        const send = (payload) =>
          call("/api/events", "POST", {
            lang: "ar",
            token: ar.trackingToken,
            ...payload,
          });
        const views = await Promise.all(
          Array.from({ length: 12 }, () => send({ type: "view" })),
        );
        assert.ok(views.every((r) => r.status === 200));
        assert.equal(
          (await send({ type: "click", kind: "resources", id: "cv" })).status,
          200,
        );
        assert.equal(
          (await send({ type: "click", kind: "links", id: "github" })).status,
          404,
        );
        assert.equal(
          (await send({ type: "view", token: "forged" })).status,
          400,
        );
        assert.equal((await send({ type: "view", lang: "en" })).status, 400);
        assert.equal(
          (
            await call("/api/events", "POST", {
              lang: "en",
              token: en.trackingToken,
              type: "view",
            })
          ).status,
          200,
        );
        const stats = (await call("/api/admin/analytics?days=7")).data;
        assert.equal(stats.views, 13);
        assert.equal(stats.clicks, 1);
        assert.deepEqual(stats.languages, { ar: 12, en: 1 });
        assert.equal(stats.days.length, 7);
        assert.equal((await call("/api/admin/analytics?days=999")).status, 400);
        const rows = await db.prepare("SELECT * FROM rate_limits").all();
        assert.ok(rows.results.every((x) => !x.key.includes("192.0.2.10")));
      },
    );
    await t.test(
      "D1 sessions, content, counters and R2 survive a new Worker instance",
      async () => {
        await mf.dispose();
        mf = new Miniflare(opts);
        db = await mf.getD1Database("DB");
        assert.equal((await call("/api/admin")).status, 200);
        assert.equal(
          (await call("/api/content")).data.profile.name,
          "العربية المستقلة",
        );
        assert.equal((await call(pdfUrl)).status, 200);
        assert.equal(
          (await call("/api/admin/analytics?days=30")).data.views,
          13,
        );
      },
    );
    await t.test(
      "scheduled cleanup removes expired records and retains current metrics",
      async () => {
        await db
          .prepare(
            "INSERT INTO analytics(day,lang,kind,card_id,count) VALUES(?,?,?,?,?)",
          )
          .bind("2000-01-01", "ar", "view", "", 55)
          .run();
        await db
          .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
          .bind("expired", "csrf", "old", 1)
          .run();
        await db
          .prepare("INSERT INTO rate_limits VALUES(?,?,?)")
          .bind("expired", 1, 1)
          .run();
        const result = await (
          await mf.getWorker()
        ).scheduled({ cron: "15 3 * * *" });
        assert.equal(result.outcome, "ok");
        assert.equal(
          await db
            .prepare("SELECT * FROM sessions WHERE token_hash='expired'")
            .first(),
          null,
        );
        assert.equal(
          await db
            .prepare("SELECT * FROM analytics WHERE day='2000-01-01'")
            .first(),
          null,
        );
        assert.equal((await call("/api/admin/analytics")).data.views, 13);
      },
    );
    await t.test(
      "credential rotation revokes sessions; logout clears shared session",
      async () => {
        await mf.setOptions({
          ...opts,
          bindings: {
            ...bindings,
            SESSION_SECRET: "rotated-secret-that-is-at-least-32-characters",
          },
        });
        assert.equal((await call("/api/admin")).status, 401);
        const login = await call(
          "/api/login",
          "POST",
          { password },
          { "CF-Connecting-IP": "192.0.2.11" },
        );
        assert.equal(login.status, 200);
        cookie = login.headers.get("Set-Cookie").split(";")[0];
        csrf = login.data.csrf;
        assert.equal((await call("/api/admin/logout", "POST", {})).status, 200);
        assert.equal((await call("/api/admin")).status, 401);
      },
    );
    await t.test("login rate limit persists across requests", async () => {
      for (let i = 0; i < 8; i++)
        assert.equal(
          (
            await call(
              "/api/login",
              "POST",
              { password: "wrong" },
              { "CF-Connecting-IP": "192.0.2.30" },
            )
          ).status,
          401,
        );
      assert.equal(
        (
          await call(
            "/api/login",
            "POST",
            { password },
            { "CF-Connecting-IP": "192.0.2.30" },
          )
        ).status,
        429,
      );
    });
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy import supports large Unicode content, preserves drafts and counters, refuses overwrites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "legacy-d1-")),
    mf = new Miniflare(options(dir));
  try {
    const db = await init(mf),
      legacy = {
        draft: structuredClone(initial),
        published: structuredClone(initial),
        revision: 7,
        publishedAt: null,
      };
    legacy.draft.profile.name = "فؤاد's 🧑‍💻";
    legacy.draft.links = Array.from({ length: 50 }, (_, i) => ({
      id: "card" + i,
      title: "الرابط " + i,
      description: "وصف 😀".repeat(40),
      url: "https://example.com/" + "x".repeat(1800),
      icon: "globe",
      visible: true,
      featured: false,
    }));
    const day = new Date().toISOString().slice(0, 10),
      stats = {
        [day]: {
          views: { ar: 6, en: 2 },
          clicks: { '["ar","links","card1"]': 3 },
        },
      };
    const planned = importStatements(legacy, stats);
    assert.ok(planned.draft.length > 100000);
    assert.ok(
      planned.contentSql
        .split("\n")
        .every((s) => Buffer.byteLength(s) < 100000),
    );
    await db.exec(planned.contentSql);
    await db.exec(planned.analyticsSql);
    const state = await db.prepare("SELECT * FROM content WHERE id=1").first();
    assert.equal(state.revision, 7);
    assert.equal(JSON.parse(state.draft).locales.ar.profile.name, "فؤاد's 🧑‍💻");
    assert.equal(
      JSON.parse(state.published).locales.ar.profile.name,
      initial.profile.name,
    );
    assert.equal(
      (await db.prepare("SELECT SUM(count) AS total FROM analytics").first())
        .total,
      11,
    );
    const changed = { ...legacy, revision: 99 };
    changed.draft = structuredClone(initial);
    await db.exec(importStatements(changed).contentSql);
    assert.equal(
      (await db.prepare("SELECT revision FROM content WHERE id=1").first())
        .revision,
      7,
    );
    await db.exec(planned.analyticsSql);
    assert.equal(
      (await db.prepare("SELECT SUM(count) AS total FROM analytics").first())
        .total,
      11,
    );
  } finally {
    await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
