/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Book } from "../data/books";
import { performSearch } from "../lib/search";

type Props = {
  books: Book[];
  onFilterChange: (filtered: Book[]) => void;
};

// Fixed genre set shown in archival order (matches the shelf's catalogue)
const GENRE_FILTERS: { label: string; match: string }[] = [
  { label: "All", match: "" },
  { label: "Nonfiction", match: "Nonfiction" },
  { label: "Fiction", match: "Fiction" },
  { label: "Sci-Fi", match: "Sci-Fi" },
  { label: "Mystery & Thriller", match: "Mystery & Thriller" },
  { label: "Fantasy", match: "Fantasy" },
  { label: "Romance", match: "Romance" },
];

export function LibraryFilter({ books, onFilterChange }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedGenre, setSelectedGenre] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const [aiMatchedIds, setAiMatchedIds] = useState<string[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Keep only genres that actually exist in the collection, preserving order
  const visibleFilters = useMemo(() => {
    const present = new Set<string>();
    for (const book of books) {
      for (const g of book.genres || []) present.add(g);
    }
    return GENRE_FILTERS.filter((f) => !f.match || present.has(f.match));
  }, [books]);

  // Debounce search query input by 600ms
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setDebouncedQuery("");
      setAiMatchedIds(null);
      setSearching(false);
      setSearchError(null);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 600);

    return () => clearTimeout(timer);
  }, [query]);

  // Execute search when debouncedQuery updates
  useEffect(() => {
    if (!debouncedQuery) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setSearching(true);
    setSearchError(null);

    performSearch(debouncedQuery, books, controller.signal)
      .then((ids) => {
        if (!controller.signal.aborted) {
          setAiMatchedIds(ids);
          setSearching(false);
        }
      })
      .catch((err) => {
        if ((err as Error)?.name !== "AbortError") {
          setSearchError("Search temporarily unavailable.");
          setAiMatchedIds([]);
          setSearching(false);
        }
      });

    return () => controller.abort();
  }, [debouncedQuery, books]);

  // Notify parent of filtered books whenever AI results or genre selection change
  useEffect(() => {
    let result: Book[] = books;

    if (aiMatchedIds !== null) {
      const bookMap = new Map(books.map((b) => [b.id, b]));
      result = aiMatchedIds
        .map((id) => bookMap.get(id))
        .filter((b): b is Book => b !== undefined);
    }

    if (selectedGenre) {
      result = result.filter((b) => b.genres?.includes(selectedGenre));
    }

    onFilterChange(result);
  }, [books, aiMatchedIds, selectedGenre, onFilterChange]);

  const clearQuery = () => {
    setQuery("");
    setDebouncedQuery("");
    setAiMatchedIds(null);
    setSearchError(null);
  };

  const statusText = searching
    ? "Reading the shelves…"
    : searchError
      ? searchError
      : debouncedQuery && aiMatchedIds !== null
        ? `${aiMatchedIds.length} ${aiMatchedIds.length === 1 ? "volume found" : "volumes found"}`
        : null;

  return (
    <div className="mx-auto flex w-full flex-col items-center px-6 pt-1">
      {/* Editorial search inscription — reads as an engraved prompt, not an input box */}
      <div className="relative flex w-full items-end justify-center">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the archive"
          placeholder="What are you looking for?"
          className="w-full max-w-xl border-0 bg-transparent text-center font-display text-[clamp(1rem,1.35vw,1.2rem)] font-light italic leading-tight text-foreground caret-primary/60 outline-none placeholder:text-muted-foreground/90 transition-opacity duration-200 focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="Clear search"
            className="absolute right-0 top-1/2 -translate-y-1/2 p-1 font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground sm:right-[calc(50%-19rem)]"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* Search status — tiny archival annotation, absolutely positioned so it never reserves layout space */}
      <div className="relative h-0" aria-live="polite">
        {statusText ? (
          <p
            className={`absolute inset-x-0 top-1 text-center font-mono text-[10px] uppercase tracking-[0.22em] opacity-100 transition-all duration-250 ${searchError ? "text-destructive" : "text-muted-foreground/80"}`}
          >
            {statusText}
          </p>
        ) : null}
      </div>

      {/* Thin horizontal rule — central ~46% of the viewport */}
      <div className="mt-2 h-px w-[min(46vw,720px)] min-w-[300px] bg-foreground/15" />

      {/* Genre pills — one compact archival row */}
      <div className="no-scrollbar mt-2 flex max-w-full flex-nowrap items-center justify-center gap-[7px] overflow-x-auto px-2 sm:gap-2">
        {visibleFilters.map(({ label, match }) => {
          const active = selectedGenre === match;
          return (
            <button
              key={label}
              type="button"
              onClick={() => setSelectedGenre((cur) => (cur === match ? "" : match))}
              aria-pressed={active}
              className={`shrink-0 rounded-full border px-3.5 py-[5px] font-mono text-[10px] uppercase tracking-[0.22em] transition-all duration-250 ease-out ${
                active
                  ? "border-foreground/25 bg-card/70 text-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
                  : "border-foreground/12 bg-transparent text-muted-foreground hover:border-foreground/25 hover:text-foreground/80"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
