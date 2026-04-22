# Hermes App

Cross-platform desktop shell for [Hermes WebUI](https://github.com/nesquena/hermes-webui), built with Electron.

## Features

- Window management (minimize, maximize, close, fullscreen)
- System tray (background running, quick menu)
- Global shortcut (`Cmd/Ctrl+Shift+H` to show/hide window)
- Native menus (File, View, Window)
- Configuration page for Hermes WebUI path setup
- Chinese/English bilingual support
- Cross-platform packaging (macOS, Windows, Linux)

## Prerequisites

- [Hermes WebUI](https://github.com/nesquena/hermes-webui) installed
- Node.js 18+
- npm 8+

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for your platform
npm run build
```

## Build for Specific Platforms

```bash
npm run build:mac   # macOS (dmg, zip)
npm run build:win   # Windows (nsis, portable)
npm run build:linux # Linux (AppImage, deb)
```

## Configuration

On first launch, if Hermes WebUI is not found or not configured, the app will show a configuration page where you can set the Hermes WebUI installation path.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HERMES_WEBUI_URL` | `http://localhost:8787` | Hermes WebUI service address |

## Project Structure

```
hermes-app/
├── main.js          # Electron main process
├── preload.js       # Preload script (secure bridge)
├── package.json     # npm configuration
├── electron-builder.yml  # Packaging configuration
├── renderer/
│   ├── index.html   # Main renderer (WebUI iframe)
│   ├── config.html  # Configuration page
│   └── app.js       # Renderer logic
└── build/           # App icons
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+H` | Show/hide window |
| `Cmd/Ctrl+R` | Refresh page |
| `Cmd/Ctrl+Shift+I` | Open developer tools |
| `F11` | Toggle fullscreen |
| `Cmd/Ctrl+Q` | Quit app |

## License

MIT License - see [LICENSE](LICENSE) file for details.
