```
npm run dev:renderer   # Vite only, opens in browser
npm run dev:headless   # Uses xvfb-run for headless Electron
```

### Verification:

npm run build passes.
npm run dev no longer fails on chrome-sandbox.
It now fails here with Missing X server or $DISPLAY, which means this shell has no GUI display attached.
### Use:
```
npm run dev
```
from a real graphical Ubuntu terminal.

### For SSH/headless:
```
npm run dev:renderer
```
For headless Electron smoke testing, install Xvfb first:

sudo apt install xvfb
npm run dev:headless
To use Chromium’s real setuid sandbox later, fix the binary permissions and opt in:

sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
SECOND_BRAIN_DEV_CHROMIUM_SANDBOX=1 npm run dev


-----

Two things were happening:

1. Your original `dev:headless` did start Electron, but Chromium was complaining about DBus/GPU inside Xvfb.
2. My test also found a port conflict risk: if `dev:renderer` is already running on `5173`, headless should not try to reuse it.

I updated:
- [package.json](/home/rushat/second-brain/package.json): `dev:headless` now uses port `5174`.
- [vite.config.ts](/home/rushat/second-brain/vite.config.ts): Vite reads `VITE_PORT`.
- [start-electron-dev.cjs](/home/rushat/second-brain/scripts/start-electron-dev.cjs): headless launches with Linux Xvfb-friendly GPU flags.

`npm run build` passes.

Now run:

```bash
npm run dev:headless
```

You may still see `xdg-desktop-portal`, `GSettings`, or `DBus` warnings. Those are from the host’s minimal headless desktop stack, not from the app. For a cleaner headless environment, install the missing desktop runtime pieces:

```bash
sudo apt install xvfb dbus-x11 gsettings-desktop-schemas xdg-desktop-portal xdg-desktop-portal-gtk gvfs-fuse at-spi2-core
```

Also: `dev:headless` is mostly useful as a smoke test. For actually viewing and developing UI, keep using:

```bash
npm run dev:renderer
```