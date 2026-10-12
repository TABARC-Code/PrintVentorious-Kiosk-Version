# PrintVentorious Kiosk

A small, plain page where a customer picks something from your print catalogue, sees a price, types an email address and sends it to you. That's it. I kept it deliberately dull.

Nothing is stored on the customer's device. No cookies, no local storage, no session. The server works the price out, holds the quote in memory for a short while, and drops the request in your inbox (and optionally a Discord/Slack/JSON webhook).

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

## Not done

Payment, uploads, accounts, email sending. Each one makes a quote form into a proper security problem. Also: no LICENSE file yet, that's my call to make, so treat it as all rights reserved until I do.

Author: TABARC-Code
