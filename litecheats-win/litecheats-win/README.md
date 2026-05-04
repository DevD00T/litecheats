# Litecheats

Generated with [appbun](https://github.com/bigmacfive/appbun). This project wraps https://litecheats.com/ in an Electrobun desktop shell.

## Commands

```bash
bun install
bun run dev
bun run build
bun run build:dmg
```

## Configuration

- App name: `Litecheats`
- Identifier: `com.litecheats`
- Source URL: [https://litecheats.com/](https://litecheats.com/)
- Theme color: `#245ebc`
- Titlebar preset: `unified`
- Window size: `1440x900`
- Icon source: not resolved

## Files

- `src/bun/index.ts`: creates the Electrobun window and loads the local shell
- `src/mainview/`: the unified shell header and embedded webview
- `scripts/create-dmg.mjs`: creates a drag-to-Applications DMG on macOS
- `electrobun.config.ts`: app metadata and platform packaging settings
- `assets/icon.*`: site-derived icons when available

## Notes

The generated app loads the remote site inside an Electrobun shell. The selected `unified` preset currently maps to a hidden inset macOS toolbar with a connected local header and standard native chrome on other platforms.

On macOS, `bun run build:dmg` builds the app and wraps the newest `.app` bundle in a DMG that opens with the usual drag-to-Applications install flow.

If the installed macOS app does not open from Finder or the Dock the first time, open it once from the Applications folder with **Open** in the context menu. Some local Electrobun builds trigger a one-time launcher permission prompt on first launch.
