# Using this inside Printventory

Mostly you don't want to. The standalone server in the repo root is safer, because the public page and the admin tool stay in separate processes.

But if you do: `printventory-integration.patch` is what I changed in my Printventory fork (`TABARC-Code/Printventoriuos`) to mount the kiosk routes and add the admin IPC. It was made against fork commit `97c8889`, so it may need nudging on anything newer. Copy `src/*.js`, `public/*` and the three files in this folder across first, then `git apply --3way`.

`kiosk-admin.*` is the "Quote requests" dialog. The smoke test needs a Printventory checkout, so it won't run from here.

Author: TABARC-Code
