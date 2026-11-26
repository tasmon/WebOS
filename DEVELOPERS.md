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

## Project structure

| File | Purpose |
| --- | --- |
| `index.html`, `style.css` | The desktop page and all styling |
| `main.js` | Shell: desktop, taskbar, start menu, notifications, lock screen |
| `wm.js` | Window manager |
| `sw.js` | Service worker: serves installed apps from storage, works offline |
| `installer.js`, `install-ui.js` | ZIP / folder / GitHub reading, app detection, install dialog |
| `app-manager.js`, `app-settings.js`, `app-help.js`, `app-about.js` | Built-in apps |
| `db.js`, `settings.js`, `wallpaper.js`, `tile.js`, `ui.js`, `icons.js`, `pwa.js`, `config.js` | Support modules |
| `jszip.min.js` | ZIP reader (JSZip, MIT) |
| `manifest.webmanifest`, `icon*.svg/png` | PWA metadata and icons |
| `vercel.json` | Headers for Vercel |

## How it works

Installed apps are stored as files in IndexedDB. The service worker answers requests to `/apps/<app-id>/…` from that storage and injects a small script into each app's HTML that namespaces its storage and exposes the `WebOS` API. Apps are shown in `<iframe>`s.

## Security note

Apps run on the **same origin** as WebOS (a static host cannot give every app its own domain), so an installed app *could* read other apps' stored data. Only install apps you trust. For stronger isolation you can host WebOS on a wildcard domain and serve each app from its own subdomain.

The PIN lock is a convenience lock, not encryption.

---

Made by **Tasmon Islam** · tasmon@outlook.com · MIT License. JSZip is © Stuart Knightley, MIT licensed.
