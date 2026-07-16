/* ===================================================================
   Cleanslate — local metadata cleaner
   Everything below runs client-side. No file is ever uploaded
   anywhere; cleaning happens entirely in the browser sandbox.
=================================================================== */

/* ---------- theme ---------- */
const THEME_KEY = "cleanslate-theme";
const themeButtons = document.querySelectorAll(".theme-btn");

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeButtons.forEach(btn => {
    btn.setAttribute("data-active", btn.dataset.theme === theme ? "true" : "false");
  });
  try { window.localStorage?.setItem?.(THEME_KEY, theme); } catch (_) { /* storage may be unavailable */ }
}

themeButtons.forEach(btn => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
});

// Default to paper; browsers without storage access just keep the default.
let initialTheme = "paper";
try { initialTheme = window.localStorage?.getItem?.(THEME_KEY) || "paper"; } catch (_) { /* ignore */ }
applyTheme(initialTheme);

/* ---------- disclosure panel ---------- */
const disclosureToggle = document.getElementById("disclosureToggle");
const disclosureBody = document.getElementById("disclosureBody");
disclosureToggle.addEventListener("click", () => {
  const expanded = disclosureToggle.getAttribute("aria-expanded") === "true";
  disclosureToggle.setAttribute("aria-expanded", String(!expanded));
  disclosureBody.hidden = expanded;
});

/* ---------- state ---------- */
/** @type {{ file: File, id: string, status: 'pending'|'ok'|'warn'|'error', detail: string, blob: Blob|null, outName: string }[]} */
let queue = [];
let cleanedBlobs = []; // for zip export

const dropzone = document.getElementById("dropzone");
const redactionBar = document.getElementById("redactionBar");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const controls = document.getElementById("controls");
const cleanBtn = document.getElementById("cleanBtn");
const zipBtn = document.getElementById("zipBtn");
const clearBtn = document.getElementById("clearBtn");
const resultsEl = document.getElementById("results");

const SUPPORTED_IMAGE = ["image/jpeg", "image/png", "image/webp"];
const SUPPORTED_PDF = "application/pdf";

/* ---------- drag & drop / picker ---------- */
browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => addFiles(fileInput.files));

["dragenter", "dragover"].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  })
);
["dragleave", "drop"].forEach(evt =>
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  })
);
dropzone.addEventListener("drop", e => {
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

function addFiles(fileList) {
  for (const file of fileList) {
    queue.push({
      file,
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      detail: "Waiting to be cleaned.",
      blob: null,
      outName: suggestOutputName(file.name)
    });
  }
  fileInput.value = "";
  controls.hidden = queue.length === 0;
  renderResults();
}

function suggestOutputName(name) {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return `${name}_clean`;
  return `${name.slice(0, dot)}_clean${name.slice(dot)}`;
}

/* ---------- rendering ---------- */
function renderResults() {
  resultsEl.innerHTML = "";
  for (const item of queue) {
    const row = document.createElement("div");
    row.className = "file-row";

    const top = document.createElement("div");
    top.className = "file-row-top";

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = item.file.name;

    const badge = document.createElement("span");
    badge.className = `status status-${item.status}`;
    badge.textContent = {
      pending: "PENDING",
      ok: "CLEANED",
      warn: "PARTIAL",
      error: "FAILED"
    }[item.status];

    top.append(name, badge);
    row.appendChild(top);

    const detail = document.createElement("p");
    detail.className = "file-detail";
    detail.textContent = item.detail;
    row.appendChild(detail);

    if (item.blob) {
      const actions = document.createElement("div");
      actions.className = "file-actions";
      const link = document.createElement("button");
      link.className = "link-btn";
      link.textContent = `Download ${item.outName}`;
      link.addEventListener("click", () => downloadBlob(item.blob, item.outName));
      actions.appendChild(link);
      row.appendChild(actions);
    }

    resultsEl.appendChild(row);
  }
}

/* ---------- clear ---------- */
clearBtn.addEventListener("click", () => {
  queue = [];
  cleanedBlobs = [];
  controls.hidden = true;
  zipBtn.hidden = true;
  renderResults();
});

/* ---------- clean all ---------- */
cleanBtn.addEventListener("click", async () => {
  cleanBtn.disabled = true;
  redactionBar.classList.remove("sweep");
  void redactionBar.offsetWidth; // restart animation
  redactionBar.classList.add("sweep");

  cleanedBlobs = [];

  for (const item of queue) {
    item.status = "pending";
    item.detail = "Cleaning…";
    renderResults();

    try {
      if (SUPPORTED_IMAGE.includes(item.file.type)) {
        await cleanImage(item);
      } else if (item.file.type === SUPPORTED_PDF) {
        await cleanPdf(item);
      } else {
        item.status = "warn";
        item.detail = `Unsupported file type (${item.file.type || "unknown"}). Not processed — see "What this tool actually removes" below for supported formats.`;
      }
    } catch (err) {
      item.status = "error";
      item.detail = `Could not clean this file: ${err.message}`;
    }

    if (item.blob) cleanedBlobs.push({ name: item.outName, blob: item.blob });
    renderResults();
  }

  zipBtn.hidden = cleanedBlobs.length < 2;
  cleanBtn.disabled = false;
});

/* ---------- image cleaning ---------- */
async function cleanImage(item) {
  const { file } = item;

  // Best-effort read of existing EXIF (JPEG only) purely so we can tell
  // the user what was actually present and is about to be discarded.
  let foundTags = [];
  if (file.type === "image/jpeg" && window.EXIF) {
    foundTags = await readExifTags(file);
  }

  const dataUrl = await fileToDataUrl(file);
  const img = await loadImage(dataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const outType = file.type; // keep original format
  const quality = outType === "image/png" ? undefined : 0.92;

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("Canvas export failed"))), outType, quality);
  });

  item.blob = blob;
  item.status = "ok";

  if (foundTags.length) {
    item.detail = `Removed ${foundTags.length} EXIF field(s), including: ${foundTags.slice(0, 5).join(", ")}${foundTags.length > 5 ? ", …" : ""}. Also stripped any ICC/XMP/IPTC data and embedded thumbnails.`;
  } else {
    item.detail = "Redrawn through a blank canvas and re-encoded — this strips EXIF, ICC, XMP, IPTC, and embedded thumbnails, whether or not any were detectable beforehand.";
  }
}

