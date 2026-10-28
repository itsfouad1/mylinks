# Fouad Links

A bilingual personal link-in-bio website with a private publishing dashboard, built for **Cloudflare Workers**.

Share your social profiles, selected projects, CV, and certificates through one responsive page. Edit content independently in Arabic and English, preview drafts, publish changes, and view aggregate engagement statistics.

## Features

- Arabic RTL and English LTR public pages with a language switch.
- Independent profile, links, projects, files, images, and footer content for each language.
- A private Arabic dashboard with a live preview of the selected language.
- Draft saving and explicit publishing for both languages together.
- Link and project cards with visibility controls, featured styling, and drag or arrow reordering.
- CV and certificate cards supporting external links, PDF downloads, and image uploads.
- Aggregate page views and card clicks for the last 7, 30, or 90 days.
- Password authentication, persistent sessions, CSRF checks, and login rate limiting.
- Atomic revision checks to prevent concurrent dashboard saves from overwriting each other.
- An import tool for content, uploads, and analytics from the original file-based versions.

## Architecture

| Component | Service |
| --- | --- |
| Public page and dashboard assets | Workers Static Assets |
| API and authentication | Cloudflare Worker |
| Content, sessions, counters, and rate limits | Cloudflare D1 |
| Uploaded images and documents | Cloudflare R2 |
| Expired records and analytics retention | Daily Worker Cron Trigger |

The frontend uses vanilla JavaScript, HTML, and CSS. The Worker uses Web APIs and Web Crypto. There is no filesystem storage or long-running Node.js server in production.

## Requirements

- Node.js 22.12 or newer and npm.
- A Cloudflare account with Workers, D1, and R2 available for production deployment.
- A D1 database and an R2 bucket bound as `DB` and `FILES`.

Local development uses simulated resources and does not require Cloudflare login. Node.js runs the development and deployment tools; it is not the production HTTP server.

## Run Locally

```bash
npm ci
npm run setup
npm run db:local
npm run dev
```

Open the URL printed by Wrangler, normally `http://localhost:8787`.

- Public page: `/`
- Dashboard: `/admin`
- English page: `/?lang=en`

Setup asks you to choose and confirm a password of 12–256 characters. It creates a private `.dev.vars` file containing a password verifier and a signing secret. Password input is visible in the terminal, so use a private terminal. There is no default password.

Local D1 and R2 data persist under `.wrangler/state`. Deploying the source does not upload that local data to production.

## Dashboard Workflow

1. Sign in at `/admin`.
2. Choose the language you want to edit.
3. Update your profile, links, projects, CV, or certificates.
4. Review the live preview.
5. Save a draft or publish the changes.

Each language has independent content. Switching languages preserves unsaved edits in the other language. Saving and publishing apply to **both languages together**.

The public page starts with editable sample text and empty links. Empty links appear as “coming soon”; hide them or add your own URLs before sharing the site.

PDF uploads are limited to 5 MB; PNG, JPEG, and WebP images are limited to 2 MB. Uploaded files are served by the Worker through `/uploads/...`; keep the R2 bucket private. A file attached to a card takes priority over its external URL.

## Deploy to Cloudflare

See [DEPLOY_AR.md](DEPLOY_AR.md) for the complete Arabic walkthrough.

### 1. Authenticate and create resources

```bash
npx wrangler login
npx wrangler d1 create fouad-links-db
npx wrangler r2 bucket create fouad-links-files
```

Update `wrangler.jsonc` with the returned D1 `database_id`. The all-zero ID in the repository is a **local development placeholder**, not a production database ID. Change database and bucket names if you use different names.

### 2. Apply the production schema and deploy

```bash
npm run db:remote
npm run deploy
```

The first deployment is not ready for use until you configure the login secrets in the next step. The frontend can load, but APIs requiring secrets return a setup error.

### 3. Set production secrets

```bash
npm run setup -- --remote
```

This sets `ADMIN_CREDENTIAL` and `SESSION_SECRET` through Wrangler using stdin. It does not print their values or put them in command-line arguments. Local `.dev.vars` values are **not** deployed automatically.

The script asks for confirmation before replacing production secrets. Changing either secret invalidates existing sessions. After both secrets are set, open the deployed `/admin`, add your content, and publish.

`PUBLIC_ORIGIN` is optional. Without it, writes must match the exact request origin. Set it only if you want to restrict API writes to a single canonical HTTPS origin; omit the trailing slash. It is a runtime Worker environment variable, not an administrator secret.

### GitHub deployment

Commit the source, migrations, `wrangler.jsonc`, and lockfile. After the initial resource and secret setup, connect the repository through Cloudflare Workers Builds. Use `npm run build` as the build command and `npm run deploy` as the deploy command. Keep the project root set to the directory containing `package.json`.

