import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Cookbook } from "../lib/api";
import {
  COOKBOOK_SORT_KEY,
  COOKBOOK_SORTS,
  CookbookSort,
  isCookbookSort,
  sortCookbooks,
} from "../lib/cookbookSort";

export default function CookbookList() {
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<CookbookSort>(() => {
    const remembered = localStorage.getItem(COOKBOOK_SORT_KEY);
    return isCookbookSort(remembered) ? remembered : "recent";
  });

  useEffect(() => {
    api
      .getCookbooks()
      .then(setCookbooks)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Impossible de charger vos livres")
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(COOKBOOK_SORT_KEY, sort);
  }, [sort]);

  // Reordering is local, so changing the sort doesn't refetch.
  const sorted = useMemo(() => sortCookbooks(cookbooks, sort), [cookbooks, sort]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display text-3xl text-sage-dark">Mes livres</h1>
        <Link
          to="/livres/nouveau"
          className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium
                     text-sage-dark hover:bg-sage/10"
        >
          Ajouter
        </Link>
      </div>

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      {cookbooks.length > 1 && (
        <div className="mt-3 flex items-center justify-end">
          <label className="flex items-center gap-1.5 text-xs text-ink/50">
            Trier
            <select
              value={sort}
              onChange={(e) => {
                if (isCookbookSort(e.target.value)) setSort(e.target.value);
              }}
              className="rounded-full border border-line bg-white px-2.5 py-1 text-sm
                         text-ink focus:border-sage focus:outline-none"
            >
              {COOKBOOK_SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : sorted.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Aucun livre pour l'instant</p>
          <p className="mt-1 text-sm">
            Ajoutez les livres de cuisine que vous possédez — même ceux en papier.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {sorted.map((book) => (
            <li key={book.id}>
              <Link to={`/livres/${book.id}`} className="group block">
                {/* 2:3 is the usual book-cover proportion, so a shelf of
                    mixed sources still lines up. */}
                <div
                  className="aspect-[2/3] overflow-hidden rounded-card border border-line
                             bg-sage/10 shadow-sm transition-shadow group-hover:shadow-md"
                >
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-3xl">
                      📚
                    </div>
                  )}
                </div>
                <h2 className="mt-2 font-display text-base leading-tight text-ink">
                  {book.title}
                </h2>
                {book.author && (
                  <p className="text-xs text-ink/50">{book.author}</p>
                )}
                <p className="mt-0.5 text-xs text-ink/40">
                  {book.recipe_count
                    ? `${book.recipe_count} recette${book.recipe_count > 1 ? "s" : ""}`
                    : "Aucune recette importée"}
                  {/* The catalogue is mostly hidden from Mes recettes by
                      design, so say which books aren't — otherwise the
                      setting is invisible until you go looking for it. */}
                  {book.show_in_recipe_list ? " · visible" : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
