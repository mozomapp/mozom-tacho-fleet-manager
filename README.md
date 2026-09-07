# Mozom Tacho Fleet Manager

Windows desktop app (developed on macOS) replacing GloboFleet software for **legally-compliant
downloading and archiving** of digital tachograph records, reusing GloboFleet hardware:

- **Downloadkey** — does the VU (and card-via-VU) download itself at the tachograph; mounts as
  plain USB mass storage. The app scans it and archives new `.ddd`/`.tgd`/`.c1b`/`.v1b` files.
- **PC/SC card reader** — direct driver-card download at the office desk (phase 2, built):
  Appendix 7 card-download protocol over `@pokusew/pcsclite`, producing the standard
  `.ddd` layout (Gen1 + Gen2 blocks, each EF as data + card signature). Verified on the
  real CHERRY reader + Gen2 driver card (2026-09-07): same block order/sizes as GloboFleet's
  file for that card, static blocks byte-identical, ~13 s per card. Card quirks handled:
  READ BINARY past EOF answers `6700` (no partial read) → remaining length is binary-searched;
  Gen2 signature needs the exact Le (64 for P-256); certificate EFs are padded (Link cert EF is
  205 zero bytes on a card without one — GloboFleet writes 204; harmless). Set
  `TACHO_APDU_DEBUG=1` to trace APDUs on stderr. Writing the download date back to the card
  (`--update-card` / UI checkbox, default on) is verified: both Gen1 and Gen2 EF_Card_Download
  take the UTC TimeReal, and a re-read shows nothing else changed. (GloboFleet appears to
  write local time into that field; we write UTC per the spec.)

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

### Office card download (PC/SC)

Plug in the reader, insert a driver card, then either use the "Office card reader" panel in
the app or run headless:

```bash
npx electron . --card-download --out /tmp/tacho-test        # read-only test, keeps a plain copy
npx electron . --card-download --update-card                # also writes the download date to the card
```

Progress goes to stderr, a JSON result to stdout. The file is archived into the vault and
auto-assigned to a driver subject named after the card holder. First real-hardware check:
download the same card with GloboFleet and with this tool and `cmp` the two files.

Native modules (`better-sqlite3`, `@pokusew/pcsclite`) are built for Electron's ABI with
`npx @electron/rebuild -f -w @pokusew/pcsclite` (npm postinstall scripts are blocked here).
`@pokusew/pcsclite` ships no prebuilt Windows binaries, so the Windows installer must be
built on a Windows machine (or a prebuild step added) — cross-building from macOS won't
produce a working reader on the office PC.

## Windows build

```bash
npm run dist:win   # cross-builds NSIS installer into release/ from macOS
```

Smoke-test on the office Windows PC at milestones: drive-letter detection, installer,
smartcard service (phase 2), tray/auto-start (later).

## Roadmap

Workstream: devman `cross-tacho-download-archive`.
Phase 1 import+vault+scheduler ✓ → 2 PC/SC card download (built, hardware validation
pending) → 1b signature verification → 3 `.ddd` parsing / driver analysis ✓ (first cut)
→ moztacho export.
