import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const csvPath = join(root, "goodreads_library_export.csv");
const outPath = join(root, "src", "data", "books.ts");

const ALLOWED = [
  "Fiction",
  "Nonfiction",
  "Sci-Fi",
  "Mystery & Thriller",
  "Fantasy",
  "Romance",
];

/**
 * Matching key for "is this book already on the shelf?" — title + author,
 * lowercased and stripped of punctuation, is stable across minor formatting
 * differences between a Goodreads export and a hand-typed record, without
 * depending on `id` (which manual entries won't share with a Goodreads slug).
 */
function bookKey(title, author) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(title)}|${norm(author)}`;
}

/**
 * Load the current src/data/books.ts as plain data, by stripping its types
 * with the TypeScript compiler (already a devDependency) and importing the
 * resulting JS from a throwaway temp file. This is the existing shelf —
 * every entry, including any cover URL fixed by hand, is carried through
 * completely untouched.
 */
async function loadExistingBooks() {
  let source;
  try {
    source = await readFile(outPath, "utf8");
  } catch {
    return [];
  }
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tempPath = join(tmpdir(), `booknest-books-${Date.now()}.mjs`);
  await writeFile(tempPath, js);
  try {
    const mod = await import(pathToFileURL(tempPath).href);
    return Array.isArray(mod.books) ? mod.books : [];
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function cleanIsbn(raw) {
  return (raw || "").replace(/[="'\s-]/g, "").toUpperCase();
}

function isbnCandidates(isbn) {
  const normalized = cleanIsbn(isbn);
  if (!normalized) return [];
  if (normalized.length === 10) {
    const body = normalized.slice(0, 9);
    const sum = body.split("").reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
    const check = (11 - (sum % 11)) % 11;
    return [normalized, `978${body}${check === 10 ? "X" : check}`];
  }
  if (normalized.length === 13 && normalized.startsWith("978")) {
    const body = normalized.slice(3, 12);
    const sum = body.split("").reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
    const check = (11 - (sum % 11)) % 11;
    return [normalized, `${body}${check === 10 ? "X" : check}`];
  }
  return [normalized];
}

function titleWords(value) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
}

function strongTitleMatch(query, candidate) {
  const words = titleWords(query);
  const candidateWords = new Set(titleWords(candidate));
  return words.length > 0 && words.filter((word) => candidateWords.has(word)).length / words.length >= 0.65;
}

function strongAuthorMatch(query, candidate) {
  const queryWords = titleWords(query);
  const candidateWords = new Set(titleWords(candidate));
  return queryWords.some((word) => candidateWords.has(word));
}

function slugify(title, index) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 22);
  return `${slug || "book"}-${index}`;
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unit(h, salt) {
  return ((h >>> salt) & 0xffff) / 0xffff;
}

function clamp(n, a, b) {
  return Math.min(b, Math.max(a, n));
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const hex = (v) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function paletteFromHash(key) {
  const h = hashKey(key);
  const hue = unit(h, 0) * 360;
  const spine = hslToHex(hue, 0.28 + unit(h, 4) * 0.25, 0.28 + unit(h, 8) * 0.12);
  const band = hslToHex((hue + 18) % 360, 0.4, 0.42);
  const lum = 0.28 + unit(h, 8) * 0.12;
  const ink = lum > 0.55 ? "#241f19" : "#faf7f0";
  return { spine, band, ink };
}

function formatFinished(dateRead, dateAdded) {
  const src = dateRead || dateAdded || "";
  if (!src) return "";
  const d = new Date(src.replace(/\//g, "-"));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function mapGenres(subjects, title, author) {
  const blob = `${(subjects || []).join(" ")} ${title} ${author}`.toLowerCase();
  const out = new Set();
  if (/science fiction|\bsci-?fi\b|cyberpunk|dystopia/.test(blob)) out.add("Sci-Fi");
  if (/\bfantasy\b|faerie|fairy|magic kingdom|dragon/.test(blob)) out.add("Fantasy");
  if (/\bromance\b/.test(blob)) out.add("Romance");
  if (
    /mystery|thriller|crime|detective|sherlock|holmes|housemaid|kidnap/.test(
      blob,
    )
  ) {
    out.add("Mystery & Thriller");
  }
  if (/literary fiction/.test(blob)) out.add("Fiction");
  if (/\bfiction\b|\bnovel\b/.test(blob) && !/non-?fiction/.test(blob)) {
    out.add("Fiction");
  }
  if (out.size === 0) out.add("Nonfiction");
  return [...out].filter((g) => ALLOWED.includes(g));
}

function physicalFromPages(pages, key) {
  const h = hashKey(key);
  const jitter = (unit(h, 2) - 0.5) * 6;
  const binding =
    pages > 420 ? "hardcover" : pages < 260 ? "mass" : "paperback";
  const finish =
    binding === "hardcover" ? "cloth" : unit(h, 5) > 0.5 ? "gloss" : "matte";
  const height =
    binding === "hardcover"
      ? Math.round(236 + unit(h, 6) * 18)
      : binding === "mass"
        ? Math.round(196 + unit(h, 6) * 14)
        : Math.round(214 + unit(h, 6) * 16);
  const width = Math.round(clamp(pages * 0.07 + jitter, 22, 68));
  const lean = -(unit(h, 7) * 5);
  const depth = unit(h, 9) * 14 - 7;
  const wear = unit(h, 11) * 0.35;
  const faceRoll = unit(h, 13);
  const face = faceRoll < 0.62 ? "serif" : faceRoll < 0.84 ? "sans" : "mono";
  const caps = unit(h, 15) > 0.72;
  return { binding, finish, height, width, lean, depth, wear, face, caps };
}

function rgbToHex(r, g, b) {
  const hex = (v) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function lumOf(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function satOf(r, g, b) {
  const mx = Math.max(r, g, b) / 255;
  const mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  if (mx === mn) return 0;
  return (mx - mn) / (1 - Math.abs(2 * l - 1));
}

async function sampleCover(url) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = join(tmpdir(), `bn-cover-${Date.now()}-${Math.random()}.jpg`);
    await writeFile(tmp, buf);
    const ps = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Bitmap]::FromFile('${tmp.replace(/'/g, "''")}')
$w = $img.Width; $h = $img.Height
$edgeW = [Math]::Max(1, [int][Math]::Round($w * 0.06))
$sr=0; $sg=0; $sb=0; $n=0
$bestSat=-1; $br=0; $bg=0; $bb=0
for ($x=0; $x -lt $edgeW; $x++) {
  for ($y=0; $y -lt $h; $y+=2) {
    $c = $img.GetPixel($x,$y)
    $sr += $c.R; $sg += $c.G; $sb += $c.B; $n++
  }
}
for ($x=0; $x -lt $w; $x+=3) {
  for ($y=0; $y -lt $h; $y+=3) {
    $c = $img.GetPixel($x,$y)
    $mx = [Math]::Max($c.R,[Math]::Max($c.G,$c.B))/255
    $mn = [Math]::Min($c.R,[Math]::Min($c.G,$c.B))/255
    $l = ($mx+$mn)/2
    $s = if ($mx -eq $mn) { 0 } else { ($mx-$mn)/(1-[Math]::Abs(2*$l-1)) }
    if ($l -gt 0.18 -and $l -lt 0.78 -and $s -gt $bestSat) {
      $bestSat=$s; $br=$c.R; $bg=$c.G; $bb=$c.B
    }
  }
}
$img.Dispose()
Write-Output "$([int]($sr/$n)),$([int]($sg/$n)),$([int]($sb/$n)),$br,$bg,$bb"
`;
    const out = await new Promise((resolve, reject) => {
      const child = spawn(
        "powershell",
        ["-NoProfile", "-Command", ps],
        { windowsHide: true },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(stderr || `ps exit ${code}`));
        else resolve(stdout.trim());
      });
    });
    await unlink(tmp).catch(() => {});
    const [r, g, b, br, bg, bb] = out.split(",").map((n) => Number(n));
    if (![r, g, b].every((n) => Number.isFinite(n))) return null;
    const spine = rgbToHex(r, g, b);
    const band =
      Number.isFinite(br) && satOf(br, bg, bb) > 0.05
        ? rgbToHex(br, bg, bb)
        : spine;
    const ink = lumOf(r, g, b) > 0.55 ? "#241f19" : "#faf7f0";
    return { spine, band, ink };
  } catch {
    return null;
  }
}

