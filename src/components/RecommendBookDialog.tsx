/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from "react";
import type { Book } from "../data/books";
import { buildBook, searchBooks, type OpenLibrarySearchResult } from "../lib/openLibrary";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onRecommend: (input: {
    recommender: string;
    note?: string;
    book: Book;
  }) => Promise<Book>;
};

export function RecommendBookDialog({ isOpen, onClose, onRecommend }: Props) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OpenLibrarySearchResult[]>([]);
  const [picked, setPicked] = useState<OpenLibrarySearchResult | null>(null);

  const [recommender, setRecommender] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce Open Library search by 280ms, min 2 chars, abortable
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = setTimeout(() => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      searchBooks(query.trim(), controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setResults(res);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setResults([]);
            setSearching(false);
          }
        });
    }, 280);

    return () => clearTimeout(timer);
  }, [query]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setPicked(null);
      setRecommender("");
      setNote("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return;

    setError(null);
    if (!recommender.trim() || recommender.trim().length > 60) {
      setError("Please enter your name (1 to 60 characters).");
      return;
    }
    if (note.trim().length > 500) {
      setError("Note must be 500 characters or less.");
      return;
    }

    setSubmitting(true);
    try {
      const generatedBook = buildBook(picked);
      await onRecommend({
        recommender: recommender.trim(),
        note: note.trim() || undefined,
        book: generatedBook,
      });
      onClose();
    } catch (err) {
      setError((err as Error)?.message || "Failed to submit recommendation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border/80 bg-card p-6 text-card-foreground shadow-2xl">
        <div className="flex items-center justify-between pb-4">
          <h2 className="font-display text-2xl italic text-foreground">
            Recommend a book
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ✕
          </button>
        </div>

        {!picked ? (
          /* Step 1: Search Open Library */
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Search Open Library
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by title or author…"
                  autoFocus
                  className="w-full rounded-md border border-border bg-background px-3.5 py-2 font-sans text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary"
                />
                {searching ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground animate-pulse">
                    Searching…
                  </span>
                ) : null}
              </div>
            </div>

            {/* Results List */}
            <div className="no-scrollbar max-h-64 flex flex-col gap-2 overflow-y-auto pr-1">
              {results.length > 0 ? (
                results.map((res) => (
                  <div
                    key={res.key}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-background/60 p-2.5 transition-all hover:border-primary/50 hover:bg-background"
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      {res.cover ? (
                        <img
                          src={res.cover}
                          alt=""
                          className="h-12 w-8 shrink-0 rounded object-cover shadow-sm"
                        />
                      ) : (
                        <div className="flex h-12 w-8 shrink-0 items-center justify-center rounded bg-muted font-mono text-[9px] text-muted-foreground">
                          No cover
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-display text-base text-foreground">
                          {res.title}
                        </p>
                        <p className="truncate font-sans text-xs text-muted-foreground">
                          {res.author} {res.year ? `(${res.year})` : ""}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPicked(res)}
                      className="ml-3 shrink-0 rounded-md bg-primary px-3 py-1 font-mono text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      Pick
                    </button>
                  </div>
                ))
              ) : query.trim().length >= 2 && !searching ? (
                <p className="py-6 text-center font-sans text-sm text-muted-foreground">
                  No books found on Open Library.
                </p>
              ) : (
                <p className="py-6 text-center font-sans text-sm text-muted-foreground/70">
                  Type at least 2 characters to search.
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Step 2: Picked book & visitor details */
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Picked book summary */}
            <div className="flex items-center justify-between rounded-lg border border-border/80 bg-background p-3">
              <div className="flex items-center gap-3">
                {picked.cover ? (
                  <img
                    src={picked.cover}
                    alt=""
                    className="h-14 w-9 shrink-0 rounded object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex h-14 w-9 shrink-0 items-center justify-center rounded bg-muted font-mono text-[9px] text-muted-foreground">
                    No cover
                  </div>
                )}
                <div>
                  <p className="font-display text-lg leading-snug text-foreground">
                    {picked.title}
                  </p>
                  <p className="font-sans text-xs text-muted-foreground">
                    {picked.author} {picked.year ? `(${picked.year})` : ""}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="font-mono text-xs text-muted-foreground underline hover:text-foreground"
              >
                Change
              </button>
            </div>

            {/* Your name */}
            <div>
              <label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Your name *
              </label>
              <input
                type="text"
                value={recommender}
                onChange={(e) => setRecommender(e.target.value)}
                placeholder="e.g. Maya"
                maxLength={60}
                required
                className="w-full rounded-md border border-border bg-background px-3.5 py-2 font-sans text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Why should I read it? */}
            <div>
              <label className="mb-1 block font-mono text-xs uppercase tracking-wider text-muted-foreground">
                Why should I read it? (optional)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Share a thought or reason…"
                rows={3}
                maxLength={500}
                className="w-full rounded-md border border-border bg-background px-3.5 py-2 font-sans text-sm outline-none transition-all placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {error ? (
              <p className="font-mono text-xs text-destructive">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-primary px-5 py-2 font-mono text-xs font-semibold text-primary-foreground shadow transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "Shelving…" : "Shelve Recommendation"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
