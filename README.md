# WebOS

A tiny operating system that lives in your browser. Install any **static website (ZIP, folder or GitHub repo)** as an app and run it in a window — even offline.

Live at **https://webos.asf.run** · New here? Read the [User Guide](USER-GUIDE.md) (also built into WebOS under **Help**).

By **Tasmon Islam** · tasmon@outlook.com

---

## What it does

- **Installs ZIP web apps**: drop a ZIP or folder on the desktop, pick a file, or paste a GitHub link (`owner/repo`).
- **Runs them in windows**: drag, resize, snap to screen edges, minimise, maximise, full screen — or open in a browser tab.
- **Works offline** once installed. Apps and the WebOS shell are stored in your browser.
- **Each app keeps its own data**: `localStorage`, `sessionStorage` and IndexedDB are namespaced per app, so two apps never overwrite each other.
- **Installable**: add WebOS itself to your desktop or phone home screen (PWA).
- **Practical settings**: theme (auto / light / dark), accent colour, wallpapers (or your own picture), blur, animations, text size, corner style, icon size, taskbar position / auto-hide / clock format, window behaviour, PIN lock screen, backup & restore, storage protection, factory reset.
- **No server, no accounts, no tracking.** Everything stays in the browser.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt + A` | Open the start menu |
| `Alt + I` | Install an app |
| `Alt + W` | Close the active window |
| `Alt + M` | Minimise the active window |
| `Alt + D` | Show the desktop |

## Which ZIP files work?

Any ZIP that contains an `index.html` (it may sit inside a top folder, like GitHub's "Download ZIP"). Plain HTML/CSS/JS sites, and the **built** output (`dist/`, `build/`) of React / Vue / Svelte / Vite projects.

Optional: add a `webos.json` next to `index.html` to control how the app appears.

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

## Share an install link

Anyone can install an app with one click:

```
https://webos.asf.run/#install=github:owner/repo
https://webos.asf.run/#install=https://example.com/app.zip
```

---

## Deploy: GitHub + Vercel + webos.asf.run

### 1. Put the files on GitHub
1. Go to <https://github.com/new>, name the repository `webos`, keep it **Public**, click **Create repository**.
2. Click **uploading an existing file**, drag in **every file from this folder** (not the folder itself), and click **Commit changes**.

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

> HTTPS is required — service workers (which power the app installer) only run on secure sites. Vercel provides this for free.

### Updating later
Edit or upload files on GitHub — Vercel redeploys automatically. Users get the new version the next time they open WebOS online. If you add or rename files, also update the `SHELL` list at the top of `sw.js` so they work offline.

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
| `USER-GUIDE.md` | Plain-language guide for people using WebOS |

## How it works

Installed apps are stored as files in IndexedDB. The service worker answers requests to `/apps/<app-id>/…` from that storage and injects a small script into each app's HTML that namespaces its storage and exposes the `WebOS` API. Apps are shown in `<iframe>`s.

## Security note

Apps run on the **same origin** as WebOS (a static host cannot give every app its own domain), so an installed app *could* read other apps' stored data. Only install apps you trust. For stronger isolation you can host WebOS on a wildcard domain and serve each app from its own subdomain.

The PIN lock is a convenience lock, not encryption.

## Licence

MIT — see `LICENSE`. JSZip is © Stuart Knightley, MIT licensed.
