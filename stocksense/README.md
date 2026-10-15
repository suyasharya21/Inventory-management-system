# StockSense

StockSense is a local-first inventory desktop application built from the Sociverse requirements brief. Customer operational data is stored in a local SQLite database and exposed to React only through a secure Electron preload API.

Its Smart Entry and NLP Help flows provide concrete examples when a request cannot be understood. First-time additions, failed writes, and unsupported update requests also provide a guided action that opens the relevant manual form.

Voice typing uses a bundled Whisper model and processes microphone audio on the customer device. Temporary recordings are deleted immediately after transcription. Google sign-in is currently disabled; local account creation and sign-in remain available.

Installers are configured for Apple Silicon macOS (`.dmg`) and 64-bit Windows (`.exe`). Both platforms use local SQLite storage and bundled on-device speech transcription.

Each product can store a minimum expected sales quantity for 30 days. The dashboard and downloadable Aging Products report compare actual sales with that target for the selected dates and highlight slow-selling stock.

## Development

```bash
pnpm install
pnpm dev
```

The browser-only view is intentionally disabled because all records must come through the Electron connection to the local SQLite database. Use `pnpm dev` to run the desktop app during development.

## Quality checks

```bash
pnpm check
```

## Package

```bash
pnpm build
```

Installer artifacts are written to `release/`.

## Data ownership

The live database remains on the customer device. Manual backups are encrypted with AES-256-GCM before being written, and restore is performed locally.

Developed by Sociverse - https://sociverse.tech
