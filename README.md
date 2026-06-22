# Exotiq Sales Hub

A small, **private**, unindexed static site hosted on Netlify. It hosts three things:

- **Sales Playbook** — `playbook.html`
- **Call Cockpit** — `cockpit.html`
- An outbound link to the **live sales dashboard** (set in `index.html`)

The whole site sits behind a **single shared password**, enforced server-side by a
Netlify Edge Function. Unauthenticated visitors never receive site content.

## Structure

```
/index.html                       the hub / front door
/playbook.html                    the sales playbook
/cockpit.html                     the call cockpit
/robots.txt                       Disallow: /  (crawlers can read this; it is not gated)
/netlify.toml                     publish = "."; edge function on /*; security headers
/netlify/edge-functions/gate.ts   the shared-password gate
```

> The three HTML files shipped initially are **placeholders** so the gate could be
> deployed and verified end-to-end. Replace them with the finished files; do not
> change their content or styling beyond ensuring a `noindex` meta is present.

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
- **Sign out:** visit **`/logout`** to clear the cookie. (The hub placeholder links
  to it; the finished hub can too if desired.)

## Indexing is blocked in three layers

1. `robots.txt` → `User-agent: * / Disallow: /`
2. `X-Robots-Tag: noindex, nofollow` response header on every path (set both in
   `netlify.toml` and by the edge function, since edge-function paths don't pick up
   `netlify.toml` headers).
3. `<meta name="robots" content="noindex, nofollow">` in every page `<head>`.

## Deploy

No build step — these are static files, published from the repo root. The edge
function in `netlify/edge-functions/` is bundled and deployed automatically.

This site uses **Git-based continuous deployment** (the build runs on Netlify's
servers, pulling from GitHub). The Netlify site is **`nimble-zuccutto-5fb8e9`**
on the **ExotIQ** team (site ID `f3679f6a-1ca7-42b0-9ea9-f8fd1920115d`).

One-time setup in the Netlify dashboard:

1. **Link the repo.** Site `nimble-zuccutto-5fb8e9` → Site configuration → Build &
   deploy → Continuous deployment → **Link repository** → `exotiq-ai/sales.exotiq`,
   production branch `claude/determined-ritchie-k42fvk` (or `main` if you merge there).
   Build command: *(none)*. Publish directory: `.` (already in `netlify.toml`).
2. **Set the password.** Site configuration → Environment variables → add
   `SITE_PASSWORD` = `ExotiqAI2026!` (mark as secret). **Not stored in git.**
3. Trigger a deploy (it runs automatically on the next push, or use "Trigger deploy").

> A direct `netlify deploy --prod` works too if you run it from a machine that can
> reach `api.netlify.com` (the Claude Code web sandbox cannot, due to its network
> egress policy — hence Git-based deploy).

## Configuration owned in the Netlify dashboard

1. **Custom domain** — add `sales.exotiq.ai` in Domain management.
2. **DNS** — at the DNS provider for `exotiq.ai`, add a `CNAME`: host `sales` →
   the Netlify site target. Netlify provisions HTTPS automatically once DNS resolves.
3. **Dashboard URL** — already set in `index.html` to
   `https://leadsbysaul.netlify.app/dashboard` (the `data-dashboard-link` card).
   Update it there if the dashboard URL changes.

## Note on access model

A single shared password means anyone with it can get in, and rotating it changes
it for everyone — fine for an internal team. If per-person access with individual
logout and revocation is needed later, switch the gate to **Cloudflare Access**
(free for small teams) or **Netlify team login** (Enterprise). Not built now.
