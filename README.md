# PrintVentorious Kiosk

A small, plain page where a customer picks something from your print catalogue, sees a price, types an email address and sends it to you. That's it. I kept it deliberately dull.

Nothing is stored on the customer's device. No cookies, no local storage, no session. The server works the price out, holds the quote in memory for a short while, and drops the request in your inbox (and optionally a Discord/Slack/JSON webhook or admin email).

It started life inside my Printventory fork, then I decided a public-facing page shouldn't live in the same process as an admin tool that can delete files. So, its own repo.

## Run it

```
npm install
npm start          # http://localhost:5080/kiosk
npm run inbox      # list what customers have sent (add --all for everything)
npm test           # unit + HTTP tests (customer side, admin side, mailer)
npm run test:browser   # Playwright + axe on both pages; needs CHROMIUM_PATH pointing at a Chromium (CI installs its own)
```

`npm start` seeds six **demo** items with invented costs when the catalogue is empty. They are placeholders. Don't quote them to real people.

Environment: `PORT` (5080), `KIOSK_DB` (`./data/kiosk.db`), `KIOSK_WEBHOOK` (https only; http allowed for localhost).

## The shop side (admin page)

`npm start` also starts an admin page on **http://localhost:5081/**. Prices, items (with a picture and a "how big is it" line), settings, and the requests customers have sent, all in plain words. It has the same reading options as the customer page (easy-read, wide and open, or standard letters; four sizes; cream, dark or strong contrast).

It's a separate server from the customer page, on purpose, because it can see email addresses and change prices:

- **Loopback only by default.** To reach it from another machine set `KIOSK_ADMIN_HOST`, and then `KIOSK_ADMIN_TOKEN` (12+ characters) is mandatory. Without it the admin page simply doesn't start.
- **Token on every call**, sent as a header. No cookies. A random token is made and printed at start-up unless you set `KIOSK_ADMIN_TOKEN`. The page keeps it in memory only, so a reload asks again.
- Host header and Origin checks (against a hostile website talking to your localhost), and ten wrong tries a minute per address before it refuses everything from that address.
- It is **not** safe to put on the open internet as it stands. If you want that, put TLS and a proper login in front. I haven't built either and I'm not pretending.

Settings: `KIOSK_ADMIN_PORT` (5081), `KIOSK_ADMIN_HOST` (127.0.0.1), `KIOSK_ADMIN_TOKEN`, `KIOSK_ADMIN_ALLOWED_HOSTS` (comma-separated extra host names).

## Putting the customer page on the internet

Only the customer page should ever be public. Keep the admin page on localhost and put a reverse proxy in front of the customer side that forwards just `/kiosk`, `/kiosk/*` and `/api/kiosk/*`. A Caddy sketch (**not tested by me**, check it against Caddy's own docs):

```
shop.example.com {
    @public path /kiosk /kiosk/* /api/kiosk/*
    handle @public { reverse_proxy 127.0.0.1:5080 }
    handle { respond "Not found" 404 }
}
```

Then start the server with `KIOSK_TRUST_PROXY=1`. Without it, every customer arrives from the proxy's address and the per-address limits (five requests in ten minutes) apply to the whole shop at once. With it set and no proxy actually in front, anyone can fake the header to dodge those limits, so only set it if a proxy really is there. TLS comes from the proxy; customers' email addresses should never cross the internet in plain text.

## Backups

`npm run backup` writes a safe copy to `data/backups/` using SQLite's own backup (safe while the server runs; copying the file by hand in WAL mode can miss recent data). It's owner-only because it holds email addresses, and backups are not covered by the retention clean-up, so look after them.

## Easy read

A **Reading options** button on the page: three font choices (Inter, Atkinson Hyperlegible, Lexend, all bundled, SIL OFL), four text sizes, roomy spacing, and dark, soft cream or strong contrast colours. Plus a three step line and plain wording. Choices live in memory only and reset when the screen is left idle. No claim it fixes dyslexia, the evidence is mixed.

## What's in here

| Path | What |
| --- | --- |
| `src/kiosk-core.js` | Routes, quoting, rate limits, request store. The important bit. |
| `src/farm-cost-lib.js` | The cost maths (copy from Printventory's farm cost calculator). |
| `public/` | The customer page, plus bundled fonts (SIL OFL, licences in `public/fonts/`). |
| `admin/`, `src/admin.js` | The shop-owner page and its API. |
| `src/mailer.js` | The tiny optional mailer for the emailed copy. |
| `server.js` | Standalone demo server. |
| `integration/printventory/` | The admin dialog and a patch for running this inside Printventory instead. |
| `docs/kiosk-quotes.md` | How it works and why. |

## Email

Optional: set `KIOSK_SMTP_URL` (`smtps://` on port 465 or `smtp://` with STARTTLS), `KIOSK_MAIL_FROM`, and optionally `KIOSK_MAIL_REPLY_TO`. Keep credentials in the environment. SMTP requires TLS and uses bounded connection and socket timeouts.

Customers choose whether to receive a copy; the box starts unchecked. The staff inbox shows pending, accepted by the mail server, failed, or daily limit reached. Server acceptance does not confirm inbox delivery. The default limit is 200 attempts per process per UTC day; restarting resets it. Automatic retries and a durable delivery queue are not implemented.

The mail tests use a fake transport. Whether a real provider accepts and delivers mail depends on its configuration.

To notify your admin team for every new request, set `KIOSK_ADMIN_EMAILS` to up to 10 plain email addresses separated by commas. This needs the SMTP settings above. Each recipient gets a separate plain-text message containing the reference, item, estimate, customer contact, and message, with the customer's address as Reply-To. The customer does not need to request an email copy. Retries of the same quote do not notify the team again. The request inbox shows whether all team messages were accepted by the mail server or whether one failed; it does not confirm delivery to inboxes. No message is sent until you set real recipient addresses.

These environment settings are wired into the standalone `server.js` startup. An app embedding `registerRoutes` must pass its own `mailer` and `adminRecipients` options to enable the same notifications.

## Pricing checks

Quantities must be whole numbers from 1 to 100. Every printer marked in service needs a purchase price so the farm average does not silently include zero-cost machines. Mark unpriced printers out of service until their costs are entered.

## Not done

Payment, uploads, customer accounts, and automatic email retries.

## Licence

MIT, see `LICENSE`. The bundled fonts keep their own SIL OFL 1.1 licences (`public/fonts/licences/`). The model licences of whatever you put in your catalogue are your problem, not mine.

Author: TABARC-Code

