# Filly share Worker

Optional companion for the Filly add-on: a small [Cloudflare Worker](https://developers.cloudflare.com/workers/)
that publishes a **read-only, cleaned copy** of your spool collection under unguessable links,
similar to "share collection" in other spool apps. Home Assistant and Filly stay unreachable from
the internet: Filly only *sends* data out, visitors only talk to the Worker.

## What leaves your Home Assistant

Only these fields per spool, nothing else (checked in the add-on **and** again in the Worker):

| Field | Example |
|---|---|
| brand, material, subtype | SUNLU, PLA, Matte |
| colour name, colours (hex), colour mode, effect | Mint Green, `#00C7B1`, solid |
| remaining in whole percent | 55 |

Never sent: prices, purchase and storage locations, notes, weights, article numbers, AMS slots,
dates, ids, print history. Archived spools are left out.

## How it works

- One Durable Object (SQLite, available on the Workers Free plan) stores the latest snapshot,
  the links and their view counters.
- Public page: `GET /s/<id>`. The id is 128 random bits. Unknown, switched-off and expired links
  all get the same 404 page. The page is rendered on the server, with no JavaScript, cookies or
  external resources, and is marked `noindex`. Visitor IP addresses are not stored.
- Management API under `/api/*`, only with `Authorization: Bearer <PUSH_KEY>`.
  Filly calls it from its backend; the key never reaches a browser.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | key check |
| PUT | `/api/snapshot` | replace the snapshot |
| GET | `/api/links` | links with view counters |
| POST | `/api/links` | new link (`name`, `expires_at`, `hide_empty`, `lang`) |
| PATCH | `/api/links/<id>` | change name, expiry, active, hide empty, language |
| POST | `/api/links/<id>/renew` | new address, old one stops working |
| DELETE | `/api/links/<id>` | remove |

## Deploy

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
