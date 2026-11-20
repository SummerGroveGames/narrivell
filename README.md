# Narrivell

**A fairly priced writing app for novelists who never want to lose a word.**

Narrivell is an offline-first workspace for writing and revising long fiction. Your book lives on your own devices, syncs through storage you choose, and can always be exported to open formats. Nothing is locked in, and nothing is silently overwritten.

One purchase, no subscription, with a 60-day free trial (when released). The source code is public so you can see exactly how Narrivell handles your work.

*By Summer Grove Software.*

> **Status: early development (pre-alpha).** The app isn't usable yet. Follow along or star the repo to watch progress.

---

## Why Narrivell

- **Never lose a word.** Every device writes its own changes; edits from two devices merge instead of overwriting each other. Automatic snapshots are taken before any merge that touches a chapter you've edited locally.
- **Works offline.** Write on your PC or phone with no connection. Sync when you're back online.
- **Your data, your storage.** Keep projects in any folder, synced folder or your own cloud account (Google Drive first). There's no Narrivell server and no account to create.
- **Word-friendly.** Import `.docx` manuscripts *with their comments intact*, and export back to Word with comments preserved.
- **Open formats.** After every sync, a readable Markdown + JSON copy of your whole project is written alongside it.

## Planned features

**First release (MVP)**
- Import Word manuscripts, including tagged comments (e.g. `CONTINUITY: …`)
- Binder that follows your own structure (parts, chapters, sections, microchapters), with drag-to-reorder
- Distraction-free editor with autosave and named snapshots
- Sync across devices via Google Drive, with conflict review
- Generated book map with word counts vs. targets, printable in landscape with a notes column
- Comment panel: filter by tag, resolve and reopen
- Decision log with full history (what changed, when and why)
- Export to `.docx` with comments

**Later**
- Codex of characters, places and things, with series-aware renaming
- Timeline, knowledge tracker and continuity ledgers
- Thread and motif heatmaps
- Optional, honest AI: use any provider or a local model; AI-drafted text is tracked so you can disclose it correctly (off by default)
- Submission tracker and query kit

## Platforms

- **Windows** – installed app (`Narrivell_x.y.z_x64-setup.exe` or `.msi`)
- **Linux** – installed app (`.deb` for Linux Mint, Ubuntu and Debian; `.rpm` for Fedora and openSUSE)
- **Android** – installed app (coming in v0.2)
- **Web** – runs in Chrome or Edge, and can be installed from the browser
- macOS and iOS to follow

## Roadmap

| Milestone | Goal |
|---|---|
| M0 | App shell installs on PC and Android; auto-deploys from this repo |
| M1 | Import, binder and editor |
| M2 | Google Drive sync with conflict review |
| M3 | Book map, printing and word-count targets |
| M4 | Comments panel and decision log |
| M5 | Word export with comments |

## Built with

TypeScript · React · Vite · TipTap (ProseMirror) · Yjs · IndexedDB · MiniSearch · Vitest · Playwright

## Try it

- **Windows:** download the installer from [Releases](https://github.com/SummerGroveGames/narrivell/releases) and run it. Narrivell installs to *Program Files*, adds a Start menu entry, and can be removed from *Settings › Apps*.
- **Web:** **https://summergrovegames.github.io/narrivell/** – open it in Chrome or Edge.

> The Windows installer isn't code-signed yet, so Windows may show *"Windows protected your PC"*. Choose **More info › Run anyway**.

## Development

Requirements: [Node.js LTS](https://nodejs.org/) and Git.

```bash
git clone https://github.com/SummerGroveGames/narrivell.git
cd Narrivell
npm install
npm run dev
```

Then open http://localhost:5173/narrivell/

| Command | What it does |
|---|---|
| `npm run dev` | Start the app with live reload |
| `npm test` | Run the tests |
| `npm run typecheck` | Check the TypeScript |
| `npm run build` | Build the production app into `app/dist` |
| `npm run preview` | Serve the production build locally (offline mode works here) |

Every push to `main` is audited, checked, built and deployed to GitHub Pages automatically.

### Windows app

Extra requirements:

- [Rust](https://rustup.rs/)
- [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload (MSVC x64/x86 build tools + Windows SDK). Rust can't link Windows programs without it.

Run the desktop commands from **PowerShell or Command Prompt**, not Git Bash or MSYS2: those shells have their own `link` command that hides Microsoft's linker. If PowerShell blocks `npm` with a script-policy error, use `npm.cmd` instead of changing the policy.

| Command (PowerShell) | What it does |
|---|---|
| `npm.cmd run desktop:dev` | Run the Windows app with live reload |
| `npm.cmd run desktop:build` | Build the installers into `app/src-tauri/target/release/bundle/` (`nsis/…-setup.exe` and `msi/…msi`) |

The first build compiles Rust dependencies and takes several minutes; later builds are much faster.

### Linux app

Tested on Linux Mint (Ubuntu-based). Install the build requirements:

```bash
sudo apt update
sudo apt install build-essential curl wget file git libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev pkg-config
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Then install [Node.js LTS](https://nodejs.org/) (for example with [nvm](https://github.com/nvm-sh/nvm)), and build:

```bash
npm ci
npm run desktop:build
sudo apt install ./app/src-tauri/target/release/bundle/deb/Narrivell_*_amd64.deb
```

The `.deb` and `.rpm` packages use the system's WebKitGTK, so your distribution's security updates keep the browser engine patched. (AppImage is deliberately not built: it bundles its own copy of those libraries, which then only updates when Narrivell does.)

The installer installs per machine (*Program Files*, Start menu, *Settings › Apps*) and supports silent install with `/S` for managed deployment; the MSI suits Intune or Group Policy.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability and how Narrivell limits risk.

### Repository layout

```
app/          The app (React + Vite): web version and UI for the installed apps
  public/     Manifest, service worker, icons
  src/        Source code
  src-tauri/  Windows and Linux (later Android) app shell and installer settings
.github/    Deploy workflow, issue and PR templates
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs and suggest features.

## License

**Source-available, all rights reserved.** © 2026 Summer Grove Software. You're welcome to read, build and review the code for evaluation and security review; redistribution and commercial use aren't permitted. See [LICENSE](LICENSE).

Narrivell will be sold as a one-time purchase with a 60-day trial. Your writing is always yours.
