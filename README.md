# Exotiq Sales Hub

A small, **private**, unindexed static site hosted on Netlify. It hosts:

- **Sales Playbook** — the home page, served at `/` (`index.html`)
- **Call Cockpit** — `/cockpit.html`
- An outbound link to the **live sales dashboard** (cross-tool nav in both pages)

The whole site sits behind a **single shared password**, enforced server-side by a
Netlify Edge Function. Unauthenticated visitors never receive site content.

## Structure

```
/index.html                       the Sales Playbook (home, served at /)
/cockpit.html                     the Call Cockpit
/robots.txt                       Disallow: /  (crawlers can read this; it is not gated)
/netlify.toml                     publish = "."; edge function on /*; security headers
/netlify/edge-functions/gate.ts   the shared-password gate
```

> The Playbook is canonical and lives at `/`. Cross-tool nav in both pages assumes
> the Playbook at `/` and the Cockpit at `/cockpit.html`; if you move either, update
> those hrefs in both files. The old standalone hub and the pre-brand-book playbook
> have been retired.

## How the gate works

- Runs on every path (`/*`) **except `/robots.txt`**.
- No valid session cookie → a branded password page is returned (HTTP 401). The
  requested content is only served after authentication.
- The password is read from the **`SITE_PASSWORD`** environment variable. The
  submitted value and the stored value are both SHA-256 hashed (Web Crypto) and
  compared in constant time — plaintext is never compared.
- On success a session cookie is set: `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/`, ~24h expiry. The cookie carries an HMAC-signed expiry, so the session
  is verified server-side and **rotating `SITE_PASSWORD` invalidates all sessions**.
- **Fails closed:** if `SITE_PASSWORD` is unset, every path is blocked with a
  "Site not configured" page.
- **Sign out:** visit **`/logout`** to clear the cookie.

## Indexing is blocked in three layers

1. `robots.txt` → `User-agent: * / Disallow: /`
2. `X-Robots-Tag: noindex, nofollow` response header on every path (set both in
   `netlify.toml` and by the edge function, since edge-function paths don't pick up
   `netlify.toml` headers).
3. `<meta name="robots" content="noindex, nofollow">` in every page `<head>`.

## Deploy

No build step — these are static files. The edge function in `netlify/edge-functions/`
is bundled and deployed automatically.

The Netlify site is **`nimble-zuccutto-5fb8e9`** on the **ExotIQ** team
(site ID `f3679f6a-1ca7-42b0-9ea9-f8fd1920115d`), live at
<https://nimble-zuccutto-5fb8e9.netlify.app>.

### Recommended: native Git deploy (auto-deploys on push, no secrets in CI)

1. **Link the repo.** Site `nimble-zuccutto-5fb8e9` → Site configuration → Build &
   deploy → Continuous deployment → **Link repository** → `exotiq-ai/sales.exotiq`,
   production branch `claude/determined-ritchie-k42fvk` (or `main` if you merge there).
   Build command: *(none)*. Publish directory: `.` (already in `netlify.toml`).
2. **Set the password.** Site configuration → Environment variables → add
   `SITE_PASSWORD` = *(your shared password)* (mark as secret). **Keep it out of git.**

### Fallback: manual GitHub Actions deploy (`.github/workflows/deploy.yml`)

A `workflow_dispatch` workflow that deploys and re-verifies the live gate from a
GitHub-hosted runner. It reads two **repository Actions secrets** — set them in
Settings → Secrets and variables → Actions:

- `NETLIFY_AUTH_TOKEN` — a Netlify personal access token
- `SITE_PASSWORD` — the shared site password

Nothing sensitive is stored in the repo; secrets are auto-masked in logs. Run it
from the Actions tab → "Deploy to Netlify" → Run workflow. (Delete this workflow
if you only use native Git deploy.)

> A direct `netlify deploy --prod` from your own machine works too — the Claude
> Code web sandbox can't reach `api.netlify.com` (network egress policy), which is
> why deploys run on a GitHub runner or Netlify's build servers instead.

## Configuration owned in the Netlify dashboard

1. **Custom domain** — add `sales.exotiq.ai` in Domain management.
2. **DNS** — at the DNS provider for `exotiq.ai`, add a `CNAME`: host `sales` →
   the Netlify site target. Netlify provisions HTTPS automatically once DNS resolves.
3. **Dashboard URL** — set to `https://leadsbysaul.netlify.app/dashboard` in the
   cross-tool nav of both `index.html` and `cockpit.html`. Update it in both if the
   dashboard URL changes.

## Note on access model

A single shared password means anyone with it can get in, and rotating it changes
it for everyone — fine for an internal team. If per-person access with individual
logout and revocation is needed later, switch the gate to **Cloudflare Access**
(free for small teams) or **Netlify team login** (Enterprise). Not built now.
