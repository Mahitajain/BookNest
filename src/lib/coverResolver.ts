import type { Book } from "../data/books";

export type CoverSourceKind =
  | "existing"
  | "openlibrary-edition"
  | "fallback";

export type CoverSource = {
  url: string | null;
  source: CoverSourceKind;
  confidence: number;
  titleMatched?: string;
  authorMatched?: string;
  sourcePageUrl?: string;
  discoveredAt: string;
};

const CACHE_KEY = "booknest:cover-cache:v2";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Below this we prefer the deterministic fallback over a probably-wrong cover. */
const MIN_CONFIDENCE = 0.72;
/** Open Library is polite but finite; never fan out wider than this. */
const MAX_CONCURRENT = 3;

/**
 * Hosts that serve search-result thumbnails rather than stable cover assets.
 * They block hotlinking, rotate URLs, and ship 100px images — treat any cover
 * pointing at one of them as missing and re-resolve it properly.
 */
const UNSTABLE_HOSTS = [
  "encrypted-tbn0.gstatic.com",
  "encrypted-tbn1.gstatic.com",
  "encrypted-tbn2.gstatic.com",
  "encrypted-tbn3.gstatic.com",
  "lh3.googleusercontent.com",
];

export function isStableCover(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return !UNSTABLE_HOSTS.includes(parsed.host);
  } catch {
    return false;
  }
}

/**
 * Open Library serves S/M/L. The shelf never needs L — requesting it for a
 * 178px cover face wastes ~4x the bytes for no visible gain.
 */
export function coverAtSize(url: string, size: "S" | "M" | "L"): string {
  if (!url.includes("covers.openlibrary.org")) return url;
  return url.replace(/-(S|M|L)\.jpg(\?.*)?$/i, `-${size}.jpg$2`);
}

type CacheShape = Record<string, CoverSource>;

function readCache(): CacheShape {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CacheShape;
    const now = Date.now();
    const fresh: CacheShape = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!entry?.discoveredAt) continue;
      if (now - Date.parse(entry.discoveredAt) < CACHE_TTL_MS) fresh[id] = entry;
    }
    return fresh;
  } catch {
    return {};
  }
}

let cache: CacheShape | null = null;

function cacheAll(): CacheShape {
  if (!cache) cache = readCache();
  return cache;
}

function persist() {
  if (typeof localStorage === "undefined" || !cache) return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota or private mode — caching is an optimisation, not a requirement.
  }
}

export function getCachedCover(bookId: string): CoverSource | null {
  return cacheAll()[bookId] ?? null;
}

function putCachedCover(bookId: string, entry: CoverSource) {
  cacheAll()[bookId] = entry;
  persist();
}

/** Called when an <img> actually fails, so we never retry a dead URL forever. */
export function invalidateCover(bookId: string, url: string) {
  const entry = cacheAll()[bookId];
  if (entry && entry.url === url) {
    delete cacheAll()[bookId];
    persist();
  }
  deadUrls.add(url);
}

const deadUrls = new Set<string>();

export function isDeadCover(url: string | null | undefined): boolean {
  return !!url && deadUrls.has(url);
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

/** Jaccard-ish overlap of significant words, 0..1. */
function similarity(a: string, b: string): number {
  const left = words(a);
  const right = new Set(words(b));
  if (left.length === 0) return 0;
  return left.filter((word) => right.has(word)).length / left.length;
}

type OpenLibraryDoc = {
  title?: string;
  author_name?: string[];
  cover_i?: number;
  isbn?: string[];
  language?: string[];
  edition_key?: string[];
  key?: string;
};

/**
 * Level 2/3: the work may have many editions, and the edition Goodreads
 * exported is often the one without cover art. Search by title + author and
 * score every candidate rather than trusting the first hit.
 */
async function findOpenLibraryEdition(
  book: Book,
  signal?: AbortSignal,
): Promise<CoverSource | null> {
  const params = new URLSearchParams({
    title: book.title.replace(/\s*\([^)]*\)\s*$/, "").trim(),
    author: book.author,
    fields: "title,author_name,cover_i,isbn,language,edition_key,key",
    limit: "10",
  });

  const response = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
  if (!response.ok) return null;
  const data = (await response.json()) as { docs?: OpenLibraryDoc[] };
  const docs = (data.docs ?? []).filter((doc) => typeof doc.cover_i === "number");
  if (docs.length === 0) return null;

  let best: { doc: OpenLibraryDoc; score: number } | null = null;
  for (const doc of docs) {
    const titleScore = similarity(book.title, doc.title ?? "");
    const authorScore = similarity(book.author, (doc.author_name ?? []).join(" "));
    // Title carries most of the weight; author is the disambiguator that stops
    // "another book by the same author" from winning.
    let score = titleScore * 0.62 + authorScore * 0.33;
    if (doc.language?.includes("eng")) score += 0.05;
    if (!best || score > best.score) best = { doc, score };
  }
  if (!best) return null;

  const confidence = Math.min(0.95, Number(best.score.toFixed(2)));
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    url: `https://covers.openlibrary.org/b/id/${best.doc.cover_i}-M.jpg`,
    source: "openlibrary-edition",
    confidence,
    titleMatched: best.doc.title,
    authorMatched: best.doc.author_name?.[0],
    sourcePageUrl: best.doc.key ? `https://openlibrary.org${best.doc.key}` : undefined,
    discoveredAt: new Date().toISOString(),
  };
}

let inFlight = 0;
const queue: (() => void)[] = [];

function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(() => {
    inFlight++;
    resolve();
  }));
}

function release() {
  inFlight--;
  queue.shift()?.();
}

const pending = new Map<string, Promise<CoverSource>>();

/**
 * Resolve a usable cover for one book.
 *
 * cache -> existing stable cover -> Open Library edition search -> fallback.
 *
 * There is deliberately no external image-search step: no search provider is
 * configured, and scraping image results from the browser would both leak the
 * request pattern and depend on someone else's DOM. When that capability
 * exists it belongs behind the API, not here — see notes in the README.
 */
export function resolveCover(book: Book): Promise<CoverSource> {
  const cached = getCachedCover(book.id);
  if (cached && !isDeadCover(cached.url)) return Promise.resolve(cached);

  const existing = pending.get(book.id);
  if (existing) return existing;

  const fallback: CoverSource = {
    url: null,
    source: "fallback",
    confidence: 0,
    discoveredAt: new Date().toISOString(),
  };

  const run = (async (): Promise<CoverSource> => {
    if (isStableCover(book.cover) && !isDeadCover(book.cover)) {
      const entry: CoverSource = {
        url: coverAtSize(book.cover, "M"),
        source: "existing",
        confidence: 1,
        discoveredAt: new Date().toISOString(),
      };
      putCachedCover(book.id, entry);
      return entry;
    }

    await acquire();
    try {
      const edition = await findOpenLibraryEdition(book);
      if (edition) {
        putCachedCover(book.id, edition);
        return edition;
      }
    } catch {
      // Network failure is not a permanent answer — don't poison the cache.
      return fallback;
    } finally {
      release();
    }

    putCachedCover(book.id, fallback);
    return fallback;
  })();

  pending.set(book.id, run);
  run.finally(() => pending.delete(book.id));
  return run;
}