async function olSearch({ isbn, title, author }) {
  const tryUrls = [];
  for (const candidate of isbnCandidates(isbn)) {
    tryUrls.push(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(candidate)}&limit=5`);
  }
  tryUrls.push(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=5`,
  );
  tryUrls.push(
    `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&limit=10`,
  );
  try {
    for (const url of tryUrls) {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": "BookNestLibrary/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const docs = data.docs || [];
      const doc = docs.find((candidate) => candidate.title && candidate.cover_i && strongTitleMatch(title, candidate.title) && (!candidate.author_name?.length || strongAuthorMatch(author, candidate.author_name[0]))) ||
        docs.find((candidate) => candidate.title && strongTitleMatch(title, candidate.title));
      if (doc?.title) return doc;
    }
  } catch {
    // A failed public search should not prevent the remaining books from importing.
  }
  return null;
}

async function validImageUrl(url) {
  if (!url) return false;
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": "BookNestLibrary/1.0" } });
    if (!res.ok) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    const jpeg = bytes.length > 1000 && bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes.length > 1000 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const webp = bytes.length > 1000 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    const type = res.headers.get("content-type") || "";
    return jpeg || png || webp || (bytes.length > 1000 && type.startsWith("image/"));
  } catch {
    return false;
  }
}

async function findCover({ isbn, doc, title, author }) {
  for (const candidate of isbnCandidates(isbn)) {
    const direct = `https://covers.openlibrary.org/isbn/${candidate}-L.jpg`;
    if (await validImageUrl(direct)) return direct;
  }

  if (doc?.cover_i) {
    const cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
    if (await validImageUrl(cover)) return cover;
  }

  for (const edition of doc?.edition_key || []) {
    const cover = `https://covers.openlibrary.org/b/olid/${edition}-L.jpg`;
    if (await validImageUrl(cover)) return cover;
  }

  try {
    const response = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(title)}+inauthor:${encodeURIComponent(author)}&maxResults=5`);
    if (response.ok) {
      const data = await response.json();
      const match = data.items?.find((item) => item.volumeInfo?.imageLinks?.thumbnail);
      const thumbnail = match?.volumeInfo?.imageLinks?.thumbnail?.replace(/^http:/, "https:");
      if (thumbnail && await validImageUrl(thumbnail)) return thumbnail;
    }
  } catch {
    // A missing public cover should leave the original book intact.
  }

  return "";
}

async function olBlurb(workKey) {
  if (!workKey) return "";
  try {
    const res = await fetchWithTimeout(`https://openlibrary.org${workKey}.json`, {
      headers: { "User-Agent": "BookNestLibrary/1.0" },
    });
    if (!res.ok) return "";
    const data = await res.json();
    const d = data.description;
    const text = typeof d === "string" ? d : d?.value || "";
    return text.replace(/\s+/g, " ").trim().slice(0, 420);
  } catch {
    return "";
  }
}

