# UniM3U

A fast desktop IPTV player. Point it at your M3U playlist (and optional XMLTV EPG)
and watch. Built with Electron; plays HLS and MPEG-TS streams.

## Install

Download the installer for your platform from the [Releases](../../releases) page.

> **Note:** UniM3U is **not code-signed** (it's a personal/hobby build). Your OS
> will show a warning the first time you open it — that's expected for unsigned
> apps, not a sign anything is wrong. Here's how to get past it on each platform.

### Windows (`UniM3U Setup x.y.z.exe`)

1. Run the installer.
2. Windows SmartScreen shows **"Windows protected your PC."**
3. Click **More info**, then **Run anyway.**

(You only see this once. It appears because the app isn't signed with a paid
code-signing certificate.)

### macOS (`UniM3U-x.y.z.dmg`)

> The macOS build is **Apple Silicon (arm64) only** — it runs on M1/M2/M3+ Macs,
> not Intel Macs.

1. Open the `.dmg` and drag **UniM3U** to **Applications**.
2. The first launch is blocked with **"UniM3U is damaged and can't be opened"**
   or **"unidentified developer."** This is just the unsigned-app quarantine flag.
3. Clear it with **either**:
   - **Right-click** the app in Applications → **Open** → **Open** in the dialog, **or**
   - Run this in Terminal:
     ```bash
     xattr -dr com.apple.quarantine /Applications/UniM3U.app
     ```

After that it opens normally every time.

### Linux (`UniM3U-x.y.z.AppImage`)

1. Make it executable:
   ```bash
   chmod +x UniM3U-*.AppImage
   ```
2. Run it:
   ```bash
   ./UniM3U-*.AppImage
   ```

If it won't start, you may need FUSE (`sudo apt install libfuse2` on Debian/Ubuntu).

## First run

1. Open **Settings** (the ⚙ icon) — it appears automatically on first launch.
2. Paste your **M3U playlist URL** (and an **XMLTV EPG URL** if you have one).
3. **Save & Load Channels.**

Your playlist is cached locally; use the ↻ button to force a fresh download, or
set the auto-refresh interval in Settings.

## Build from source

```bash
npm install
npm start            # run in dev
npm test             # run tests
npm run build:win    # or build:mac / build:linux — builds on that OS only
```
