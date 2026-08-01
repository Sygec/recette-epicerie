import { useEffect, useState } from "react";
import { api, Recipe } from "../lib/api";

interface Props {
  onClose: () => void;
  onPick: (recipe: Recipe) => void;
}

// Small search-and-pick modal used by the meal planner to assign (or
// replace) a day's recipe. Reuses the same search endpoint RecipeList
// already uses.
export default function RecipePicker({ onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => {
      api
        .getRecipes({ q: query || undefined })
        .then(setRecipes)
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-card bg-paper p-5 sm:rounded-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl text-sage-dark">Choisir une recette</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        <input
          type="search"
          autoFocus
          placeholder="Rechercher une recette…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-4 w-full rounded-lg border border-line bg-white px-3 py-2.5 focus:border-sage focus:outline-none"
        />

        {loading ? (
          <p className="mt-4 text-sm text-ink/40">Chargement…</p>
        ) : recipes.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">Aucune recette trouvée.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {recipes.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full items-center gap-3 py-2 text-left hover:text-sage-dark"
                >
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-sage/10">
                    {r.photo_url ? (
                      <img src={r.photo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-lg">
                        🍽️
                      </div>
                    )}
                  </div>
                  <span className="flex-1 text-sm">{r.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