function jsString(s) {
  return JSON.stringify(s ?? "");
}

const existingBooks = await loadExistingBooks();
const existingKeys = new Set(existingBooks.map((b) => bookKey(b.title, b.author)));
const existingIds = new Set(existingBooks.map((b) => b.id));

const rows = parseCsv(await readFile(csvPath, "utf8"));
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const books = [];
let alreadyPresent = 0;

for (const row of rows.slice(1)) {
  if (!row.length || row.every((c) => !c)) continue;
  const shelf = (row[idx["Exclusive Shelf"]] || "").trim().toLowerCase();
  if (shelf !== "read" && shelf !== "currently-reading") continue;
  const title = row[idx.Title]?.trim() || "Untitled";
  const author = row[idx.Author]?.trim() || "";
  if (existingKeys.has(bookKey(title, author))) {
    alreadyPresent++;
    continue;
  }
  books.push({
    title,
    author,
    isbn: cleanIsbn(row[idx.ISBN13]) || cleanIsbn(row[idx.ISBN]),
    rating: Number(row[idx["My Rating"]]) || 0,
    publisher: row[idx.Publisher]?.trim() || "",
    pages: Number(row[idx["Number of Pages"]]) || 0,
    year:
      Number(row[idx["Original Publication Year"]]) ||
      Number(row[idx["Year Published"]]) ||
      0,
    finished: formatFinished(row[idx["Date Read"]], row[idx["Date Added"]]),
  });
}

console.log(
  `${existingBooks.length} already on the shelf, ${alreadyPresent} in the export already present, ${books.length} new.`,
);

if (books.length === 0) {
  console.log("Nothing new to import — the shelf already matches the export.");
  process.exit(0);
}

