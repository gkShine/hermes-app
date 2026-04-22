# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hermes WebUI Desktop Shell is an Electron application that wraps the Hermes WebUI web application as a cross-platform desktop client. It provides window management, system tray integration, and global shortcuts.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Run in development mode with logging
npm start            # Run in production mode
npm run build        # Build for current platform
npm run build:mac    # Build for macOS (dmg, zip)
npm run build:win    # Build for Windows (nsis, portable)
npm run build:linux  # Build for Linux (AppImage, deb)
```

## Architecture

```
hermes-app/
├── main.js          # Electron main process - window creation, tray, menus, shortcuts
├── preload.js       # Context bridge exposing electronAPI to renderer
├── renderer/
│   ├── index.html   # Loads the web UI in an iframe
│   ├── config.html  # Configuration page for hermes-webui path
│   └── app.js       # Renderer logic (iframe error handling, platform info)
└── electron-builder.yml  # Packager configuration
```

### Main Process (main.js)
- Creates BrowserWindow with context isolation enabled
- Checks if Hermes WebUI is running at `HERMES_WEBUI_URL` (default: `http://localhost:8787`)
- Optionally auto-starts hermes-webui via `start.sh` in the configured path
- Manages system tray (hides to tray on close instead of quitting)
- Registers global shortcut `CmdOrCtrl+Shift+H` to toggle window visibility
- Creates native application menu (File, View, Window)
- **Configuration**: Path to hermes-webui is stored via `electron-store` and validated on startup

### Preload Script (preload.js)
- Exposes `window.electronAPI` with platform/version info and window controls
- Exposes `window.electronAPI.config` for config get/set/check/start operations
- Uses IPC for window minimize/maximize/close operations

### Renderer (renderer/)
- **index.html**: Renders an iframe pointing to `HERMES_WEBUI_URL`
- **config.html**: Configuration UI for setting hermes-webui path, includes GitHub download link
- Content Security Policy allows connections to `http://localhost:8787`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HERMES_WEBUI_URL` | `http://localhost:8787` | WebUI service address |
| `HERMES_WEBUI_PATH` | `/Users/lincheng/Work/hermes-webui` | Default hermes-webui installation path |

## Key Behaviors

- **Close button hides to tray** rather than quitting (app.isQuitting flag controls this)
- **Auto-start**: If Hermes WebUI is not running, the app launches it via the start.sh script
- **Config page**: If hermes-path is invalid, empty, or not configured, app shows config.html instead of loading WebUI. Config page supports Chinese/English i18n.
- **Context isolation**: nodeIntegration is disabled; all Node.js access goes through IPC