Apply new D1 migrations deliberately with `npm run db:remote` before deploying code that requires them. Do not use production D1/R2 bindings for untrusted pull-request previews. Worker version preview URLs are disabled in the supplied configuration.

## Configuration and Secrets

| Name | Purpose |
| --- | --- |
| `DB` | D1 binding for content, sessions, and statistics |
| `FILES` | R2 binding for uploads |
| `ASSETS` | Worker static asset binding |
| `ADMIN_CREDENTIAL` | Secret JSON password verifier generated by setup |
| `SESSION_SECRET` | Secret used for event signing and rate-limit key hashing |
| `PUBLIC_ORIGIN` | Optional canonical origin for API writes |

Never commit `.dev.vars`, `.env`, old `data/` folders, or generated migration SQL. The included `.gitignore` excludes these paths.

## Import an Existing Site

See [MIGRATION_AR.md](MIGRATION_AR.md). The importer accepts `data/content.json`, optional `data/analytics.json`, and `data/uploads/` from version 1 or 2.

```bash
# Validate and create a private migration plan without changing D1 or R2.
npm run migrate:legacy -- --from /absolute/path/to/old/data

# Import into local simulated resources.
npm run migrate:legacy -- --from /absolute/path/to/old/data --local

# Import into the Cloudflare resources configured in wrangler.jsonc.
npm run migrate:legacy -- --from /absolute/path/to/old/data --remote
```

The importer refuses to replace edited destination content. Use a fresh database or its untouched default content. It preserves separate drafts, published content, revisions, file paths, and recent analytics. Existing sessions are not imported.

The original scrypt password verifier cannot be copied directly into this Worker. You can retain your password by running setup with `--legacy-admin /path/to/old/data/admin.json`; setup checks the old verifier and generates a new PBKDF2 verifier. Local and remote passwords are configured independently.

## Analytics and Privacy

Statistics count **page loads and clicks**, not unique people or confirmed downloads. Reloading or switching languages counts as another page load. Dashboard previews do not send tracking events.

D1 stores daily counters grouped by language and card ID. It does not store raw IP addresses or visitor identifiers in the analytics table. Rate limiting stores rotating keyed hashes of network addresses, with expiration. Hosting providers may separately process request metadata under their own settings and policies.

Some bots are filtered by User-Agent, events require a signed token valid for one hour, and rate limits reduce bursts. Counts remain approximate and can be affected by blockers, interrupted requests, or deliberate manipulation. Event counters use atomic SQL increments, so concurrent updates do not overwrite each other.

The daily Cron Trigger removes expired sessions and rate-limit records and analytics older than the 90-day retention window. Keep that trigger enabled. Aggregate analytics are accessible only through authenticated API routes.

## Authentication

- PBKDF2-SHA256 verifier with a random salt and 100,000 iterations.
- Random session tokens, stored as SHA-256 hashes in D1, with eight-hour expiration.
- HTTP-only, SameSite cookies; Secure cookies on HTTPS.
- CSRF tokens and exact-origin checks for authenticated writes.
- Eight login requests per 15-minute fixed window per hashed network address, including successful attempts.
- Secret rotation invalidates sessions across Worker instances.

Upload validation checks allowed types, basic file signatures, and size limits. It is not antivirus scanning. Only the administrator can upload. Files are publicly downloadable by anyone who knows their URL; do not upload private documents.

## Development Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Configure local administrator secrets |
| `npm run db:local` | Apply local D1 migrations |
| `npm run dev` | Run the local Worker and static assets |
| `npm run check` | Check JavaScript syntax |
| `npm test` | Build and test against Miniflare D1/R2 |
| `npm run build` | Validate and bundle a deployment without publishing |
| `npm run db:remote` | Apply production D1 migrations |
| `npm run deploy` | Deploy to your Cloudflare account |

Tests cover authentication, CSRF and origin validation, D1 write conflicts, bilingual publishing, R2 uploads, analytics concurrency, session persistence, secret rotation, retention cleanup, and legacy imports.

## Project Structure

```text
public/              Public page, dashboard, shared styles, and assets
worker/              Request routing, validation, security, and D1 operations
migrations/          D1 schema migrations
scripts/             Setup, development, and legacy import tools
test/                Cloudflare runtime integration tests
seed.mjs             Initial Arabic content
content.mjs          English defaults and legacy content conversion
wrangler.jsonc       Worker configuration and resource bindings
```

## Backups and Limits

Back up D1 and R2 separately; source control does not contain uploaded content. For example, export D1 with `npx wrangler d1 export DB --remote --output=backup.sql` and back up R2 objects using your chosen authenticated R2 tooling. Keep exports private.

Uploaded files are not deleted automatically when a card is removed, so old links keep working. Review and remove unused R2 objects manually after taking a backup. This application supports one administrator; it is not a multi-tenant product.

## Author

Built by **Fouad Adel** — Backend Developer.
