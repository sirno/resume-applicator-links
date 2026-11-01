# Resume Applicator: redirect server for link tracking

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/resume-applicator-links)

Resume Applicator can track the links of the resumes and cover letters it builds. With this server,
every link in a document's header points here first: the server counts the click and forwards it to
the link's address, and the app shows the clicks per application. It runs as a Cloudflare Worker,
with a D1 database, in **your own** Cloudflare account; the free plan is enough (100,000 requests a
day).

It records when each click came, from which country and network (the organisation the IP address
belongs to) and with which browser (User-Agent), never the IP address. It knows the tracked links'
addresses and the random tokens standing for them, nothing else: not the companies you apply to,
your library or the PDFs. The app maps the tokens back to its applications.

## Deploying it with the button

1. Make a key, a long random text only you know: `openssl rand -hex 32` prints one.
2. Click **Deploy to Cloudflare** above, sign in to Cloudflare (or create a free account) and paste
   the key as `API_KEY`. Cloudflare creates the Worker, named `links`, and its database.
3. In the app, open **Settings → Link tracking** and enter the Worker's address,
   `https://links.<your subdomain>.workers.dev`, and the key; then *Test* and *Save*.

Turn on *Track links* in an application's *Template* card, and its PDFs are built with tracked links.

## Deploying it by hand

You need Node.js 20 or later. In this folder:

```sh
npm install
npx wrangler login                 # opens Cloudflare in the browser
npx wrangler deploy                # creates the database; prints https://links.<your subdomain>.workers.dev
npx wrangler secret put API_KEY    # the key from the app, or one of your own: openssl rand -hex 32
```

The first deploy writes the new database's `database_id` into `wrangler.toml`. Keep it out of a
repository other people deploy from: their deploys would point at a database they can't reach.

### Your own domain

With a domain on Cloudflare, links can go through a name of yours (`go.example.com`) instead of
`workers.dev`. Uncomment `routes` in `wrangler.toml`, put in the name, deploy again and enter
`https://go.example.com` in the app's Settings. PDFs built before keep the `workers.dev` address, which
keeps working while `workers_dev = true`.

Keep the server running, and its address, for as long as the PDFs you sent may be read: their links
lead nowhere without it.

## Developing it

```sh
npm test                                          # the Worker against an in-memory D1 (node:sqlite), no Wrangler
cp .dev.vars.example .dev.vars                    # then put a key after API_KEY=
npm run dev                                       # on http://127.0.0.1:8787, which the app's Settings take as an address
```

Changes to the protocol add fields or endpoints and keep the old ones; `GET /api/status` reports
the protocol's `version`, which a change that can't keep them raises.

## Its data

Two tables, which the Worker creates when the app first calls it: `links` (token, target, created)
and `clicks` (id, token, at, country, network, agent). To look at them or clear old clicks:

```sh
npx wrangler d1 execute resume-applicator-links --remote --command "SELECT COUNT(*) FROM clicks"
npx wrangler d1 execute resume-applicator-links --remote --command "DELETE FROM clicks WHERE at < '2026-01-01'"
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
