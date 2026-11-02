# Vault

A private, **encrypted-at-rest** photo & video vault. Next.js 16 · React 19 · Node 22 · SQLite · sharp · ffmpeg.

This is a ground-up rewrite of the original PHP vault. It keeps the same purpose: a secret, password-protected place to store and look at photos and videos, blurred by default. It replaces every part underneath, as described below.

---

## What's new

### 🔐 Security, rebuilt from zero
| Before (PHP) | Now |
| --- | --- |
| "Logged in" = a cookie equal to `base64("true")`, so anyone could forge it | Random 256-bit session tokens (only a hash is stored), `__Host-` cookie, `HttpOnly`, `Secure`, `SameSite=Strict`, idle + absolute expiry, revocable |
| Credentials hard-coded in `_login.php` (base64) | Passphrase never stored. It unwraps the vault's master key via **scrypt** (128 MiB) |
| Files stored as plain files in the web root | **AES-256-GCM** encryption of every original, thumbnail, preview and transcode, using per-file keys (HKDF), in a chunked format with random access for video seeking |
| Uploads: client MIME trusted, no auth, `folder` from POST, so anyone could plant a `.php` | Auth required. Type detected from **magic bytes**. Random IDs on disk. Nothing in the blob store is web-served or executable |
| Delete: unauthenticated `unlink($_SERVER["DOCUMENT_ROOT"] . $_POST[...])` | Authenticated, id-validated, soft-delete to trash, then shredding |
| No brute-force protection | Exponential lock-outs, a login history, optional **TOTP 2FA** (QR enrolment, single-use codes) |
| No headers | Per-request nonce **CSP**, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `noindex`, CSRF origin checks |

**The vault seals itself.** The master key exists only in server memory while someone is signed in. When the last session ends (lock, idle timeout, or server restart), the key is wiped. A copy of the disk, the database, or the backups yields only ciphertext.

### ⬆️ Uploads that don't break
- **Chunked, parallel, resumable uploads.** Every chunk is SHA-256-verified, retried with backoff, paused while offline, and resumed after a reload by re-adding the same file.
- Drag files **or whole folders** anywhere on the page, paste from the clipboard, or pick files.
- Live tray with per-file progress, speed, ETA, pause/resume/cancel. A screen wake-lock is held while uploading.
- Exact duplicates are detected by content hash and skipped.
- Processing runs in a **persistent background queue** that survives restarts. Thumbnails stream into the grid live over Server-Sent Events, in every open tab.

### 🎬 A real video player
- Formats that browsers can't play (AVI, WMV, FLV, MKV, MPEG, HEVC…) are **auto-converted** to H.264/AAC MP4 when ffmpeg is installed, with progress shown on the tile.
- **Scrub previews:** hover the timeline to see frames, from an auto-generated storyboard.
- Buffered ranges, speed control (0.25×–3×), loop, picture-in-picture, fullscreen.
- **Resumes where you left off.** Volume, mute and speed are remembered.
- YouTube-style shortcuts: `K` `J` `L` `M` `F` `,` `.` `<` `>` `0-9`. Double-tap the sides to seek ±10 s on touch.
- Muted hover previews in the grid.

### 🗂️ Organise freely
- **Albums** replace hard-coded folders: create, rename, reorder (drag), set a cover, delete (keeping or trashing the items).
- **Drag-and-drop ordering** inside an album, multi-select drag, and dragging onto an album in the sidebar. Ordering uses fractional indexes, so a move rewrites a single row.
- Sort by custom order, date added, date taken (EXIF), name, size or duration.
- Smart views: Library, Photos, Videos, Favorites, Unsorted, and Trash (30-day auto-shred).
- Multi-select (click, ⇧-range, ⌘A) with bulk favorite / move / download / trash.
- **⌘K command palette** with live search.

