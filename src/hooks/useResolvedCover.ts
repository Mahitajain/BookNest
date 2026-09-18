import { useCallback, useEffect, useState } from "react";
import type { Book } from "../data/books";
import {
  coverAtSize,
  getCachedCover,
  invalidateCover,
  isStableCover,
  resolveCover,
} from "../lib/coverResolver";

type Options = {
  /** Skip network work until the book is actually near the viewport. */
  active?: boolean;
  size?: "S" | "M" | "L";
};

/**
 * Returns the best known cover URL for a book plus an error handler that
 * demotes a dead URL and re-resolves once.
 *
 * Books whose recorded cover is already a stable https asset resolve
 * synchronously from cache and never touch the network.
 */
export function useResolvedCover(book: Book, { active = true, size = "M" }: Options = {}) {
  const cached = getCachedCover(book.id);
  const initial =
    cached?.url ??
    (isStableCover(book.cover) ? coverAtSize(book.cover, size) : null);

  const [url, setUrl] = useState<string | null>(initial);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    if (url && !failed) return;
    let cancelled = false;
    resolveCover(book).then((resolved) => {
      if (cancelled) return;
      setUrl(resolved.url ? coverAtSize(resolved.url, size) : null);
      setFailed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active, book, failed, size, url]);

  const onError = useCallback(() => {
    if (url) invalidateCover(book.id, url);
    setUrl(null);
    setFailed(true);
  }, [book.id, url]);

  return { coverUrl: url, onCoverError: onError };
}
