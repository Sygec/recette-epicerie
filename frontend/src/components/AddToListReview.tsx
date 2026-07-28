import { useEffect, useState } from "react";
import { ACTIVE_GROCERY_LIST_KEY, api, GroceryList } from "../lib/api";

export interface ReviewIngredient {
  id: number | string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

interface Props {
  ingredients: ReviewIngredient[];
  recipeId?: number;
  onClose: () => void;
  onAdded: () => void;
}

// Shared review step used before anything gets added to a grocery list (from
// a single recipe here, and later from the weekly meal plan too): pick which
// list, then pick which ingredients — nothing is added silently. Everything
// starts unchecked (opt-in) rather than opt-out, since most ingredients on a
// given add are things already on hand.
export default function AddToListReview({ ingredients, recipeId, onClose, onAdded }: Props) {
  const [lists, setLists] = useState<GroceryList[]>([]);
  const [listId, setListId] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number | string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getGroceryLists().then((ls) => {
      setLists(ls);
      const lastId = Number(localStorage.getItem(ACTIVE_GROCERY_LIST_KEY));
      const preselected = ls.find((l) => l.id === lastId) ?? ls[0];
      setListId(preselected ? preselected.id : null);
      setLoading(false);
    });
  }, []);

  function toggle(id: number | string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (!listId || checked.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      for (const ing of ingredients) {
        if (!checked.has(ing.id)) continue;
        await api.addGroceryItem({
          name: ing.name,
          quantity: ing.quantity ?? undefined,
          unit: ing.unit ?? undefined,
          recipe_id: recipeId,
          list_id: listId,
        });
      }
      localStorage.setItem(ACTIVE_GROCERY_LIST_KEY, String(listId));
      onAdded();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Certains articles n'ont pas pu être ajoutés (${err.message}).`
          : "Impossible d'ajouter les articles à la liste de courses"
      );
    } finally {
      setSubmitting(false);
    }
  }

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
          <h2 className="font-display text-xl text-sage-dark">Ajouter à la liste de courses</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-ink/40 hover:text-ink">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-ink/40">Chargement…</p>
        ) : lists.length === 0 ? (
          <p className="mt-4 text-sm text-ink/60">
            Aucune liste de courses pour l'instant. Créez-en une depuis la page Courses
            avant d'ajouter des articles.
          </p>
        ) : (
          <>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink/50">
              Liste
            </label>
            <select
              value={listId ?? ""}
              onChange={(e) => setListId(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 focus:border-sage focus:outline-none"
            >
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.store_name ? ` (${l.store_name})` : ""}
                </option>
              ))}
            </select>

            <ul className="mt-4 divide-y divide-line">
              {ingredients.map((ing) => (
                <li key={ing.id} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked.has(ing.id)}
                    onChange={() => toggle(ing.id)}
                    className="h-4 w-4 flex-shrink-0 accent-sage"
                  />
                  <span className="flex-1 text-sm">{ing.name}</span>
                  <span className="font-mono text-xs text-ink/60">
                    {ing.quantity ?? ""} {ing.unit ?? ""}
                  </span>
                </li>
              ))}
            </ul>

            {error && <p className="mt-3 text-sm text-brick">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={submitting || checked.size === 0}
              className="mt-4 w-full rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark disabled:opacity-50"
            >
              Ajouter ({checked.size})
            </button>
          </>
        )}
      </div>
    </div>
  );
}
