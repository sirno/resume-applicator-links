// Resume Applicator's redirect server, a Cloudflare Worker with a D1 database (see README.md).
//
// GET /<token>        forwards to the address the app registered for the token (302) and records
//                     the click: time, country, network (the ASN's organisation) and User-Agent,
//                     never the IP address. ?via=app (the app's own window) forwards without
//                     recording; HEAD requests are not recorded either.
// GET /api/status     {ok, links, clicks}: the app's Test button
// PUT /api/links      {links: [{token, target}]}: tokens the app is about to put into a PDF. A
//                     token keeps the address it was first registered with; one registered with
//                     another address is a conflict (409).
// GET /api/clicks     ?after=<id>: the clicks after that one, oldest first, {clicks, more}
//
// /api/* needs "Authorization: Bearer <API_KEY>", the Worker's secret.

const TOKEN = /^[a-z2-7]{12,32}$/; // the app's tokens: base32, lower case
const MAX_TARGET = 2048;
const MAX_LINKS = 100; // per PUT; D1 binds at most 100 values per statement
const PAGE = 1000; // clicks per GET

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, target TEXT NOT NULL, created TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS clicks (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT NOT NULL, "
    + "at TEXT NOT NULL, country TEXT, network TEXT, agent TEXT)",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return await api(request, env, url);
      return await follow(request, env, ctx, url);
    } catch (err) {
      console.error(err);
      return text(500, "Something went wrong.");
    }
  },
};

async function follow(request, env, ctx, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return text(405, "Method not allowed.", { Allow: "GET, HEAD" });
  }
  const token = url.pathname.slice(1);
  if (!TOKEN.test(token)) return text(404, "This link is not known.");
  let row = null;
  try {
    row = await env.DB.prepare("SELECT target FROM links WHERE token = ?").bind(token).first();
  } catch (err) { // there are no tables before the app registers its first links
    if (!/no such table/.test(err.message)) console.error(err);
  }
  if (!row) return text(404, "This link is not known.");
  if (request.method === "GET" && url.searchParams.get("via") !== "app") {
    const cf = request.cf || {};
    const agent = (request.headers.get("User-Agent") || "").slice(0, 300) || null;
    ctx.waitUntil(env.DB.prepare("INSERT INTO clicks (token, at, country, network, agent) VALUES (?, ?, ?, ?, ?)")
      .bind(token, new Date().toISOString(), cf.country || null, cf.asOrganization || null, agent).run()
      .catch((err) => console.error(err)));
  }
  // no-store: every click reaches the Worker, none is answered from a cache
  return new Response(null, { status: 302, headers: {
    Location: row.target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}

async function api(request, env, url) {
  if (!env.API_KEY) return json(500, { error: "the server has no API_KEY: set it with `npx wrangler secret put API_KEY`" });
  if (!authorized(request, env.API_KEY)) return json(401, { error: "the key is wrong or missing" });
  await env.DB.batch(SCHEMA.map((sql) => env.DB.prepare(sql)));
  const route = `${request.method} ${url.pathname}`;
  if (route === "GET /api/status") return status(env);
  if (route === "PUT /api/links") return register(request, env);
  if (route === "GET /api/clicks") return clicks(env, url);
  return json(404, { error: `no ${route}` });
}

// the same time for a key of any length: no byte of it can be guessed from how long a refusal takes
function authorized(request, key) {
  const header = request.headers.get("Authorization") || "";
  const given = new TextEncoder().encode(header.startsWith("Bearer ") ? header.slice(7) : "");
  const wanted = new TextEncoder().encode(key);
  let diff = given.length ^ wanted.length;
  for (let i = 0; i < wanted.length; i++) diff |= (given[i] ?? 0) ^ wanted[i];
  return diff === 0;
}

async function status(env) {
  const [links, clicks] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS n FROM links"), env.DB.prepare("SELECT COUNT(*) AS n FROM clicks")]);
  return json(200, { ok: true, service: "resume-applicator-tracker", version: 1,
    links: links.results[0].n, clicks: clicks.results[0].n });
}

function validTarget(target) {
  if (typeof target !== "string" || target.length > MAX_TARGET || !/^https?:\/\//i.test(target)) return false;
  try {
    new URL(target);
    return true;
  } catch {
    return false;
  }
}

async function register(request, env) {
  const body = await request.json().catch(() => null);
  const links = body?.links;
  if (!Array.isArray(links) || links.length > MAX_LINKS) {
    return json(400, { error: `links must be a list of at most ${MAX_LINKS} links` });
  }
  for (const link of links) {
    if (typeof link?.token !== "string" || !TOKEN.test(link.token)) return json(400, { error: "a token is malformed" });
    if (!validTarget(link.target)) return json(400, { error: `the address of ${link.token} is not a web address` });
  }
  if (!links.length) return json(200, { ok: true, registered: 0, conflicts: [] });
  const now = new Date().toISOString();
  await env.DB.batch(links.map((link) => env.DB.prepare(
    "INSERT INTO links (token, target, created) VALUES (?, ?, ?) ON CONFLICT(token) DO NOTHING")
    .bind(link.token, link.target, now)));
  const held = await env.DB.prepare(`SELECT token, target FROM links WHERE token IN (${links.map(() => "?").join(",")})`)
    .bind(...links.map((link) => link.token)).all();
  const target = Object.fromEntries(held.results.map((row) => [row.token, row.target]));
  const conflicts = links.filter((link) => target[link.token] !== link.target).map((link) => link.token);
  return json(conflicts.length ? 409 : 200, { ok: !conflicts.length, registered: links.length - conflicts.length,
    conflicts, ...(conflicts.length ? { error: `${conflicts.length} token(s) already lead elsewhere` } : {}) });
}

async function clicks(env, url) {
  const after = Math.max(0, Number.parseInt(url.searchParams.get("after") || "0", 10) || 0);
  const rows = await env.DB.prepare(
    "SELECT id, token, at, country, network, agent FROM clicks WHERE id > ? ORDER BY id LIMIT ?")
    .bind(after, PAGE + 1).all();
  return json(200, { clicks: rows.results.slice(0, PAGE), more: rows.results.length > PAGE });
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

function text(status, body, headers = {}) {
  return new Response(body, { status, headers: {
    "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...headers } });
}