const built = [];
for (let i = 0; i < books.length; i++) {
  const b = books[i];
  process.stdout.write(`Importing ${i + 1}/${books.length}: ${b.title}\n`);
  const doc = await olSearch(b);
  await new Promise((r) => setTimeout(r, 180));
  const key = doc?.key || `local:${b.title}:${b.author}`;
  const cover = await findCover({ isbn: b.isbn, doc, title: b.title, author: b.author });
  const pages =
    b.pages ||
    doc?.number_of_pages_median ||
    280;
  const phys = physicalFromPages(pages, key);
  let palette = paletteFromHash(key);
  if (cover) {
    const sampled = await sampleCover(
      cover.replace("-L.jpg", "-M.jpg"),
    );
    if (sampled) palette = sampled;
  }
  const blurb =
    (await olBlurb(doc?.key?.startsWith("/works/") ? doc.key : doc?.key)) ||
    (Array.isArray(doc?.first_sentence)
      ? doc.first_sentence.join(" ")
      : doc?.first_sentence || "");
  const publisher =
    b.publisher ||
    (Array.isArray(doc?.publisher) ? doc.publisher[0] : "") ||
    "";
  const year = b.year || doc?.first_publish_year || 0;
  const genres = mapGenres(doc?.subject, b.title, b.author);
  const rating = Number.isFinite(b.rating) ? Math.round(b.rating) : 0;
  // A fresh slug can collide with an id already on the shelf (or with one
  // generated earlier in this same run); keep incrementing until it's unique.
  let id = slugify(b.title, i);
  let bump = i;
  while (existingIds.has(id)) {
    bump++;
    id = slugify(b.title, bump);
  }
  existingIds.add(id);
  built.push({
    id,
    title: b.title,
    author: b.author,
    genres,
    cover,
    year,
    blurb: String(blurb).replace(/\s+/g, " ").trim(),
    rating,
    finished: b.finished,
    publisher,
    ...phys,
    ...palette,
    sort: b.finished,
  });
}

// Existing entries pass straight through — nothing about them is
// regenerated, so a manually fixed `cover` (or any other hand-edited
// field) survives exactly as written. Only the array position changes,
// to keep the whole shelf sorted by "finished" like before.
const combined = [...existingBooks, ...built].sort((a, b) => {
  const da = Date.parse(a.finished) || 0;
  const db = Date.parse(b.finished) || 0;
  return db - da;
});

function num(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

const body = combined
  .map((book) => {
    const lines = [
      `  {`,
      `    id: ${jsString(book.id)},`,
      `    title: ${jsString(book.title)},`,
      `    author: ${jsString(book.author)},`,
      `    genres: ${JSON.stringify(book.genres ?? [])},`,
      `    cover: ${jsString(book.cover ?? "")},`,
      `    year: ${num(book.year, 0)},`,
      `    blurb: ${jsString(book.blurb ?? "")},`,
      `    rating: ${num(book.rating, 0)},`,
      `    finished: ${jsString(book.finished ?? "")},`,
    ];
    if (book.recommender) lines.push(`    recommender: ${jsString(book.recommender)},`);
    lines.push(
      `    publisher: ${jsString(book.publisher ?? "")},`,
      `    binding: ${jsString(book.binding ?? "paperback")},`,
      `    finish: ${jsString(book.finish ?? "matte")},`,
      `    spine: ${jsString(book.spine ?? "#6b6560")},`,
      `    band: ${jsString(book.band)},`,
      `    ink: ${jsString(book.ink ?? "#241f19")},`,
      `    face: ${jsString(book.face ?? "serif")},`,
      `    caps: ${Boolean(book.caps)},`,
      `    width: ${num(book.width, 32)},`,
      `    height: ${num(book.height, 220)},`,
      `    lean: ${Number(num(book.lean, 0).toFixed(2))},`,
      `    depth: ${Number(num(book.depth, 0).toFixed(2))},`,
      `    wear: ${Number(num(book.wear, 0.15).toFixed(2))},`,
    );
    if (book.spineImage) lines.push(`    spineImage: ${jsString(book.spineImage)},`);
    lines.push(`  }`);
    return lines.join("\n");
  })
  .join(",\n");

const file = `export type Book = {
  id: string;
  title: string;
  author: string;
  genres?: string[];
  cover: string;
  year: number;
  blurb: string;
  rating: number;
  finished: string;
  recommender?: string;
  publisher: string;
  binding: "hardcover" | "paperback" | "mass";
  finish: "cloth" | "gloss" | "matte";
  spine: string;
  band?: string;
  ink: string;
  face: "serif" | "sans" | "mono";
  caps?: boolean;
  width: number;
  height: number;
  lean: number;
  depth: number;
  wear: number;
  spineImage?: string;
};

export const books: Book[] = [
${body}
];
`;

await mkdir(join(root, "src", "data"), { recursive: true });
await writeFile(outPath, file);
console.log(
  `Wrote ${combined.length} books to ${outPath} (${existingBooks.length} kept as-is, ${built.length} newly added).`,
);