### 🖼️ Viewer
Zoom with the wheel, pinch, or a double-click to 800%, with a high-res original loaded on demand. Pan, swipe, filmstrip, info panel with inline rename, and a slideshow with a Ken Burns effect.

### 🙈 Privacy features
- **Blur on open** (as before), with **peek-on-hover** for single tiles.
- **Shield** covers the screen the moment the window loses focus, so alt-tab and task-switcher snapshots show nothing.
- **Auto-lock** after idle time (configurable).
- **Panic key:** press `Esc` three times to lock and jump to a blank page.
- Derived images are stripped of EXIF/GPS. The original stays intact and encrypted.

---

## Quick start

```bash
npm install
npm run build
npm start
```

On first start, the server prints a one-time setup link (`/setup?token=…`). Open it and choose a passphrase. Alternatively, run `npm run vault:init` on the server.

> **There is no password recovery.** The passphrase is the only thing that can unlock the data.

Requirements: **Node ≥ 22.13**. ffmpeg is optional but recommended (`apt install ffmpeg`). Without it, videos are stored as they are, posters are captured in the browser, and formats browsers can't play are offered as downloads.

### Docker

```bash
docker compose up -d --build
docker compose logs vault | grep setup
```

### Behind nginx (recommended: always serve over HTTPS)

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 16m;          # upload chunks are 8 MB
    proxy_request_buffering off;
    proxy_buffering off;               # live updates (SSE)
    proxy_read_timeout 1h;
}
```

Set `VAULT_TRUST_PROXY=1` so rate limiting sees real client IPs. To keep the old `/vault` URL, build with `VAULT_BASE_PATH=/vault`.

All settings are listed in [`.env.example`](.env.example).

## Migrating from the PHP vault

```bash
# stop the web server first; the importer and server share the job queue
npm run vault:import -- /path/to/old/public_html/vault
```

Each top-level folder becomes an album (`images` → "Images", `videos` → "Videos", and so on). Files are encrypted in natural filename order. `compressed/`, `src/` and `trash/` are skipped, and only real media is imported, because everything is sniffed by content. The source files are not modified.

## Administration

| Command | |
| --- | --- |
| `npm run vault:init` | Create the vault |
| `npm run vault:passwd` | Change the passphrase (instant; signs everyone out) |
| `npm run vault:reset-2fa` | Disable 2FA if you lost your phone (needs the passphrase) |
| `npm run vault:import -- <dir>` | Import a folder tree |

**Backups:** back up the whole `VAULT_DATA_DIR`, which holds `vault.db` and `blobs/`. Backups are encrypted by construction; keep the passphrase somewhere safe.

## Development

```bash
npm run dev          # http://localhost:3000
npm test             # crypto, TOTP vectors, sniffing, full upload→encrypt→transcode pipeline
npm run typecheck
```

### Layout

```
app/                 pages + API route handlers
  api/uploads/…      resumable chunk protocol
  api/media/…        decrypting, Range-capable media streaming
  api/events         Server-Sent Events (live updates)
components/          Vault shell, Grid, Lightbox, VideoPlayer, Sidebar, Uploads, Settings…
lib/server/
  crypto.ts          key hierarchy + chunked AES-256-GCM blob format
  keyring.ts         seal / unseal, passphrase changes
  auth.ts            sessions, throttling, cookies
  uploads.ts         chunk assembly, sniffing, hand-off to the queue
  processing.ts      thumbnails, posters, transcode, storyboards, job queue
  media.ts           items, albums, ordering, trash
lib/client/          API wrapper, upload engine, preferences
scripts/vault.ts     CLI
```

### Threat model, briefly
- **Protects against** server compromise *while sealed*, stolen disks or backups, leaked databases, forged sessions, CSRF, brute force, malicious uploads, and shoulder-surfing (blur, shield, panic).
- **Does not protect against** an attacker with code execution on the server *while it is unlocked*, since the key is in memory then, nor a compromised browser. Item names and album names are stored as plaintext metadata in SQLite.
