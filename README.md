# PrintVentorious Kiosk

A small, plain page where a customer picks something from your print catalogue, sees a price, types an email address and sends it to you. That's it. I kept it deliberately dull.

Nothing is stored on the customer's device. No cookies, no local storage, no session. The server works the price out, holds the quote in memory for a short while, and drops the request in your inbox (and optionally a Discord/Slack/JSON webhook or admin email).

It started life inside my Printventory fork, then I decided a public-facing page shouldn't live in the same process as an admin tool that can delete files. So, its own repo.

## Run it

```
npm install
npm start          # http://localhost:5080/kiosk
npm run inbox      # list what customers have sent (add --all for everything)
npm test           # unit + HTTP tests
npm run test:browser   # Playwright + axe; needs CHROMIUM_PATH pointing at a Chromium
```

`npm start` seeds six **demo** items with invented costs when the catalogue is empty. They are placeholders. Don't quote them to real people.

Environment: `PORT` (5080), `KIOSK_DB` (`./data/kiosk.db`), `KIOSK_WEBHOOK` (https only; http allowed for localhost).

## Easy read

A **Reading options** button on the page: three font choices (Inter, Atkinson Hyperlegible, Lexend, all bundled, SIL OFL), four text sizes, roomy spacing, and dark, soft cream or strong contrast colours. Plus a three step line and plain wording. Choices live in memory only and reset when the screen is left idle. No claim it fixes dyslexia, the evidence is mixed.

## What's in here

| Path | What |
| --- | --- |
| `src/kiosk-core.js` | Routes, quoting, rate limits, request store. The important bit. |
| `src/farm-cost-lib.js` | The cost maths (copy from Printventory's farm cost calculator). |
| `public/` | The customer page, plus bundled fonts (SIL OFL, licences in `public/fonts/`). |
| `server.js` | Standalone demo server. |
| `integration/printventory/` | The admin dialog and a patch for running this inside Printventory instead. |
| `docs/kiosk-quotes.md` | How it works and why. |

## Email copies

Optional: set `KIOSK_SMTP_URL` (`smtps://` on port 465 or `smtp://` with STARTTLS), `KIOSK_MAIL_FROM`, and optionally `KIOSK_MAIL_REPLY_TO`. Keep credentials in the environment. SMTP requires TLS and uses bounded connection and socket timeouts.

Customers choose whether to receive a copy; the box starts unchecked. The staff inbox shows pending, accepted by the mail server, failed, or daily limit reached. Server acceptance does not confirm inbox delivery. The default limit is 200 attempts per process per UTC day; restarting resets it. Automatic retries and a durable delivery queue are not implemented.

To notify your admin team for every new request, set `KIOSK_ADMIN_EMAILS` to up to 10 plain email addresses separated by commas. This needs the SMTP settings above. Each recipient gets a separate plain-text message containing the reference, item, estimate, customer contact, and message, with the customer's address as Reply-To. The customer does not need to request an email copy. Retries of the same quote do not notify the team again. The request inbox shows whether all team messages were accepted by the mail server or whether one failed; it does not confirm delivery to inboxes. No message is sent until you set real recipient addresses.

These environment settings are wired into the standalone `server.js` startup. An app embedding `registerRoutes` must pass its own `mailer` and `adminRecipients` options to enable the same notifications.

## Pricing checks

Quantities must be whole numbers from 1 to 100. Every printer marked in service needs a purchase price so the farm average does not silently include zero-cost machines. Mark unpriced printers out of service until their costs are entered.

## Not done

Payment, uploads, customer accounts, and automatic email retries.

## Licence

MIT, see `LICENSE`. The bundled fonts keep their own SIL OFL 1.1 licences (`public/fonts/licences/`). The model licences of whatever you put in your catalogue are your problem, not mine.

Author: TABARC-Code

