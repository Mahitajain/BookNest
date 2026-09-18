import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const booksPath = join(root, "src", "data", "books.ts");
const csvPath = join(root, "goodreads_library_export.csv");
const requestCache = new Map();

// Goodreads omitted identifiers for this row, but these are the verified editions
// supplied for Night Shift. Keep them local to the repair process so existing data
// and the public Book type remain unchanged.
const knownIsbnOverrides = new Map([
  ["night shift (jack stapleton & laurie montgomery #13)|robin cook", [
    "9780593540183",
    "9780593540190",
    "9781529098792",
  ]],
]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function cleanIsbn(value) {
  return (value || "").replace(/[\s\-='"“”]/g, "").toUpperCase();
}

function isbnCandidates(row) {
  return [...new Set([
    cleanIsbn(row.ISBN13),
    cleanIsbn(row.ISBN),
  ].filter((isbn) => isbn.length === 10 || isbn.length === 13))];
}

function knownIsbns(title, author) {
  return knownIsbnOverrides.get(`${title}|${author}`.toLowerCase()) || [];
}

function words(value) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
}

function titleScore(expected, actual) {
  const expectedWords = new Set(words(expected));
  const actualWords = new Set(words(actual));
  if (!expectedWords.size || !actualWords.size) return 0;
  let shared = 0;
  for (const word of expectedWords) if (actualWords.has(word)) shared++;
  return shared / expectedWords.size;
}

function authorScore(expected, actual) {
  const expectedWords = words(expected);
  const actualWords = new Set(words(actual));
  return expectedWords.length && expectedWords.some((word) => actualWords.has(word)) ? 1 : 0;
}

async function fetchJson(url) {
  if (requestCache.has(url)) return requestCache.get(url);
  const promise = fetch(url, {
    headers: { "User-Agent": "BookNestLibrary/1.0" },
    signal: AbortSignal.timeout(8000),
  }).then(async (response) => (response.ok ? response.json() : null)).catch(() => null);
  requestCache.set(url, promise);
  return promise;
}

async function validImage(url) {
  if (!url) return false;
  const checkedUrl = url.includes("?") ? `${url}&default=false` : `${url}?default=false`;
  if (requestCache.has(`image:${checkedUrl}`)) return requestCache.get(`image:${checkedUrl}`);
  const promise = fetch(checkedUrl, {
    headers: { "User-Agent": "BookNestLibrary/1.0" },
    signal: AbortSignal.timeout(8000),
  }).then(async (response) => {
    if (!response.ok) return false;
    const bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get("content-type") || "";
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    return bytes.length > 1000 && (jpeg || png || webp || type.startsWith("image/"));
  }).catch(() => false);
  requestCache.set(`image:${checkedUrl}`, promise);
  return promise;
}

async function firstValid(candidates) {
  for (const candidate of candidates) {
    if (candidate?.url && await validImage(candidate.url)) return candidate;
  }
  return null;
}

function coverIdUrl(id) {
  return `https://covers.openlibrary.org/b/id/${id}-L.jpg?default=false`;
}

function isbnUrl(isbn) {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
}

async function searchOpenLibrary(url, expectedTitle, expectedAuthor, expectedYear) {
  const data = await fetchJson(url);
  const docs = data?.docs || [];
  const ranked = docs.map((doc) => {
    const title = titleScore(expectedTitle, doc.title || "");
    const author = authorScore(expectedAuthor, doc.author_name?.[0] || "");
    const yearDistance = expectedYear && doc.first_publish_year ? Math.min(Math.abs(expectedYear - doc.first_publish_year), 30) : 10;
    return { doc, score: title * 5 + author * 3 - yearDistance / 30 };
  }).sort((a, b) => b.score - a.score);
  return ranked;
}

async function repairBook(book, goodreads) {
  const isbnList = [...new Set([...knownIsbns(book.title, book.author), ...isbnCandidates(goodreads)])];
  for (const isbn of isbnList) {
    const direct = await firstValid([{ source: "openlibrary-isbn", url: isbnUrl(isbn) }]);
    if (direct) return direct;

    const api = await fetchJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`);
    const edition = api?.[`ISBN:${isbn}`];
    const editionCover = edition?.cover?.large || edition?.cover?.medium;
    const fromEdition = await firstValid([{ source: "openlibrary-edition", url: editionCover }]);
    if (fromEdition) return fromEdition;

    const isbnSearch = await searchOpenLibrary(`https://openlibrary.org/search.json?isbn=${isbn}&limit=10&fields=title,author_name,first_publish_year,isbn,cover_i,edition_key`, book.title, book.author, book.year);
    for (const { doc } of isbnSearch) {
      const exact = doc.isbn?.some((value) => cleanIsbn(value) === isbn);
      if (!exact) continue;
      const match = await firstValid([
        doc.cover_i && { source: "openlibrary-search", url: coverIdUrl(doc.cover_i) },
        ...(doc.edition_key || []).map((id) => ({ source: "openlibrary-edition", url: `https://covers.openlibrary.org/b/olid/${id}-L.jpg?default=false` })),
      ]);
      if (match) return match;
    }
  }

  const titleAuthor = await searchOpenLibrary(`https://openlibrary.org/search.json?title=${encodeURIComponent(book.title)}&author=${encodeURIComponent(book.author)}&limit=10&fields=key,title,author_name,first_publish_year,isbn,cover_i,edition_key`, book.title, book.author, book.year);
  for (const { doc, score } of titleAuthor) {
    if (score < 5) continue;
    const match = await firstValid([
      doc.cover_i && { source: "openlibrary-search", url: coverIdUrl(doc.cover_i) },
      ...(doc.edition_key || []).map((id) => ({ source: "openlibrary-edition", url: `https://covers.openlibrary.org/b/olid/${id}-L.jpg?default=false` })),
    ]);
    if (match) return match;
    if (doc.key?.startsWith("/works/")) {
      const work = await fetchJson(`https://openlibrary.org${doc.key}.json`);
      const workCover = await firstValid((work?.covers || []).map((id) => ({ source: "openlibrary-work", url: coverIdUrl(id) })));
      if (workCover) return workCover;
    }
  }

  const google = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}&maxResults=10`);
  const googleItem = google?.items?.find((item) => titleScore(book.title, item.volumeInfo?.title || "") >= 0.65 && authorScore(book.author, item.volumeInfo?.authors?.[0] || ""));
  const googleCover = googleItem?.volumeInfo?.imageLinks?.thumbnail?.replace(/^http:/, "https:");
  return firstValid([{ source: "google-books", url: googleCover }]);
}

const booksText = await readFile(booksPath, "utf8");
const csvRows = parseCsv(await readFile(csvPath, "utf8"));
const headers = csvRows[0] || [];
const csvBooks = csvRows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
const byTitleAuthor = new Map(csvBooks.map((row) => [`${row.Title}|${row.Author}`.toLowerCase(), row]));
const reports = [];
let repairedText = booksText;

const blockPattern = /  \{\n([\s\S]*?)\n  \},?/g;
for (const match of [...booksText.matchAll(blockPattern)]) {
  const block = match[0];
  const titleValue = block.match(/title: "((?:\\.|[^"])*)"/)?.[1];
  const authorValue = block.match(/author: "((?:\\.|[^"])*)"/)?.[1];
  const title = titleValue ? JSON.parse(`"${titleValue}"`) : "";
  const author = authorValue ? JSON.parse(`"${authorValue}"`) : "";
  const cover = block.match(/cover: "([^"]*)"/)?.[1];
  if (!title || cover) continue;
  const csvBook = byTitleAuthor.get(`${title}|${author}`.toLowerCase()) || {};
  const result = await repairBook({ title, author, year: Number(block.match(/year: (\d+)/)?.[1] || 0) }, csvBook);
  reports.push({
    title,
    isbn: [...new Set([...knownIsbns(title, author), ...isbnCandidates(csvBook)])].join(", ") || "unavailable",
    result,
  });
  if (result) {
    const updated = block.replace('cover: "",', `cover: ${JSON.stringify(result.url)},`);
    repairedText = repairedText.replace(block, updated);
  }
}

await writeFile(booksPath, repairedText);
for (const report of reports) {
  console.log(`Book: ${report.title}`);
  console.log(`ISBN: ${report.isbn}`);
  console.log(`Source: ${report.result?.source || "none"}`);
  console.log(`Cover: ${report.result ? "FOUND" : "NOT FOUND"}\n`);
}
console.log(`Repair summary: ${reports.length} checked, ${reports.filter((report) => report.result).length} recovered, ${reports.filter((report) => !report.result).length} still missing.`);
