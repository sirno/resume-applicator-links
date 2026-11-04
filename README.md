# Resume Applicator: redirect server for link tracking

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sirno/resume-applicator-links)

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

1. In the app, open **Settings → Link tracking → Set up with Cloudflare** and create a key. The app
   makes a long random key, keeps it, and shows it once: copy it.
2. Click **Deploy to Cloudflare** above, sign in to Cloudflare (or create a free account) and paste
   the key as `API_KEY`. Cloudflare creates the Worker, named `links`, and its database.
3. Back in the app, paste the Worker's address, `https://links.<your subdomain>.workers.dev`, into
   the last step; then *Test* and *Save*.

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

## Updating

When the app needs a newer server than yours, its *Settings → Link tracking* and the *Link clicks*
card say **Your redirect server needs an update**. Until you update, the app keeps building tracked
PDFs and fetching their clicks. Either way below keeps the server's address, its key, and the links
and clicks it holds.

**Update the repository Cloudflare made.** The button created a private repository with the server's
code in your GitHub or GitLab account (the Worker's *Settings → Build* in the Cloudflare dashboard
names it), and Cloudflare deploys every commit to it. It is a copy, not a fork, so GitHub has no
*Sync fork* for it: copy this repository's files into it instead, all but `wrangler.toml`, which
names your Worker and its database. With git:

```sh
git clone <your repository's address> links && cd links
git fetch https://github.com/sirno/resume-applicator-links.git main
git checkout FETCH_HEAD -- . ':!wrangler.toml'
git commit -m "Update the redirect server" && git push
```

Without git, on GitHub's site: download this repository (*Code → Download ZIP*), and in yours choose
*Add file → Upload files* and drop in its files and folders, leaving out `wrangler.toml`.

**Or deploy it again under the same name**, by hand, from a copy of this repository. You need Node.js
20 or later:

```sh
git clone https://github.com/sirno/resume-applicator-links.git && cd resume-applicator-links
npm install
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` names the Worker `links` and its database `resume-applicator-links`. The deploy
replaces the Worker of that name and connects it to the database of that name, so the links and
clicks stay, and so does its `API_KEY`: a deploy keeps a Worker's secrets. If you gave either
another name on the deploy page, put that name into `wrangler.toml` first. A later commit to the
repository Cloudflare made deploys that repository's code again, so update it too before you commit
to it.

Then press *Test* in the app's *Settings → Link tracking*: the notice goes once the server reports a
version the app works with. (The app itself asks the server's version once a day.)

## Developing it

```sh
npm test                                          # the Worker against an in-memory D1 (node:sqlite), no Wrangler
cp .dev.vars.example .dev.vars                    # then put a key after API_KEY=
npm run dev                                       # on http://127.0.0.1:8787, which the app's Settings take as an address
```

### Changing the protocol

Servers deployed long ago keep running the code they were deployed with, so changes must leave
them, and the apps that use them, working:

- **Additive changes only**: new fields in answers, new endpoints, new optional fields in requests.
  What exists keeps its name and its meaning.
- **Anything else gets a new version**: `version` in `GET /api/status` (`VERSION` in
  `src/worker.js`) goes up, and the app keeps speaking the old protocol until users have updated.
  So does an addition the app comes to rely on, so that it can tell an older server: the app then
  raises its `MIN_SERVER_VERSION`, the oldest version it works with, and users of older servers see
  the update notice. A status without a `version` counts as 0.
- **New columns go behind a check.** The Worker creates its own tables (`CREATE TABLE IF NOT
  EXISTS`, on every API call), so there are no migrations, and a server keeps the tables it made
  when it was first used. Don't change or drop columns. Add one only after looking it up
  (`PRAGMA table_info(clicks)`), with `ALTER TABLE … ADD COLUMN`, and keep working with the rows
  that came before it, where it is empty.

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
| `GET /api/status` | `{ok, service: "resume-applicator-tracker", version, links, clicks}`; `version` is the protocol's, 1 so far |
| `PUT /api/links` with `{links: [{token, target}]}` (at most 100) | `{ok, registered, conflicts}`; 409 when a token already leads elsewhere, since a token keeps its first address |
| `GET /api/clicks?after=<id>` | `{clicks: [{id, token, at, country, network, agent}], more}`, oldest first, 1000 at a time |

## License

MIT; see [LICENSE](LICENSE).
