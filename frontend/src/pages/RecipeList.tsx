import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Recipe, Tag } from "../lib/api";

export default function RecipeList() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(true);

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

      <div className="mt-3 flex flex-wrap gap-2">
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
      </div>

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : recipes.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Aucune recette pour l'instant</p>
          <p className="mt-1 text-sm">
            Touchez « Ajouter » pour créer votre première recette.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {recipes.map((r) => (
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
                    {[r.prep_time && `${r.prep_time} min prép.`, r.difficulty]
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
