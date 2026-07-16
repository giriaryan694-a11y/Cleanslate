# Cleanslate

A small, local-only tool for stripping hidden metadata from files before you share them. Everything runs in the browser — no upload, no server, no account.

## Why

Photos carry GPS coordinates, camera model, and timestamps in EXIF data. PDFs carry author names, software fingerprints, and edit history in their info dictionary and XMP stream. Cleanslate removes what it can, and is explicit in the UI about what it can't.

## Supported formats

| Format | What's removed |
|---|---|
| JPEG / PNG / WebP | EXIF, ICC profiles, XMP, IPTC, embedded thumbnails (via canvas re-encode) |
| PDF | Info dictionary, XMP metadata stream, embedded files/attachments, open-action JavaScript |

Anything else (TIFF, HEIC, GIF, Office documents, audio, video) is flagged as unsupported rather than silently passed through unclean.

## Known limitations

- Image re-encoding causes a small, usually invisible quality loss.
- PDF form field values, digital signatures, and content baked directly into a page (e.g. a scanned-in watermark) are not removed.
- Browser-only tooling can't match a desktop utility like ExifTool or MAT2 for exhaustive sanitization — see the "What this tool actually removes" panel in the app for the full breakdown.

## Running locally

No build step. Serve the folder with any static file server:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the served URL in a browser.

## Files

```
index.html   — structure
style.css    — theme tokens (light / dark / eye-saver) and layout
script.js    — file handling, canvas-based image cleaning, PDF sanitization
```

## Dependencies (loaded via CDN, no install required)

- [exif-js](https://github.com/exif-js/exif-js) — reads existing EXIF tags so the UI can report what was found and removed
- [pdf-lib](https://github.com/Hopding/pdf-lib) — rewrites the PDF without the info dictionary, XMP stream, or embedded scripts/files
- [JSZip](https://stuk.github.io/jszip/) — bundles multiple cleaned files into one download

---

Made by Aryan Giri
