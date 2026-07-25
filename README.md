# Mozom Tacho Fleet Manager

Windows desktop app (developed on macOS) replacing GloboFleet software for **legally-compliant
downloading and archiving** of digital tachograph records, reusing GloboFleet hardware:

- **Downloadkey** — does the VU (and card-via-VU) download itself at the tachograph; mounts as
  plain USB mass storage. The app scans it and archives new `.ddd`/`.tgd`/`.c1b`/`.v1b` files.
- **PC/SC card reader** — phase 2: direct driver-card download at the office desk.

## Compliance model (Reg (EU) 581/2010, 165/2014)

- Driver card downloaded at least every **28 days**; each vehicle unit every **90 days** —
  tracked per subject with OK / due-soon / overdue status.
- Originals stored **bit-exact, read-only, append-only** in the vault (dedup by SHA-256),
  with an optional mirrored second copy (`mirror_path` setting). Retention: keep indefinitely.
- Signature verification (Gen1 RSA / Gen2 ECC against ERCA keys): **not yet implemented** —
  files are archived untouched and marked `unverified`. Phase 1b.

## Dev

```bash
npm install
npm run dev        # runs the app natively on macOS
npm run typecheck
```

Test fixtures: real `.ddd` files exported by GloboFleet/Downloadkey. Import via the
"Import files…" button, or put them on any removable volume to test "Scan Downloadkey".

## Windows build

```bash
npm run dist:win   # cross-builds NSIS installer into release/ from macOS
```

Smoke-test on the office Windows PC at milestones: drive-letter detection, installer,
smartcard service (phase 2), tray/auto-start (later).

## Roadmap

Workstream: devman `cross-tacho-download-archive`.
Phase 1 import+vault+scheduler (this scaffold) → 1b signature verification →
2 PC/SC card download → 3 `.ddd` parsing / moztacho export.
