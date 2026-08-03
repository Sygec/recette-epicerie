import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, Recipe, Tag } from "../lib/api";
import {
  isRecipeSort,
  RECIPE_SORT_KEY,
  RECIPE_SORTS,
  RecipeSort,
  sortRecipes,
} from "../lib/recipeSort";

export default function RecipeList() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTags, setShowTags] = useState(false);
  const [sort, setSort] = useState<RecipeSort>(() => {
    const remembered = localStorage.getItem(RECIPE_SORT_KEY);
    return isRecipeSort(remembered) ? remembered : "recent";
  });

  // Force the tag row open if a tag filter is active, even if the user
  // hasn't toggled it open — otherwise there'd be no way to see which tag
  // is filtering the list, or to clear it.
  const tagsVisible = showTags || activeTag !== null;

  useEffect(() => {
    api.getTags().then(setTags).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .getRecipes({
          q: query || undefined,
          tag: activeTag ?? undefined,
          favorites: favoritesOnly,
        })
        .then(setRecipes)
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, activeTag, favoritesOnly]);

  useEffect(() => {
    localStorage.setItem(RECIPE_SORT_KEY, sort);
  }, [sort]);

  // Reordering is local, so changing the sort doesn't refetch.
  const sorted = useMemo(() => sortRecipes(recipes, sort), [recipes, sort]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Mes recettes</h1>

      <input
        type="search"
        placeholder="Rechercher une recette ou un ingrédient…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mt-4 w-full rounded-lg border border-line bg-white px-3 py-2.5
                   focus:border-sage focus:outline-none"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFavoritesOnly((v) => !v)}
          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
            favoritesOnly
              ? "border-mustard bg-mustard/20 text-mustard-dark"
              : "border-line text-ink/60 hover:border-ink/30"
          }`}
        >
          ★ Favoris
        </button>
        {tags.length > 0 && !tagsVisible && (
          <button
            type="button"
            onClick={() => setShowTags(true)}
            className="text-xs font-medium text-sage-dark hover:underline"
          >
            Afficher les tags
          </button>
        )}

        {/* Kept visually distinct from the filter chips beside it: this
            changes the order, it doesn't remove anything from the list. */}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink/50">
          Trier
          <select
            value={sort}
            onChange={(e) => {
              if (isRecipeSort(e.target.value)) setSort(e.target.value);
            }}
            className="rounded-full border border-line bg-white px-2.5 py-1 text-sm
                       text-ink focus:border-sage focus:outline-none"
          >
            {RECIPE_SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tagsVisible && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTag(activeTag === t.name ? null : t.name)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                activeTag === t.name
                  ? "border-sage bg-sage/15 text-sage-dark"
                  : "border-line text-ink/60 hover:border-ink/30"
              }`}
            >
              {t.name}
            </button>
          ))}
          {showTags && (
            <button
              type="button"
              onClick={() => setShowTags(false)}
              className="text-xs font-medium text-sage-dark hover:underline"
            >
              Masquer les tags
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : sorted.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Aucune recette pour l'instant</p>
          <p className="mt-1 text-sm">
            Touchez « Ajouter » pour créer votre première recette.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map((r) => (
            <li key={r.id}>
              <Link
                to={`/recettes/${r.id}`}
                className="flex overflow-hidden rounded-card border border-line
                           bg-white/60 transition-shadow hover:shadow-md"
              >
                <div className="h-24 w-24 flex-shrink-0 bg-sage/10">
                  {r.photo_url ? (
                    <img
                      src={r.photo_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl">
                      🍽️
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col justify-center px-3 py-2">
                  <h2 className="font-display text-lg leading-tight">{r.title}</h2>
                  <p className="mt-0.5 text-xs text-ink/50">
                    {[
                      r.prep_time && `${r.prep_time} min prép.`,
                      r.cook_time && `${r.cook_time} min cuisson`,
                      r.difficulty,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
