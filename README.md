# Lecture Doc

A desktop app that turns lecture videos into paginated documents. Drop in a video, and Lecture Doc extracts frames at a configurable interval, deduplicates visually identical slides, and lets you review and curate the result before exporting to PDF.

## What it does

1. **Import** — point it at an `.mp4`, `.mov`, or any common video format (or a whole folder of them)
2. **Extract** — ffmpeg pulls frames at your chosen interval; perceptual hashing removes consecutive duplicates automatically
3. **Edit** — review thumbnails, adjust the diff threshold to include or exclude borderline frames, toggle individual frames manually
4. **View** — browse the document with audio sync, zoom, single/spread page modes, and a scrub bar
5. **Export** — save as PDF

Files are stored as `.ldoc` archives (a zip containing the frames, metadata, and frame index). You can share or reopen them without re-extracting.

## Features

- Configurable frame extraction interval and diff threshold
- 16×16 perceptual hash (256-bit) for accurate slide-change detection
- Rolling vs. continuous diff modes
- Audio playback synced to the current slide
- Zoom (50%–200%), continuous / single-page / two-page spread views
- Drag-and-drop import anywhere in the app window
- Library with grid, list, compact, and gallery view styles
- Keyboard shortcuts in the editor: `←`/`→` to navigate, `Space` to toggle a frame

## Building

Requires [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 18+, and ffmpeg binaries placed in `src-tauri/binaries/` named for your target triple (e.g. `ffmpeg-aarch64-apple-darwin`).

```bash
npm install
npm run tauri dev     # development
npm run tauri build   # production build
```

## CI

GitHub Actions builds a macOS DMG and Windows NSIS installer on every `v*` tag. Artifacts are attached to the workflow run.

## Stack

- [Tauri v2](https://tauri.app) — Rust backend, WebView frontend
- React + TypeScript + Vite
- Tailwind CSS
- [pdf-lib](https://pdf-lib.js.org) — PDF generation in the browser
