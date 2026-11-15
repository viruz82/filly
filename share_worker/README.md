# Filly share Worker

Optional companion for the Filly add-on: a small [Cloudflare Worker](https://developers.cloudflare.com/workers/)
that publishes a **read-only, cleaned copy** of your spool collection under unguessable links,
similar to "share collection" in other spool apps. Home Assistant and Filly stay unreachable from
the internet: Filly only *sends* data out, visitors only talk to the Worker.

## What leaves your Home Assistant

Only these fields per spool, nothing else (checked in the add-on **and** again in the Worker):

| Field | Example |
|---|---|
| spool number | 38 |
| brand, material, subtype | SUNLU, PLA, Matte |
| colour name, colours (hex), colour mode, effect | Mint Green, `#00C7B1`, solid |
| remaining in whole percent | 55 |
| remaining and nominal weight in grams | 954 / 1000 |

The grams are stored in the Worker, but a link shows them only when its **Show weight** switch is on
(default on for new links; links created with 1.20.0 keep showing percent only until you switch it on).
A link can also be limited to certain **brands and materials**: the Worker applies that filter before
anything is rendered, so filtered-out spools never reach the page or its drop-downs.

Never sent: prices, purchase and storage locations, notes, article numbers, AMS slots, dates, ids,
print history. Archived spools are left out.

## How it works

- One Durable Object (SQLite, available on the Workers Free plan) stores the latest snapshot,
  the links and their view counters.
- Public page: `GET /s/<id>`. The id is 128 random bits. Unknown, switched-off and expired links
  all get the same 404 page. The page is rendered on the server, uses no cookies or external
  resources, can not be framed and is marked `noindex`. One small inline script (search field and
  drop-downs) is allowed by the Content-Security-Policy through its hash and nothing else may run;
  without it the page stays fully readable. Visitor IP addresses are not stored.
- Management API under `/api/*`, only with `Authorization: Bearer <PUSH_KEY>`.
  Filly calls it from its backend; the key never reaches a browser.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | key check |
| PUT | `/api/snapshot` | replace the snapshot |
| GET | `/api/links` | links with view counters |
| POST | `/api/links` | new link (`name`, `expires_at`, `hide_empty`, `lang`, `show_weight`, `brands`, `materials`) |
| PATCH | `/api/links/<id>` | change any of those fields and `active` |
| POST | `/api/links/<id>/renew` | new address, old one stops working |
| DELETE | `/api/links/<id>` | remove |

## Deploy

Step-by-step guide for beginners: [docs/SHARE.md](../docs/SHARE.md).

Requirements: a free Cloudflare account with a `workers.dev` subdomain, Node.js 22.12 or newer.

```sh
npm install
# API token with "Workers Scripts: Edit" for your account (or run `npx wrangler login`)
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler deploy
# a long random key, e.g. `openssl rand -base64 32`
npx wrangler secret put PUSH_KEY
```

Then, in the Filly add-on configuration, set `share_url` to the Worker address
(`https://<worker>.<subdomain>.workers.dev`) and `share_key` to the same key.

Free plan limits (Durable Objects): 100,000 requests and 100,000 written rows per day. Every page
view writes one row (the counter). When a limit is reached, requests fail until 00:00 UTC; the
Free plan does not bill.

## Development

```sh
npm test         # vitest inside the Workers runtime
npm run check    # TypeScript
npx wrangler dev # local server with a local Durable Object; put PUSH_KEY into .dev.vars
```
