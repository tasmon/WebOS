# WebOS User Guide

WebOS is a small operating system that runs inside your web browser. You can install websites as apps, open them in windows, and use them even without internet.

Open it at **https://webos.asf.run**. There is nothing to sign up for.

The same guide is built into WebOS: open **Help** from the desktop or the start menu.

---

## 1. Install your first app

1. Get a ZIP file of a website. On GitHub, open the project, click the green **Code** button, then **Download ZIP**.
2. Drag the ZIP onto the WebOS desktop. Or click **Install app** and choose the file.
3. Check the name and icon, then press **Install**.
4. Double-click the new icon on the desktop to open it.

## 2. Ways to install

| Method | How |
| --- | --- |
| ZIP file | Drop it on the desktop or choose it in **Install app** |
| Folder | Choose a folder that contains an `index.html` |
| GitHub | Type `owner/repo` or paste a github.com link. The repository must be public |
| Web address | A direct link to a ZIP file. If the site blocks it, download the ZIP and drop it in |

**Share link:** `https://webos.asf.run/#install=github:owner/repo` opens WebOS and starts installing that repository.

## 3. Which ZIP files work

- Any ZIP that has an `index.html`, even inside a folder (like GitHub downloads).
- Plain HTML, CSS and JavaScript websites.
- React, Vue, Svelte and Vite projects: install the **built** folder (usually `dist` or `build`), not the source code.
- Apps that need their own server or database (PHP, Node, Python) cannot run in WebOS.

## 4. Using windows

- Drag the title bar to move a window. Drag edges or corners to resize.
- Drag a window to the left or right screen edge to fill half the screen. Drag it to the top to fill the whole screen.
- Double-click a title bar to maximise or restore.
- Window buttons: reload the app, open it in a browser tab, full screen, minimise, maximise, close.
- On a phone, windows open full screen. Switch between them with the taskbar.

## 5. Icons, taskbar and menus

- Right-click (or long-press) an app icon: Open, Open in new tab, Pin to taskbar, Rename, Export as ZIP, Details, Uninstall.
- Right-click the desktop: Install app, Refresh, Change wallpaper, Settings, Help.
- The start button opens all your apps with a search box.
- The bell shows notifications that apps send. The clock opens a calendar.

## 6. Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Alt + A | Start menu |
| Alt + I | Install an app |
| Alt + W | Close the active window |
| Alt + M | Minimise the active window |
| Alt + D | Show the desktop |

## 7. Settings

Open **Settings** to change:

- **Appearance:** light, dark or automatic theme, accent colour, wallpaper or your own picture, blur, animations, text size, corner style.
- **Desktop:** icon size, labels, sorting, single or double click to open.
- **Windows:** open maximised, snap to edges, remember sizes, confirm before closing, open apps in a browser tab.
- **Taskbar:** top or bottom, centred or left, auto-hide, 12 or 24 hour clock.
- **Security:** PIN lock and lock on start.
- **Storage & backup:** space used, export or import a backup, factory reset.

## 8. Your data and backups

- Everything is stored in this browser on this device. Nothing is sent to a server.
- If you clear your browser's site data for webos.asf.run, your apps are removed. Back up first.
- **Back up:** Settings → Storage & backup → **Export everything**. You get one `.webos` file.
- **Restore:** Settings → Storage & backup → **Import a backup**, on any device.
- Each app keeps its own saved data. Uninstalling an app also deletes that data.
- **Update an app:** install the newer ZIP. WebOS offers to update it and keeps its saved data.

## 9. Install WebOS like a normal app

- **Android (Chrome):** menu ⋮ → Install app (or Add to Home screen).
- **iPhone (Safari):** Share → Add to Home Screen.
- **Desktop Chrome or Edge:** click the install icon in the address bar.

After that WebOS opens in its own window and works offline.

## 10. Troubleshooting

| Problem | What to do |
| --- | --- |
| App will not open | WebOS needs service workers, which are off in private or incognito windows. Use a normal window |
| App window is blank | The ZIP is probably source code. Install the `dist` or `build` folder |
| GitHub install fails | The repository must be public and spelled correctly. Or download the ZIP and drop it in |
| App cannot sign in or load data | WebOS runs static files only. Apps that use online services need an internet connection |
| Something is stuck | Start menu → Restart, or reload the page |
| Start over | Settings → Storage & backup → Factory reset |

## 11. Privacy and safety

- No accounts, no tracking, no analytics.
- Apps run on the same address as WebOS, so they are not fully isolated from one another. **Only install apps from people you trust.**
- The PIN lock keeps casual visitors out. It is not encryption.

---

Made by **Tasmon Islam** · tasmon@outlook.com · MIT License
