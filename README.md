# Resume Applicator: redirect server for link tracking

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sirno/resume-applicator-links)

Resume Applicator can track the links of the resumes and cover letters it builds. With this server,
every link in a document's header points here first: the server counts the click and forwards it to
the link's address, and the app shows the clicks per application. It runs as a Cloudflare Worker,
with a D1 database, in **your own** Cloudflare account. The free plan is plenty for one person: it
takes 100,000 requests a day, and a click is one.

It records when each click came, from which country and network and with which browser, never the IP
address: see [What it stores](#what-it-stores).

## Deploying it with the button

You need a Cloudflare account, on the free plan or any other, and a GitHub or GitLab account.
Cloudflare gets access to the latter, creates a private repository there with this code, and deploys
the Worker from it. Without such an account, or to give Cloudflare no access to it, [deploy it by
hand](#deploying-it-by-hand).

1. In the app, open **Settings → Link tracking → Set up with Cloudflare** and choose *Create key*.
   The app makes a long random key, keeps it, and shows it once: copy it.
2. Choose *Open Cloudflare* in the app, or **Deploy to Cloudflare** above: both open the same page.
   Sign in to Cloudflare, or create an account, and connect your GitHub or GitLab account. Paste the
   key as `API_KEY`, keep the other settings, and deploy. Cloudflare creates the Worker, named
   `links`, and its database, `resume-applicator-links`.
3. Open the Worker in the Cloudflare dashboard: its page shows its address,
   `https://links.<your subdomain>.workers.dev`. Paste it into the app's last step, then *Test* and
   *Save*. To use [your own domain](#your-own-domain), set it up first and paste its address instead.

Then turn on **Track links** in an application's *Template* card. Its resume and cover letter are
built again, with links through the server, and its *Link clicks* card shows their clicks.

When *Test* doesn't pass:

- **The redirect server refused the key**: the Worker has another `API_KEY`. In the Cloudflare
  dashboard, open the Worker, then *Settings → Variables and Secrets*, and set `API_KEY` to the key
  of step 1. If you no longer have that key, choose *Create another key* in the app first.
- **The redirect server answered 500 … has no API_KEY**: set it, as above.
- **Could not be reached**, or **not the app's redirect server**: check the address.

If your account already has a Worker named `links`, give this one another name on the deploy page.
Its address then starts with that name.

Keep the Worker for as long as the PDFs you sent may be read: their links lead to it, so deleting
it, or the Cloudflare account, breaks them. *Remove* in the app's Settings only stops PDFs built
from then on from using it.

## Deploying it by hand

With a Cloudflare account alone, from your computer. You need Node.js 20 or later.

1. **A key.** Let the app make one: **Settings → Link tracking → Set up with Cloudflare → Create
   key**, and copy it. Or make your own, such as with `openssl rand -hex 32`.
2. **Deploy** from a copy of this repository (in Resume Applicator's own repository, it is the
   `tracker/` folder):

   ```sh
   git clone https://github.com/sirno/resume-applicator-links.git && cd resume-applicator-links
   npm install
   npx wrangler login                 # opens Cloudflare in the browser
   npx wrangler deploy                # creates the database; prints https://links.<your subdomain>.workers.dev
   npx wrangler secret put API_KEY    # asks for the key of step 1
   ```

3. **Connect the app.** With the app's key, paste the address into the last step of *Set up with
   Cloudflare*, skipping its deploy page, then *Test* and *Save*. With a key of your own, choose *I
   have a server*, enter the address and the key, then *Test* and *Save*.

The first deploy writes the new database's `database_id` into `wrangler.toml`. Keep it out of a
repository other people deploy from: their deploys would point at a database they can't reach.

## Your own domain

Links can go through a name of yours, such as `go.example.com`, instead of
`links.<your subdomain>.workers.dev`. The domain must be on Cloudflare, in the same account. The
server needs a host name to itself: the app takes any `https://` address, but without a path, and
the Worker reads the token from the whole path.

Give the Worker the name in `wrangler.toml`, where a commented-out `routes` line is ready, in one
of two ways:

- **A custom domain**, the simpler: Cloudflare creates the DNS record and the certificate.

  ```toml
  routes = [{ pattern = "go.example.com", custom_domain = true }]
  ```

- **A route**, for a host whose DNS record you keep yourself, proxied by Cloudflare. It must cover
  the whole host: a route under a path of another site, such as `example.com/go/*`, doesn't work.

  ```toml
  routes = [{ pattern = "go.example.com/*", zone_name = "example.com" }]
  ```

With the button, change `wrangler.toml` in the repository Cloudflare made (on GitHub's or GitLab's
site, if you like) and commit it: Cloudflare deploys the commit. By hand, change it in your copy and
run `npx wrangler deploy`. The Worker's *Settings → Domains & Routes* in the dashboard can add a
domain too, but put it into `wrangler.toml` as well, so that later deploys keep it.

PDFs built before keep their `workers.dev` links, which keep working while `wrangler.toml` says
`workers_dev = true`.

**Then give the app the new address.** If it is connected to the server already, choose *Remove*
in its *Settings → Link tracking*, which forgets the key too, and connect it again:

- with a key the app made: *Set up with Cloudflare → Create key*, and give the Worker the new key
  (in the dashboard, the Worker's *Settings → Variables and Secrets*, `API_KEY`). Skip the deploy
  page, and paste the new address into the last step;
- with a key of your own: *I have a server*, with the new address and the same key.

The links and clicks stay, on the server and in the app, and no click is counted twice.

## Updating

When the app needs a newer server than yours, its *Settings → Link tracking* and the *Link clicks*
card say **Your redirect server needs an update**. Until you update, the app keeps building tracked
PDFs and fetching their clicks. Either way below keeps the server's address, its key, and the links
and clicks it holds.

**Update the repository Cloudflare made.** The button created a private repository with the server's
code in your GitHub or GitLab account (the Worker's *Settings → Build* in the Cloudflare dashboard
names it), and Cloudflare deploys every commit to it. It is a copy, not a fork, so GitHub has no
*Sync fork* for it: copy this repository's files into it instead, all but `wrangler.toml`, which
names your Worker, its database and your own domain, if you gave it one. With git:

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
another name on the deploy page, put that name into `wrangler.toml` first, and your own domain's
`routes` too, if you gave it one. A later commit to the repository Cloudflare made deploys that
repository's code again, so update it too before you commit to it.

Then press *Test* in the app's *Settings → Link tracking*: the notice goes once the server reports a
version the app works with. (The app itself asks the server's version once a day.)

## What it stores

Two tables in its D1 database, which the Worker creates when the app first calls it
(`src/worker.js`):

| Table | Column | What it holds |
|---|---|---|
| `links` | `token` | 16 characters standing for one link of one document, which the app derives under a secret only it holds |
| | `target` | the address the token leads to. Links to your own sites (website, portfolio, blog) carry their utm tags, whose `utm_campaign` is the application's id, made from the company and role |
| | `created` | when the app registered it |
| `clicks` | `id` | a number counting up: the app asks for the clicks after the last one it has |
| | `token` | the link followed |
| | `at` | when, in UTC |
| | `country` | the country Cloudflare places the visitor in, as a two-letter code |
| | `network` | the organisation the visitor's IP address belongs to, such as an internet provider or a company |
| | `agent` | the browser's User-Agent, its first 300 characters |

It stores no IP addresses, no referrers and no cookies. Your own clicks in the app's window (they
carry `?via=app`) and `HEAD` requests are forwarded without being recorded. The app sends it nothing
but the links above: not your library, the PDFs, or anything else about the applications.

Cloudflare runs the Worker, so it sees each request, as any host would. `wrangler.toml` turns on the
Worker's logs (`[observability]`), which keep a record of each request, as Cloudflare saw it, in the
dashboard for a few days. Set `enabled = false` there to turn them off.

To look at the tables or clear old clicks, use the database's *Console* in the Cloudflare dashboard
(*D1*, `resume-applicator-links`), or Wrangler:

```sh
npx wrangler d1 execute resume-applicator-links --remote --command "SELECT COUNT(*) FROM clicks"
npx wrangler d1 execute resume-applicator-links --remote --command "DELETE FROM clicks WHERE at < '2026-01-01'"
```

The app keeps the clicks it fetched in `tracking.json` in its data folder, so clicks deleted here
stay in the app. Don't delete links: a link the server doesn't know answers 404.

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
