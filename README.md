# Redirect server for link tracking

The links of tracked resumes and cover letters point at this server (`app/tracking.py`), a
Cloudflare Worker with a D1 database. It forwards every click to the link's address and records
when it came, from which country and network (the organisation the IP address belongs to) and
with which browser (User-Agent). It never stores IP addresses. Cloudflare's free plan is enough
(100,000 requests a day).

It knows the tracked links' addresses and the random tokens standing for them, nothing else: not
the companies you apply to, your library or the PDFs. The app maps the tokens back to its
applications.

## Deploying it

You need Node.js 20 or later and a Cloudflare account; the free one does.

```sh
cd tracker
npm install
npx wrangler login                        # opens Cloudflare in the browser
npx wrangler d1 create resume-tracker     # put the database_id it prints into wrangler.toml
npx wrangler deploy                       # prints the address: https://resume-tracker.<you>.workers.dev
openssl rand -hex 32                      # a key, to enter in the next step and in the app
npx wrangler secret put API_KEY
```

Then in the app, **Settings → Link tracking**: enter the address and the key, *Test*, *Save*. Turn
on *Track links* in an application's *Template* card, and its PDFs are built with tracked links.

### Your own domain

With a domain on Cloudflare, links can go through a name of yours (`go.example.com`) instead of
`workers.dev`. Uncomment `routes` in `wrangler.toml`, put in the name, deploy again and enter
`https://go.example.com` in Settings. PDFs built before keep the `workers.dev` address, which keeps
working while `workers_dev = true`.

Keep the server running, and its address, for as long as the PDFs you sent may be read: their
links lead nowhere without it.

## Developing it

```sh
npm test                                     # the Worker against an in-memory D1 (node:sqlite), without wrangler
echo 'API_KEY=dev-key-0123456789' > .dev.vars
npm run dev                                  # on http://127.0.0.1:8787, which Settings takes as an address
```

## Its data

Two tables, which the Worker creates when the app first calls it: `links` (token, target,
created) and `clicks` (id, token, at, country, network, agent). To look at them or clear old clicks:

```sh
npx wrangler d1 execute resume-tracker --remote --command "SELECT COUNT(*) FROM clicks"
npx wrangler d1 execute resume-tracker --remote --command "DELETE FROM clicks WHERE at < '2026-01-01'"
```

The app keeps the clicks it fetched in `tracking.json` in its data folder, so clicks deleted here
stay in the app. Don't delete links: a link the server doesn't know answers 404.

## Its API

`/api/*` needs `Authorization: Bearer <API_KEY>`.

| Request | Answer |
|---|---|
| `GET /<token>` | 302 to the token's address, and the click is recorded; `?via=app` (the app's own window) and `HEAD` requests are not recorded |
| `GET /api/status` | `{ok, service: "resume-applicator-tracker", version, links, clicks}` |
| `PUT /api/links` with `{links: [{token, target}]}` (at most 100) | `{ok, registered, conflicts}`; 409 when a token already leads elsewhere, since a token keeps its first address |
| `GET /api/clicks?after=<id>` | `{clicks: [{id, token, at, country, network, agent}], more}`, oldest first, 1000 at a time |
