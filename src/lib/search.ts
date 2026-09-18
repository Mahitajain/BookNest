import type { Book } from "../data/books";

export async function performSearch(
  query: string,
  books: Book[],
  signal?: AbortSignal,
): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed }),
      signal,
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.ids) && data.ids.length > 0) {
        // Validate IDs against real books array
        const validSet = new Set(books.map((b) => b.id));
        const filtered = data.ids.filter((id: string) => validSet.has(id));
        if (filtered.length > 0) {
          return filtered.slice(0, 20);
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.name === "AbortError") {
      throw err;
    }
  }

  // Fallback to local smart search if API call fails or OPENAI_API_KEY is missing
  return localSearch(trimmed, books);
}

export function localSearch(query: string, books: Book[]): string[] {
  const q = query.toLowerCase().trim();
  const tokens = q.split(/\s+/).filter(Boolean);

  const isShortBooksQuery = /short\s*(book|volume|read|story|stories)/.test(q);

  const scored: { id: string; score: number }[] = [];

  for (const b of books) {
    let score = 0;
    const title = b.title.toLowerCase();
    const author = b.author.toLowerCase();
    const blurb = (b.blurb || "").toLowerCase();
    const genres = (b.genres || []).map((g) => g.toLowerCase());
    const genreStr = genres.join(" ");

    // Handle "short books" query
    if (isShortBooksQuery) {
      if (b.width < 22) score += 5;
      if (b.binding === "mass" || b.binding === "paperback") score += 2;
    }

    // Term matching
    for (const t of tokens) {
      if (t === "book" || t === "books" || t === "with" || t === "and" || t === "the" || t === "for") continue;

      // Genre exact/substring match
      if (genres.some((g) => g.includes(t) || t.includes(g))) {
        score += 10;
      }
      if (genreStr.includes(t)) {
        score += 8;
      }

      // Title match
      if (title.includes(t)) {
        score += 6;
      }

      // Author match
      if (author.includes(t)) {
        score += 5;
      }

      // Blurb match
      if (blurb.includes(t)) {
        score += 3;
      }

      // Synonym & domain heuristics
      if ((t === "scifi" || t === "sci-fi" || t === "science") && (genreStr.includes("sci-fi") || blurb.includes("future") || blurb.includes("space") || blurb.includes("technology"))) {
        score += 8;
      }
      if ((t === "cozy" || t === "romance") && (genreStr.includes("romance") || genreStr.includes("fantasy") || blurb.includes("love") || blurb.includes("heart"))) {
        score += 6;
      }
      if ((t === "mystery" || t === "unreliable" || t === "narrator" || t === "thriller" || t === "crime") && (genreStr.includes("mystery") || blurb.includes("murder") || blurb.includes("detective") || blurb.includes("secret") || blurb.includes("truth"))) {
        score += 7;
      }
      if (t === "nonfiction" && genreStr.includes("nonfiction")) {
        score += 10;
      }
    }

    if (score > 0) {
      scored.push({ id: b.id, score });
    }
  }

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20).map((item) => item.id);
}
