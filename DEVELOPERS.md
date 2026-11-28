# WebOS for developers

This page is for people who make apps for WebOS or host their own copy. If you only want to use WebOS, read the [README](README.md).

---

## Make your app look right in WebOS

Any static site works as is. To control how it appears, add a `webos.json` file next to your `index.html`.

```json
{
  "name": "My App",
  "description": "What it does",
  "version": "1.0.0",
  "author": "You",
  "icon": "images/icon.png",
  "width": 900,
  "height": 640,
  "display": "window"
}
```

`display` can be `window`, `fullscreen` (opens maximised) or `tab` (opens in a browser tab).

Without a `webos.json`, WebOS reads the name, description and icon from `manifest.json`, `<title>`, `<meta>` and `<link rel="icon">`.

Apps can talk to WebOS through a small global API:

```js
WebOS.notify('Saved', 'Your note was saved'); // shows a notification
WebOS.setTitle('My App – Inbox');              // changes the window title
WebOS.close();                                 // closes the window
WebOS.theme; WebOS.accent;                     // current theme + accent colour
addEventListener('webos:env', e => {});        // fires when the theme changes
```

Notes for app makers:

- Root-relative URLs such as `/css/site.css` are handled: WebOS points them back inside your app.
- `localStorage`, `sessionStorage` and IndexedDB are separate for each app.
- Apps cannot register their own service worker, because WebOS already serves them.
- If your app is a single-page app, unknown paths fall back to `index.html`.

---

## Deploy: GitHub + Vercel + webos.asf.run

### 1. Put the files on GitHub
1. Go to <https://github.com/new>, name the repository `webos`, keep it **Public**, click **Create repository**.
2. Click **uploading an existing file**, drag in **every file from the project** (not the folder itself), and click **Commit changes**.

### 2. Deploy on Vercel
1. Go to <https://vercel.com/new> and import the `webos` repository.
2. **Framework Preset:** `Other`. Leave Build Command and Output Directory empty. Click **Deploy**.

### 3. Connect webos.asf.run
1. In Vercel open the project → **Settings → Domains** → type `webos.asf.run` → **Add**.
2. Vercel shows a DNS record. Where you manage the DNS for **asf.run**, add:

   | Type | Name | Value |
   | --- | --- | --- |
   | `CNAME` | `webos` | `cname.vercel-dns.com` |

3. Wait a few minutes until Vercel shows a green tick. HTTPS is automatic.

> HTTPS is required, because service workers (which power the app installer) only run on secure sites. Vercel provides this for free.

### Updating later
Edit or upload files on GitHub and Vercel redeploys automatically. Users get the new version the next time they open WebOS online. If you add or rename files, also update the `SHELL` list at the top of `sw.js` so they work offline.

To rebrand, edit `config.js` (name, author, email, domain).

---

## Set up the Store (accounts, ratings, admin)

The Store needs a small database and an admin password. It takes about 10 minutes and uses free plans.

### 1. Add the backend file to GitHub
The file **must** sit in a folder called `api`, and its name is exactly `[...route].js` (square brackets and three dots included).
1. In your GitHub repository click **Add file → Create new file**.
2. In the name box type `api/[...route].js`. Typing the `/` makes the folder.
3. Paste the full content of `[...route].js` into the editor and click **Commit changes**.

### 2. Create the database (free)
1. In Vercel open your project → **Storage** tab → **Create Database** (or **Marketplace**).
2. Choose **Upstash → Redis**, pick the free plan and a region near you, and create it.
3. When asked, **connect it to your WebOS project** (all environments). Vercel adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` variables for you.

### 3. Set your admin password
1. Vercel → your project → **Settings → Environment Variables**.
2. **Key:** `ADMIN_PASSWORD`  **Value:** a long password only you know. Tick Production, Preview and Development. Click **Save**.
3. Optional extras:
   - `GITHUB_TOKEN`: a GitHub token with no permissions (create one at <https://github.com/settings/tokens>). It makes checking submitted repositories more reliable.
   - `ADMIN_EMAIL`: only if you want a different admin email. The default is `tasmon@outlook.com`.
   - `SESSION_SECRET`: any long random text, to sign login cookies. Optional.

### 4. Redeploy
Vercel → **Deployments** → the latest one → **⋯ → Redeploy**. Variables only apply to new deployments.

### 5. Open the admin page
Go to `https://webos.asf.run/admin` and sign in with `tasmon@outlook.com` and your `ADMIN_PASSWORD`. The sign-in screen tells you if the database or the password is still missing.

### How the Store works
- Only **public GitHub repositories** with an `index.html` (or a built `dist`/`build`/`docs` folder) can be listed.
- People need a free WebOS account to send a request. They pick security questions so they can reset a forgotten password. There is no email service, so emails are not verified.
- New requests wait in **Waiting**. Use **Test install** to try the app, then **Approve** or **Reject**.
- The publisher name comes from the GitHub profile of the repository owner.
- Downloads are counted once per person per app per day. Only signed-in accounts can rate and comment, and you can delete any comment in **Published → Reviews**.
- People can also email you for a listing; add those apps yourself with **Add app**.
- **Only approve apps you have looked at.** Apps share one origin with WebOS (see the security note below).

---

## Project structure

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | The desktop page and all styling |
| `main.js` | Shell: desktop, taskbar, start menu, notifications, lock screen |
| `wm.js` | Window manager |
| `sw.js` | Service worker: serves installed apps from storage, works offline |
| `installer.js`, `install-ui.js` | ZIP / folder / GitHub reading, app detection, install dialog |
| `app-manager.js`, `app-settings.js`, `app-help.js`, `app-about.js`, `app-store.js` | Built-in apps |
| `app-browser.js`, `app-media.js`, `app-pdf.js`, `app-tetris.js` | Browser, Media Player, PDF Reader, Tetris |
| `web-apps.js` | Web shortcuts (apps that open a website) |
| `store-api.js` | Browser side of the Store API |
| `api/index.js` | The Store backend (one Vercel function: accounts, listings, reviews, admin) |
| `admin.html`, `admin.js`, `admin.css` | Admin dashboard at `/admin` |
| `db.js`, `settings.js`, `wallpaper.js`, `tile.js`, `ui.js`, `icons.js`, `pwa.js`, `config.js` | Support modules |
| `jszip.min.js` | ZIP reader (JSZip, MIT) |
| `pdf.min.js`, `pdf.worker.min.js` | PDF engine (pdf.js 3.11.174, Apache-2.0), loaded only when PDF Reader opens |
| `manifest.webmanifest`, `icon*.svg/png` | PWA metadata and icons |
| `vercel.json` | Headers for Vercel |

## How it works

Installed apps are stored as files in IndexedDB. The service worker answers requests to `/apps/<app-id>/…` from that storage and injects a small script into each app's HTML that namespaces its storage and exposes the `WebOS` API. Apps are shown in `<iframe>`s.

## Security note

Apps run on the **same origin** as WebOS (a static host cannot give every app its own domain), so an installed app *could* read other apps' stored data. Only install apps you trust. For stronger isolation you can host WebOS on a wildcard domain and serve each app from its own subdomain.

The PIN lock is a convenience lock, not encryption.

---

Made by **Tasmon Islam** · tasmon@outlook.com · MIT License. JSZip is © Stuart Knightley, MIT licensed.
