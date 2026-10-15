# PrintVentorious Kiosk

A small, plain page where a customer picks something from your print catalogue, sees a price, types an email address and sends it to you. That's it. I kept it deliberately dull.

Nothing is stored on the customer's device. No cookies, no local storage, no session. The server works the price out, holds the quote in memory for a short while, and drops the request in your inbox (and optionally a Discord/Slack/JSON webhook).

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

## Emailing customers a copy

Off unless you set `KIOSK_SMTP_URL` (for example `smtps://user:password@smtp.example.com:465`) and `KIOSK_MAIL_FROM`. When it's on, the quote screen shows a ticked "Email me a copy of this quote" box. The copy is plain text, goes once to the address the customer typed, and contains only the reference, item, price and dates. Nothing they typed freely (name, message) is ever put in it, so the form can't be used to send someone else's words to a stranger. There's a daily cap (200). The mail password lives in the environment and nowhere else. Optional `KIOSK_MAIL_REPLY_TO`.

Not tested against a real mail server. The tests use nodemailer's JSON transport and a fake, so the message building and the safety rules are checked, but whether your provider accepts the mail is something only you can find out.

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

## Not done

Payment, uploads, accounts, email sending. Each one makes a quote form into a proper security problem. 

## Licence

MIT, see `LICENSE`. The bundled fonts keep their own SIL OFL 1.1 licences (`public/fonts/licences/`). The model licences of whatever you put in your catalogue are your problem, not mine.

Author: TABARC-Code
