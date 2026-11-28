<div align="center">

<img src="icon-192.png" alt="WebOS logo" width="96" height="96">

# WebOS

**A tiny operating system that lives in your browser.**
Install websites as apps, open them in windows, and use them even offline.

[![Open WebOS](https://img.shields.io/badge/Open-webos.asf.run-4f7cff?style=for-the-badge&logo=googlechrome&logoColor=white)](https://webos.asf.run)

[![Runs in the browser](https://img.shields.io/badge/runs%20in-your%20browser-4f7cff?style=flat-square)](https://webos.asf.run)
[![Works offline](https://img.shields.io/badge/works-offline-22c55e?style=flat-square)](#-works-offline)
[![Installable PWA](https://img.shields.io/badge/installable-PWA-8b5cf6?style=flat-square)](#-install-webos-itself)
[![No account](https://img.shields.io/badge/account-optional-14b8a6?style=flat-square)](#-privacy)
[![No tracking](https://img.shields.io/badge/no-tracking-f59e0b?style=flat-square)](#-privacy)
[![Hosted on Vercel](https://img.shields.io/badge/hosted%20on-Vercel-000000?style=flat-square&logo=vercel&logoColor=white)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-64748b?style=flat-square)](LICENSE)

</div>

---

## What is WebOS?

WebOS gives you a desktop inside your web browser. You can take any static website, the kind people upload to GitHub as a ZIP, and **install it as an app**. It gets its own icon on your desktop, opens in its own window, and keeps working without internet.

Use it to:

- Keep your favourite small web tools, games and utilities in one place.
- Try a website or project from GitHub in seconds, with no setup.
- Carry your apps to any device by backing them up in a single file.
- Run your own HTML projects like real apps.

**Open it now: [webos.asf.run](https://webos.asf.run)**

---

## ✨ What you can do

| | |
| --- | --- |
| 🛍️ **Store** | Browse approved GitHub apps, see ratings, downloads and comments, and install in one tap |
| 🌐 **Built-in apps** | Browser, Media Player, PDF Reader and Tetris, ready to use |
| 🔗 **Web shortcuts** | Turn any website into an app icon that opens in a window |
| 📦 **Install apps** | From a ZIP file, a folder, a GitHub link, or a web address |
| 🪟 **Use windows** | Move, resize, snap to screen edges, minimise, maximise |
| 🖥️ **A real desktop** | Icons, taskbar, start menu with search, notifications, calendar |
| ✋ **Arrange your icons** | Drag icons anywhere, hide the ones you do not need, auto arrange in one tap |
| 🎨 **Make it yours** | Light or dark theme, accent colours, wallpapers or your own photo |
| ⚙️ **Practical settings** | Taskbar position, clock format, icon size, text size, window behaviour |
| 🔒 **Lock it** | Optional PIN lock screen |
| 💾 **Back up everything** | One file holds all your apps and settings |
| 📱 **Works on phones** | Windows open full screen and you switch with the taskbar |

---

## 🚀 Get started in one minute

1. **Open** [webos.asf.run](https://webos.asf.run).
2. **Get a ZIP** of a website. On GitHub, open any project and choose **Code → Download ZIP**.
3. **Drag the ZIP onto the desktop.** Or click **Install app** and pick the file.
4. **Press Install**, then double-click the new icon to open your app.

You can also paste a GitHub address such as `owner/repo` or a full `github.com` link, and WebOS fetches the files and installs them for you.

> Need help later? Open **Help** inside WebOS for a full guide.

---

## 📦 Which apps work?

**Works:**
- Any website ZIP that contains an `index.html`.
- Plain HTML, CSS and JavaScript sites.
- React, Vue, Svelte and Vite projects, when you install the **built** folder (usually `dist` or `build`).

**Does not work:**
- Apps that need their own server or database (PHP, Node, Python and similar).
- Raw source code that has not been built.

---

## 🛍️ The Store

Open **Store** on the desktop to find apps made by other people.

- **Every app comes from GitHub** and is approved before it appears. The publisher name is the one on their GitHub profile.
- **Search, filter and sort** by most downloaded, top rated or newest.
- **Ratings, downloads and comments** help you choose. Sign in with a free WebOS account to rate or comment.
- **Install in one tap.** The app is saved on your device like any other.
- **Want an app listed?** Create an account and press **Request an app**, or email [tasmon@outlook.com](mailto:tasmon@outlook.com).
- Forgot your password? Answer your security questions to set a new one.

Your installed apps still never leave your device. An account is only needed for the Store.

---

## 📴 Works offline

Everything you install is stored in your browser on your device. Once an app is installed, it opens without internet. Apps that load data from online services still need a connection for that part.

## 📲 Install WebOS itself

WebOS can be installed like a normal app, so it opens in its own window and works offline.

- **Android (Chrome):** menu ⋮ → *Install app* or *Add to Home screen*
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Desktop Chrome or Edge:** click the install icon in the address bar

---

## ⌨️ Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt` + `A` | Open the start menu |
| `Alt` + `I` | Install an app |
| `Alt` + `W` | Close the active window |
| `Alt` + `M` | Minimise the active window |
| `Alt` + `D` | Show the desktop |

---

## 🔗 Share an app with a link

Send someone a link that installs an app in one click:

```
https://webos.asf.run/#install=github:owner/repo
https://webos.asf.run/#install=https://example.com/app.zip
```

---

## 💾 Your data and backups

- Everything stays **in your browser, on your device**. Nothing is uploaded.
- Clearing your browser's site data for webos.asf.run removes your apps, so make a backup first.
- **Back up:** Settings → Storage & backup → **Export everything**.
- **Restore:** Settings → Storage & backup → **Import a backup**, on any device.

## 🔐 Privacy

- No account is needed to use WebOS. An account is only for rating, commenting and requesting apps in the Store. No tracking, no analytics.
- Apps run on the same address as WebOS, so they are not fully isolated from one another. **Only install apps from people you trust.**
- The PIN lock keeps casual visitors out. It is not encryption.

---

## ❓ Quick answers

**An app will not open.** WebOS needs service workers, which are switched off in private or incognito windows. Use a normal window.

**The app window is blank.** The ZIP is probably source code. Install the `dist` or `build` folder instead.

**A GitHub install fails.** The repository must be public. You can also download the ZIP and drop it in.

**How do I update an app?** Install the newer ZIP again. WebOS offers to update it and keeps its saved data.

**How do I start over?** Settings → Storage & backup → Factory reset.

---

## 🛠️ For app makers and developers

Want to make your app look right inside WebOS, or host your own copy? See **[DEVELOPERS.md](DEVELOPERS.md)**.

---

<div align="center">

Made by **Tasmon Islam** · [tasmon@outlook.com](mailto:tasmon@outlook.com)
Released under the [MIT License](LICENSE)
PDF Reader uses [pdf.js](https://mozilla.github.io/pdf.js/) by Mozilla (Apache-2.0)

</div>