function readExifTags(file) {
  return new Promise(resolve => {
    try {
      // exif-js expects a plain object with an image-like interface;
      // reading directly off the File object works in-browser.
      window.EXIF.getData(file, function () {
        const allTags = window.EXIF.getAllTags(this) || {};
        const keys = Object.keys(allTags).filter(k => allTags[k] !== undefined && allTags[k] !== null);
        resolve(keys);
      });
    } catch (_) {
      resolve([]);
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode image"));
    img.src = src;
  });
}

/* ---------- PDF cleaning ---------- */
async function cleanPdf(item) {
  const { file } = item;
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer, { updateMetadata: false });

  // Standard info dictionary
  pdfDoc.setTitle("");
  pdfDoc.setAuthor("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer("");
  pdfDoc.setCreator("");
  pdfDoc.setCreationDate(new Date(0));
  pdfDoc.setModificationDate(new Date(0));

  const removed = ["document info (title/author/subject/producer/creator/dates)"];

  // XMP metadata stream, embedded files, and open-action JavaScript
  // live on the document catalog and aren't covered by the info dict.
  try {
    const catalog = pdfDoc.catalog;
    if (catalog.get(PDFLib.PDFName.of("Metadata"))) {
      catalog.delete(PDFLib.PDFName.of("Metadata"));
      removed.push("XMP metadata stream");
    }
    if (catalog.get(PDFLib.PDFName.of("Names"))) {
      catalog.delete(PDFLib.PDFName.of("Names"));
      removed.push("embedded files / named attachments");
    }
    if (catalog.get(PDFLib.PDFName.of("OpenAction"))) {
      catalog.delete(PDFLib.PDFName.of("OpenAction"));
      removed.push("open-action JavaScript");
    }
    if (catalog.get(PDFLib.PDFName.of("AA"))) {
      catalog.delete(PDFLib.PDFName.of("AA"));
      removed.push("additional-action scripts");
    }
  } catch (_) {
    // Catalog structure varies across PDF producers; if a given key
    // isn't present in the expected form we simply skip it.
  }

  const pdfBytes = await pdfDoc.save({ updateFieldAppearances: false });
  item.blob = new Blob([pdfBytes], { type: "application/pdf" });
  item.status = "ok";
  item.detail = `Removed: ${removed.join("; ")}. Note: form field values, digital signatures, and anything drawn directly into a page (e.g. a baked-in watermark) are not touched by this tool.`;
}

/* ---------- downloads ---------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

zipBtn.addEventListener("click", async () => {
  if (!cleanedBlobs.length) return;
  const zip = new JSZip();
  for (const { name, blob } of cleanedBlobs) {
    zip.file(name, blob);
  }
  const content = await zip.generateAsync({ type: "blob" });
  downloadBlob(content, "cleanslate_output.zip");
});
