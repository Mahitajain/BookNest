import type { Book } from "../data/books";

export type OpenLibraryDoc = {
  key: string;
  title: string;
  author_name?: string[];
  author_key?: string[];
  isbn?: string[];
  cover_edition_key?: string;
  edition_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  number_of_pages_median?: number;
  publisher?: string[];
};

export type OpenLibrarySearchResult = {
  key: string;
  title: string;
  author: string;
  cover: string;
  year: number;
  pages: number;
  publisher: string;
};

export function normalizeIsbn(value: string): string {
  return value.replace(/[\s-'"=]/g, "").toUpperCase();
}

function titleWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2);
}

function isStrongTitleMatch(query: string, candidate: string): boolean {
  const words = titleWords(query);
  const candidateWords = new Set(titleWords(candidate));
  return words.length > 0 && words.filter((word) => candidateWords.has(word)).length / words.length >= 0.65;
}

function isStrongAuthorMatch(query: string, candidate: string): boolean {
  const queryWords = titleWords(query);
  const candidateWords = new Set(titleWords(candidate));
  return queryWords.length > 0 && queryWords.some((word) => candidateWords.has(word));
}

export function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function unit(h: number, salt: number): number {
  return ((h >>> salt) & 0xffff) / 0xffff;
}

export function clamp(n: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, n));
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const hex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(rgb[0])}${hex(rgb[1])}${hex(rgb[2])}`;
}

export function paletteFromHash(key: string): { spine: string; band: string; ink: string } {
  const h = hashKey(key);
  const hue = unit(h, 0) * 360;
  const spine = hslToHex(hue, 0.28 + unit(h, 4) * 0.25, 0.28 + unit(h, 8) * 0.12);
  const band = hslToHex((hue + 18) % 360, 0.4, 0.42);
  const lum = 0.28 + unit(h, 8) * 0.12;
  const ink = lum > 0.55 ? "#241f19" : "#faf7f0";
  return { spine, band, ink };
}

export function physicalFromPages(pages: number, key: string) {
  const h = hashKey(key);
  const jitter = (unit(h, 2) - 0.5) * 6;
  const binding: Book["binding"] =
    pages > 420 ? "hardcover" : pages < 260 ? "mass" : "paperback";
  const finish: Book["finish"] =
    binding === "hardcover" ? "cloth" : unit(h, 5) > 0.5 ? "gloss" : "matte";
  const height =
    binding === "hardcover"
      ? Math.round(236 + unit(h, 6) * 18)
      : binding === "mass"
        ? Math.round(196 + unit(h, 6) * 14)
        : Math.round(214 + unit(h, 6) * 16);
  const width = Math.round(clamp(pages * 0.07 + jitter, 22, 68));
  const lean = Number((-(unit(h, 7) * 5)).toFixed(2));
  const depth = Number((unit(h, 9) * 14 - 7).toFixed(2));
  const wear = Number((unit(h, 11) * 0.35).toFixed(2));
  const faceRoll = unit(h, 13);
  const face: Book["face"] =
    faceRoll < 0.62 ? "serif" : faceRoll < 0.84 ? "sans" : "mono";
  const caps = unit(h, 15) > 0.72;
  return { binding, finish, height, width, lean, depth, wear, face, caps };
}

export async function readCoverPalette(
  src: string,
  fallbackKey: string = "default",
): Promise<{ spine: string; band: string; ink: string }> {
  if (!src || typeof window === "undefined") {
    return paletteFromHash(fallbackKey);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const w = 80;
        const h = Math.round((img.height / img.width) * w) || 120;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(paletteFromHash(fallbackKey));
          return;
        }

        ctx.drawImage(img, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        const edgeW = Math.max(1, Math.round(w * 0.06));
        let spineRed = 0;
        let spineGreen = 0;
        let spineBlue = 0;
        let count = 0;
        let bestSat = -1;
        let bandRed = 0;
        let bandGreen = 0;
        let bandBlue = 0;

        for (let x = 0; x < edgeW; x++) {
          for (let y = 0; y < h; y += 2) {
            const idx = (y * w + x) * 4;
            spineRed += data[idx];
            spineGreen += data[idx + 1];
            spineBlue += data[idx + 2];
            count++;
          }
        }

        for (let x = 0; x < w; x += 3) {
          for (let y = 0; y < h; y += 3) {
            const idx = (y * w + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const mx = Math.max(r, g, b) / 255;
            const mn = Math.min(r, g, b) / 255;
            const l = (mx + mn) / 2;
            const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));

            if (l > 0.18 && l < 0.78 && s > bestSat) {
              bestSat = s;
              bandRed = r; bandGreen = g; bandBlue = b;
            }
          }
        }

        const avgR = Math.round(spineRed / (count || 1));
        const avgG = Math.round(spineGreen / (count || 1));
        const avgB = Math.round(spineBlue / (count || 1));

        const hex = (v: number) =>
          Math.max(0, Math.min(255, Math.round(v)))
            .toString(16)
            .padStart(2, "0");

        const spine = `#${hex(avgR)}${hex(avgG)}${hex(avgB)}`;
        const band = bestSat > 0.05 ? `#${hex(bandRed)}${hex(bandGreen)}${hex(bandBlue)}` : spine;
        const lum = (0.2126 * avgR + 0.7152 * avgG + 0.0722 * avgB) / 255;
        const ink = lum > 0.55 ? "#241f19" : "#faf7f0";

        resolve({ spine, band, ink });
      } catch {
        resolve(paletteFromHash(fallbackKey));
      }
    };

    img.onerror = () => {
      resolve(paletteFromHash(fallbackKey));
    };
  });
}

export async function searchBooks(
  query: string,
  signal?: AbortSignal,
): Promise<OpenLibrarySearchResult[]> {
  if (!query.trim() || query.length < 2) return [];

  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=key,title,author_name,first_publish_year,cover_i,cover_edition_key,number_of_pages_median,publisher`;

  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    const docs: OpenLibraryDoc[] = data.docs || [];

    return docs
      .filter((d) => d.title && d.cover_i && (isStrongTitleMatch(query, d.title) || isStrongAuthorMatch(query, d.author_name?.[0] || "")))
      .map((d) => ({
        key: d.key,
        title: d.title,
        author: d.author_name?.[0] || "Unknown Author",
        cover: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
        year: d.first_publish_year || 0,
        pages: d.number_of_pages_median || 280,
        publisher: d.publisher?.[0] || "",
      }));
  } catch {
    return [];
  }
}

export function buildBook(result: OpenLibrarySearchResult): Book {
  const phys = physicalFromPages(result.pages, result.key);
  const palette = paletteFromHash(result.key);

  const slug = result.title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 22);
  const id = `${slug || "book"}-${Date.now().toString(36)}`;

  return {
    id,
    title: result.title,
    author: result.author,
    genres: ["Fiction"],
    cover: result.cover,
    year: result.year,
    blurb: "",
    rating: 0,
    finished: "Just now",
    publisher: result.publisher,
    ...phys,
    ...palette,
  };
}
