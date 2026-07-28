import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, MealPlanEntry, Recipe } from "../lib/api";
import RecipePicker from "../components/RecipePicker";
import AddToListReview, { ReviewIngredient } from "../components/AddToListReview";
import { roundQuantity } from "../lib/quantity";

const WEEKDAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// Local-date formatting (not toISOString, which converts to UTC and can
// shift the date by a day depending on the viewer's timezone offset).
function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d: Date): Date {
  const weekday = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export default function MealPlan() {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState<MealPlanEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pickerForDate, setPickerForDate] = useState<string | null>(null);
  const [showAddToList, setShowAddToList] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  function refresh() {
    setLoading(true);
    return api
      .getMealPlan(formatDate(days[0]), formatDate(days[6]))
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Impossible de charger la planification")
      )
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, [weekStart]);

  function entryForDate(dateStr: string): MealPlanEntry | undefined {
    return entries.find((e) => e.date === dateStr);
  }

  async function handlePickRecipe(recipe: Recipe) {
    if (!pickerForDate) return;
    setError(null);
    try {
      await api.setMealPlanEntry({
        date: pickerForDate,
        recipe_id: recipe.id,
        servings: recipe.servings ?? undefined,
      });
      setPickerForDate(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'assigner cette recette");
    }
  }

  async function handleRemove(entry: MealPlanEntry) {
    setError(null);
    try {
      await api.deleteMealPlanEntry(entry.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de retirer ce repas");
    }
  }

  // Re-POSTing the same recipe_id for that date is how servings get edited
  // too — the date's UNIQUE constraint makes it an upsert, no separate
  // PUT endpoint needed.
  async function handleServingsChange(entry: MealPlanEntry, delta: number) {
    const current = entry.servings ?? entry.recipe_servings ?? 1;
    const next = Math.max(1, current + delta);
    setError(null);
    try {
      await api.setMealPlanEntry({
        date: entry.date,
        recipe_id: entry.recipe_id,
        servings: next,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de mettre à jour les portions");
    }
  }

  const weekReviewIngredients: ReviewIngredient[] = entries.flatMap((entry) => {
    const scaleFactor =
      entry.recipe_servings && entry.servings ? entry.servings / entry.recipe_servings : 1;
    const dayIndex = days.findIndex((d) => formatDate(d) === entry.date);
    const label = `${WEEKDAY_NAMES[dayIndex] ?? entry.date} — ${entry.recipe_title}`;
    return entry.ingredients.map((ing) => ({
      id: `${entry.id}-${ing.id}`,
      name: ing.name,
      quantity: ing.quantity != null ? roundQuantity(ing.quantity * scaleFactor) : null,
      unit: ing.unit,
      groupLabel: label,
      recipeId: entry.recipe_id,
    }));
  });

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Planification</h1>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setWeekStart((d) => addDays(d, -7))}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-sage"
        >
          ← Précédente
        </button>
        <span className="text-sm text-ink/60">
          {days[0].toLocaleDateString("fr-CA", { day: "numeric", month: "short" })} –{" "}
          {days[6].toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
        </span>
        <button
          type="button"
          onClick={() => setWeekStart((d) => addDays(d, 7))}
          className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-sage"
        >
          Suivante →
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : (
        <div className="mt-6 space-y-2">
          {days.map((day, i) => {
            const dateStr = formatDate(day);
            const entry = entryForDate(dateStr);
            return (
              <div
                key={dateStr}
                className="flex items-center gap-3 rounded-card border border-line bg-white/60 px-3 py-2.5"
              >
                <div className="w-16 flex-shrink-0 text-sm">
                  <div className="font-medium">{WEEKDAY_NAMES[i]}</div>
                  <div className="text-xs text-ink/50">
                    {day.getDate()}/{day.getMonth() + 1}
                  </div>
                </div>
                {entry ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setPickerForDate(dateStr)}
                      title="Cliquer pour changer la recette"
                      className="flex flex-1 items-center gap-3 text-left hover:text-sage-dark"
                    >
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-sage/10">
                        {entry.recipe_photo_url ? (
                          <img
                            src={entry.recipe_photo_url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-lg">
                            🍽️
                          </div>
                        )}
                      </div>
                      <span className="text-sm">{entry.recipe_title}</span>
                    </button>
                    {entry.recipe_servings != null && (
                      <span className="flex flex-shrink-0 items-center gap-1 text-xs text-ink/60">
                        <button
                          type="button"
                          onClick={() => handleServingsChange(entry, -1)}
                          aria-label="Réduire les portions"
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-line hover:border-sage"
                        >
                          −
                        </button>
                        <span className="font-mono">
                          {entry.servings ?? entry.recipe_servings}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleServingsChange(entry, 1)}
                          aria-label="Augmenter les portions"
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-line hover:border-sage"
                        >
                          +
                        </button>
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRemove(entry)}
                      aria-label="Retirer ce repas"
                      className="flex-shrink-0 text-ink/30 hover:text-brick"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPickerForDate(dateStr)}
                    className="flex-1 text-left text-sm text-ink/40 hover:text-sage-dark"
                  >
                    + Choisir une recette
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAddToList(true)}
        disabled={entries.length === 0}
        className="mt-6 w-full rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark disabled:opacity-50"
      >
        Ajouter la semaine à la liste de courses
      </button>

      {pickerForDate && (
        <RecipePicker onClose={() => setPickerForDate(null)} onPick={handlePickRecipe} />
      )}

      {showAddToList && (
        <AddToListReview
          ingredients={weekReviewIngredients}
          onClose={() => setShowAddToList(false)}
          onAdded={() => {
            setShowAddToList(false);
            navigate("/courses");
          }}
        />
      )}
    </div>
  );
}
