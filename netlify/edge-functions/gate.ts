import type { Context, Config } from "@netlify/edge-functions";

/**
 * Shared-password gate for the entire Exotiq Sales Hub.
 *
 * Pattern adapted from Netlify's official "password protect a page" template,
 * extended to cover the whole site:
 *   - Runs on every path ("/*") except /robots.txt (crawlers must be able to
 *     read the Disallow directive).
 *   - Unauthenticated visitors NEVER receive site content. They get a branded
 *     password page instead. The page content is only served via context.next()
 *     once a valid session cookie is present.
 *   - The password lives in the SITE_PASSWORD environment variable. We never
 *     compare it in plaintext: the submitted value and the stored value are both
 *     hashed with SHA-256 (Web Crypto) and compared in constant time.
 *   - On success we set an HttpOnly, Secure, SameSite=Strict session cookie that
 *     carries a server-verifiable, HMAC-signed expiry (~24h). Rotating
 *     SITE_PASSWORD invalidates every outstanding session.
 *   - Fails closed: if SITE_PASSWORD is unset we block everything and explain.
 */

const COOKIE_NAME = "__Host-exotiq_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24 hours

const encoder = new TextEncoder();

/** Constant-time comparison of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return toHex(digest);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return toHex(signature);
}

/** Build a signed session token of the form "<expiryMs>.<hmac>". */
async function createSessionToken(password: string): Promise<string> {
  const expiry = Date.now() + SESSION_TTL_SECONDS * 1000;
  const signature = await hmacHex(password, String(expiry));
  return `${expiry}.${signature}`;
}

/** Verify a session token: signature must match and the expiry must be in the future. */
async function isValidSessionToken(token: string, password: string): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiryStr = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || Date.now() >= expiry) return false;
  const expected = await hmacHex(password, expiryStr);
  return timingSafeEqual(signature, expected);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Only allow same-site, single-leading-slash redirect targets (no open redirects). */
function sanitizeRedirect(target: string | null): string {
  if (!target) return "/";
  if (!target.startsWith("/") || target.startsWith("//")) return "/";
  return target;
}

/** Headers applied to every response this function produces. */
function securityHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "no-store",
    ...extra,
  };
}

function htmlResponse(body: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: securityHeaders({ "Content-Type": "text/html; charset=utf-8", ...extraHeaders }),
  });
}

function loginPage(opts: { redirect: string; error?: string; loggedOut?: boolean }): string {
  const { redirect, error, loggedOut } = opts;
  const notice = error
    ? `<p class="msg error" role="alert">${error}</p>`
    : loggedOut
      ? `<p class="msg ok">You have been signed out.</p>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>exotiq · Sales Hub</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;700;800&family=Montserrat:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --midnight: #0A1929;
      --gulf: #6EC1E4;
      --ink: #E8EEF4;
      --muted: #8aa0b2;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      background: radial-gradient(1200px 600px at 50% -10%, #102a40 0%, var(--midnight) 60%);
      color: var(--ink);
      font-family: "Montserrat", system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 380px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(110, 193, 228, 0.18);
      border-top: 3px solid var(--gulf);
      border-radius: 14px;
      padding: 40px 32px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(6px);
    }
    .wordmark {
      font-family: "Manrope", sans-serif;
      font-weight: 800;
      font-size: 30px;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--ink);
    }
    .wordmark .dot { color: var(--gulf); }
    .sub {
      margin: 6px 0 28px;
      color: var(--muted);
      font-size: 13px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    label {
      display: block;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 8px;
    }
    input[type="password"] {
      width: 100%;
      padding: 13px 14px;
      border-radius: 9px;
      border: 1px solid rgba(110, 193, 228, 0.25);
      background: rgba(10, 25, 41, 0.6);
      color: var(--ink);
      font-family: inherit;
      font-size: 15px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input[type="password"]:focus {
      border-color: var(--gulf);
      box-shadow: 0 0 0 3px rgba(110, 193, 228, 0.22);
    }
    button {
      margin-top: 18px;
      width: 100%;
      padding: 13px 14px;
      border: none;
      border-radius: 9px;
      background: var(--gulf);
      color: #06141f;
      font-family: "Manrope", sans-serif;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.02em;
      cursor: pointer;
      transition: filter 0.15s, transform 0.05s;
    }
    button:hover { filter: brightness(1.06); }
    button:active { transform: translateY(1px); }
    .msg { font-size: 13px; margin: 0 0 18px; padding: 10px 12px; border-radius: 8px; }
    .msg.error { background: rgba(229, 84, 84, 0.12); color: #ff9b9b; border: 1px solid rgba(229, 84, 84, 0.3); }
    .msg.ok { background: rgba(110, 193, 228, 0.1); color: var(--gulf); border: 1px solid rgba(110, 193, 228, 0.28); }
    .foot { margin-top: 22px; color: var(--muted); font-size: 11px; text-align: center; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <main class="card">
    <h1 class="wordmark">exotiq<span class="dot">.</span></h1>
    <p class="sub">Sales Hub</p>
    ${notice}
    <form method="post" action="/__auth" autocomplete="off">
      <input type="hidden" name="redirect" value="${redirect.replace(/"/g, "&quot;")}" />
      <label for="password">Access password</label>
      <input id="password" name="password" type="password" autofocus required autocomplete="current-password" />
      <button type="submit">Enter</button>
    </form>
    <p class="foot">Private · authorized team members only</p>
  </main>
</body>
</html>`;
}

function notConfiguredPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>exotiq · Not configured</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Montserrat:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
      background: #0A1929; color: #E8EEF4; font-family: "Montserrat", system-ui, sans-serif; }
    .card { max-width: 460px; text-align: center; border-top: 3px solid #6EC1E4;
      border: 1px solid rgba(110,193,228,0.18); border-radius: 14px; padding: 40px 32px; }
    h1 { font-family: "Manrope", sans-serif; font-weight: 800; color: #6EC1E4; font-size: 22px; margin: 0 0 14px; }
    p { color: #8aa0b2; font-size: 14px; line-height: 1.6; margin: 0; }
    code { color: #E8EEF4; background: rgba(110,193,228,0.12); padding: 2px 6px; border-radius: 5px; }
  </style>
</head>
<body>
  <main class="card">
    <h1>Site not configured</h1>
    <p>This site is not yet configured. Set the <code>SITE_PASSWORD</code> environment variable.</p>
  </main>
</body>
</html>`;
}

export default async (req: Request, context: Context): Promise<Response> => {
  const password = Netlify.env.get("SITE_PASSWORD");
  const url = new URL(req.url);

  // Fail closed: never serve content if no password is configured.
  if (!password) {
    return htmlResponse(notConfiguredPage(), 503);
  }

  // Logout route: clear the cookie and show the signed-out login page.
  if (req.method === "GET" && url.pathname === "/logout") {
    const headers = securityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    });
    return new Response(loginPage({ redirect: "/", loggedOut: true }), { status: 200, headers });
  }

  // Login submission.
  if (req.method === "POST") {
    const form = await req.formData();
    const submitted = String(form.get("password") ?? "");
    const redirect = sanitizeRedirect(String(form.get("redirect") ?? "/"));

    // Hash both sides and compare digests in constant time — never plaintext.
    const [submittedHash, expectedHash] = await Promise.all([
      sha256Hex(submitted),
      sha256Hex(password),
    ]);

    if (submitted.length > 0 && timingSafeEqual(submittedHash, expectedHash)) {
      const token = await createSessionToken(password);
      const cookie = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`;
      return new Response(null, {
        status: 303,
        headers: securityHeaders({ Location: redirect, "Set-Cookie": cookie }),
      });
    }

    return htmlResponse(
      loginPage({ redirect, error: "Incorrect password. Please try again." }),
      401,
    );
  }

  // Any other request: serve content only with a valid session.
  const token = readCookie(req, COOKIE_NAME);
  if (token && (await isValidSessionToken(token, password))) {
    const response = await context.next();
    // Edge-function paths don't pick up netlify.toml custom headers, so set them here.
    const headers = securityHeaders();
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  }

  // Unauthenticated: serve the gate, never the requested content.
  return htmlResponse(
    loginPage({ redirect: sanitizeRedirect(url.pathname + url.search) }),
    401,
  );
};

export const config: Config = {
  path: "/*",
  excludedPath: "/robots.txt",
};
