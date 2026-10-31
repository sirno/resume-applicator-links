// The Worker against an in-memory D1 (node:sqlite behind D1's API), without wrangler: node --test
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";

import worker from "../src/worker.js";

class Statement {
  constructor(db, sql, args = []) { Object.assign(this, { db, sql, args }); }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { this.db.prepare(this.sql).run(...this.args); return { success: true }; }
}

class FakeD1 {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) { return Promise.all(statements.map((s) => s.all())); }
}

const KEY = "test-key-0123456789";
const TOKEN = "abcdefghijklmnop";
let env, pending;

beforeEach(() => {
  env = { DB: new FakeD1(), API_KEY: KEY };
  pending = [];
});

async function call(path, { method = "GET", body, key = KEY, agent, cf } = {}) {
  const headers = {};
  if (key) headers.Authorization = `Bearer ${key}`;
  if (agent) headers["User-Agent"] = agent;
  if (body) headers["Content-Type"] = "application/json";
  const request = new Request(`https://go.example.com${path}`, { method, headers,
    body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  if (cf) Object.defineProperty(request, "cf", { value: cf });
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

const register = (links) => call("/api/links", { method: "PUT", body: { links } });
const clicks = async (after = 0) => (await call(`/api/clicks?after=${after}`)).json();

test("the API needs the key", async () => {
  assert.equal((await call("/api/status", { key: null })).status, 401);
  assert.equal((await call("/api/status", { key: KEY + "x" })).status, 401);
  assert.equal((await call("/api/status", { key: KEY.slice(0, -1) })).status, 401);
  assert.deepEqual(await (await call("/api/status")).json(),
    { ok: true, service: "resume-applicator-tracker", version: 1, links: 0, clicks: 0 });
  delete env.API_KEY;
  const r = await call("/api/status");
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /API_KEY/);
});

test("a registered link forwards and records the click, without the IP address", async () => {
  assert.equal((await call(`/${TOKEN}`)).status, 404); // before any link: no tables yet
  let r = await register([{ token: TOKEN, target: "https://github.com/alex-example" }]);
  assert.deepEqual(await r.json(), { ok: true, registered: 1, conflicts: [] });

  r = await call(`/${TOKEN}`, { key: null, agent: "Mozilla/5.0 Firefox/130.0",
    cf: { country: "CH", asOrganization: "Swisscom (Schweiz) AG", clientTcpRtt: 3 } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://github.com/alex-example");
  assert.equal(r.headers.get("Cache-Control"), "no-store");

  const { clicks: got, more } = await clicks();
  assert.equal(more, false);
  assert.equal(got.length, 1);
  const { at, ...rest } = got[0];
  assert.deepEqual({ ...rest }, { id: 1, token: TOKEN, country: "CH", network: "Swisscom (Schweiz) AG",
    agent: "Mozilla/5.0 Firefox/130.0" });
  assert.ok(Math.abs(Date.parse(at) - Date.now()) < 5000);
});

test("the app's own clicks and HEAD requests forward without being recorded", async () => {
  await register([{ token: TOKEN, target: "https://example.com/?utm_campaign=acme" }]);
  let r = await call(`/${TOKEN}?via=app`, { key: null });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("Location"), "https://example.com/?utm_campaign=acme");
  r = await call(`/${TOKEN}`, { method: "HEAD", key: null });
  assert.equal(r.status, 302);
  assert.deepEqual((await clicks()).clicks, []);
  assert.equal((await call(`/${TOKEN}`, { method: "POST", key: null })).status, 405);
});

test("unknown and malformed tokens are not found", async () => {
  await register([{ token: TOKEN, target: "https://example.com" }]);
  for (const path of ["/", "/zzzzzzzzzzzzzzzz", `/${TOKEN.toUpperCase()}`, `/${TOKEN}/x`, "/favicon.ico", "/abc"]) {
    assert.equal((await call(path, { key: null })).status, 404, path);
  }
  assert.deepEqual((await clicks()).clicks, []);
});

test("a token keeps its first address", async () => {
  await register([{ token: TOKEN, target: "https://example.com/a" }]);
  let r = await register([{ token: TOKEN, target: "https://example.com/a" }]); // again: fine
  assert.equal(r.status, 200);
  r = await register([{ token: "qrstuvwxyz234567", target: "https://example.com/b" },
    { token: TOKEN, target: "https://evil.example/" }]);
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).conflicts, [TOKEN]);
  assert.equal((await call(`/${TOKEN}`, { key: null })).headers.get("Location"), "https://example.com/a");
  assert.equal((await call("/qrstuvwxyz234567", { key: null })).headers.get("Location"), "https://example.com/b");
});

test("registering checks tokens and addresses", async () => {
  for (const links of [null, "x", [{ token: "short", target: "https://example.com" }],
    [{ token: TOKEN, target: "javascript:alert(1)" }], [{ token: TOKEN, target: "mailto:a@example.com" }],
    [{ token: TOKEN, target: "https://" + "x".repeat(2100) }], [{ token: TOKEN }],
    Array.from({ length: 101 }, () => ({ token: TOKEN, target: "https://example.com" }))]) {
    assert.equal((await call("/api/links", { method: "PUT", body: { links } })).status, 400, JSON.stringify(links)?.slice(0, 80));
  }
  assert.equal((await register([])).status, 200);
});

test("clicks come in pages, after the last one fetched", async () => {
  await register([{ token: TOKEN, target: "https://example.com" }]);
  for (let i = 0; i < 3; i++) await call(`/${TOKEN}`, { key: null });
  const all = await clicks();
  assert.deepEqual(all.clicks.map((c) => c.id), [1, 2, 3]);
  assert.deepEqual((await clicks(2)).clicks.map((c) => c.id), [3]);
  assert.deepEqual((await clicks(3)).clicks, []);
  assert.deepEqual((await call("/api/clicks?after=junk").then((r) => r.json())).clicks.length, 3);
  const st = await (await call("/api/status")).json();
  assert.equal(st.links, 1);
  assert.equal(st.clicks, 3);
});

test("unknown API routes are 404", async () => {
  assert.equal((await call("/api/nothing")).status, 404);
  assert.equal((await call("/api/links")).status, 404); // GET
});
