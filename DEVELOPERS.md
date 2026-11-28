# Make apps for WebOS

This guide is for people who build apps to run inside WebOS or want them listed in the Store. If you only want to use WebOS, read the [README](README.md).

---

## The quick version

1. Build your app as a normal static website with an `index.html`.
2. Optionally add a `webos.json` so it looks right in WebOS.
3. Put it on a **public GitHub repository**.
4. Install it to test: paste `owner/repo` into **Install app**, or open `https://webos.asf.run/#install=github:owner/repo`.
5. Happy with it? Open the **Store**, press **Request an app** and send the repository.

---

## What kind of app works

| Your app | How WebOS treats it |
| --- | --- |
| A static site (HTML, CSS, JavaScript) with an `index.html` | Installed into WebOS. Works offline. |
| A React, Vue, Svelte or Vite project | Install the **built** folder (`dist`, `build`, `public` or `docs`). WebOS finds that folder for you if it holds the `index.html`. |
| An app that needs its own server or database | Not installable. If it runs online (GitHub Pages, Vercel or any host), list it as a **web app**, which opens it in its own browser tab. |

Limits: up to 6000 files and 400 MB per app.

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

**Updates.** Raise `version` and install again. WebOS offers to update the app and keeps its saved data.

### Talk to WebOS from your app

Apps can use a small global API:

```js
WebOS.notify('Saved', 'Your note was saved'); // shows a notification
WebOS.setTitle('My App – Inbox');              // changes the window title
WebOS.close();                                 // closes the window
WebOS.theme; WebOS.accent;                     // current theme + accent colour
addEventListener('webos:env', e => {});        // fires when the theme changes
```

### Good to know

- Root-relative URLs such as `/css/site.css` are handled: WebOS points them back inside your app.
- `localStorage`, `sessionStorage` and IndexedDB are separate for each app.
- Apps cannot register their own service worker, because WebOS already serves them.
- If your app is a single-page app, unknown paths fall back to `index.html`.
- Design for phones too. On small screens the window fills the display.
- Use relative paths and keep everything the app needs inside the folder, so it works offline.

---

## Get your app into the Store

The Store lists apps that the admin (or an approved reviewer) has checked.

**GitHub apps**

- The repository must be **public**.
- It needs an `index.html` in the root, or in a `dist`, `build`, `public` or `docs` folder. To list one folder of a larger repository, send its address, for example `https://github.com/owner/repo/tree/main/apps/clock`.
- Add an `icon.svg` or `icon.png` (or `logo.svg`, `logo.png`, `favicon.svg`) so your app has a proper icon in the Store.
- A short, honest description (at least 20 characters) helps people decide. Pick the closest category.
- The publisher name shown in the Store comes from the GitHub account that owns the repository.

**Web apps**

- If your repository has **no `index.html`** because the app runs online (GitHub Pages, Vercel or another host), WebOS lists it as a web app. It uses the repository's website address, or the GitHub Pages address, or the address you type in the request.
- You can also send **just a website address** with no repository. Choose *Website link* in the request form.
- Web apps open in their own browser tab. Many sites forbid being shown inside another page, so WebOS does not frame them by default.

**After you send a request**

- Your request is reviewed. You see its status, and a note if it is not accepted, on your Store account page.
- **Reviewer accounts.** If 5 of your requests are approved in a row, you can ask to become an app reviewer from your account page. Reviewers help approve or reject requests from other people. They cannot change or delete apps that the admin added, or decisions the admin made.
- Found a problem or want a feature? Use **About → Send feedback** in WebOS.

---

## Test your app

- **Install a ZIP:** drag it onto the desktop.
- **Install a folder:** use *Install app → Folder*.
- **Install from GitHub:** paste `owner/repo`, or open `https://webos.asf.run/#install=github:owner/repo`.
- **Install from a link to a ZIP:** `https://webos.asf.run/#install=https://example.com/app.zip`.
- Check it **offline**: turn on airplane mode and open it again.
- Check it on a **phone**.
- Check it in **light and dark** themes if your app follows `WebOS.theme`.

Open the App Manager to see an app's size and files, clear its saved data, or remove it while you test.

---

## Security note for app makers

Apps run on the **same origin** as WebOS, because a static host cannot give every app its own domain. An installed app could in theory read other apps' stored data, so people are asked to install only apps they trust. Keep your app free of tracking, hidden requests and anything surprising. Never ask for people's WebOS password or anything similar.

---

Made by **Tasmon Islam** · tasmon@outlook.com · MIT License.
