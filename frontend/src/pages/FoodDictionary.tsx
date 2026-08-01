import { useEffect, useMemo, useState } from "react";
import { api, Category, Food } from "../lib/api";

// The dictionary decides which aisle an item lands in and which items merge
// into a single line. Two of its rules drive the shape of this page:
//
//   - Matching is containment-based, longest alias wins. So an unqualified
//     entry swallows its own compounds ("sucre en poudre" matches "sucre")
//     until the compound gets its own entry here.
//   - There is no plural folding, so "pommes" does not match the alias
//     "pomme". Each written form needs to be its own synonym.
//
// Both are surfaced as hints rather than left for the user to deduce.

// Same identity rule the server matches on (normalizeFoodIdentity): case,
// accents and surrounding whitespace don't distinguish two names.
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export default function FoodDictionary() {
  const [foods, setFoods] = useState<Food[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingNameId, setEditingNameId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [aliasDrafts, setAliasDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return api.getFoods().then(setFoods);
  }

  useEffect(() => {
    Promise.all([refresh(), api.getCategories().then(setCategories)])
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Impossible de charger le dictionnaire")
      )
      .finally(() => setLoading(false));
  }, []);

  const sortedCategories = useMemo(
    () => categories.slice().sort((a, b) => a.default_sort_order - b.default_sort_order),
    [categories]
  );

  // Accent- and case-insensitive, matching how the server compares names —
  // searching "creme" should find "crème".
  const visible = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle) return foods;
    return foods.filter(
      (food) =>
        fold(food.canonical_name).includes(needle) ||
        food.aliases.some((a) => fold(a.alias).includes(needle))
    );
  }, [foods, query]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await run(
      () => api.createFood(newName.trim(), newCategoryId ? Number(newCategoryId) : null, "fr"),
      "Impossible de créer l'aliment"
    );
    setNewName("");
    setNewCategoryId("");
    setCreating(false);
  }

  async function saveName(food: Food) {
    const name = editingName.trim();
    setEditingNameId(null);
    if (!name || name === food.canonical_name) return;
    await run(
      () => api.updateFood(food.id, { canonical_name: name }),
      "Impossible de renommer l'aliment"
    );
  }

  async function addAlias(food: Food) {
    const alias = (aliasDrafts[food.id] ?? "").trim();
    if (!alias) return;
    setAliasDrafts((drafts) => ({ ...drafts, [food.id]: "" }));
    await run(() => api.addFoodAlias(food.id, alias, "fr"), "Impossible d'ajouter le synonyme");
  }

  async function handleDeleteFood(food: Food) {
    if (
      !confirm(
        `Supprimer « ${food.canonical_name} » du dictionnaire ? Les articles déjà sur la liste sont conservés, mais ce nom ne sera plus reconnu automatiquement.`
      )
    )
      return;
    await run(() => api.deleteFood(food.id), "Impossible de supprimer l'aliment");
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Dictionnaire des aliments</h1>
      <p className="mt-2 text-sm text-ink/60">
        Ce que l'app reconnaît quand vous ajoutez un article : le rayon où il se range, et
        les articles qu'elle regroupe sur une même ligne. Ajoutez un aliment distinct
        lorsqu'un nom plus précis ne doit pas être confondu avec un plus général — par
        exemple « sucre à glacer » face à « sucre ».
      </p>

      <form onSubmit={handleCreate} className="mt-4 flex flex-wrap gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nouvel aliment…"
          // basis-full so the aisle select never squeezes the name field
          // down to a few characters on a phone-width screen.
          className="min-w-0 flex-1 basis-full rounded-lg border border-line bg-white px-3 py-2.5 focus:border-sage focus:outline-none"
        />
        <select
          value={newCategoryId}
          onChange={(e) => setNewCategoryId(e.target.value)}
          aria-label="Rayon"
          className="rounded-lg border border-line bg-white px-2 py-2.5 text-sm text-ink/70 focus:border-sage focus:outline-none"
        >
          <option value="">Aucun rayon</option>
          {sortedCategories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark disabled:opacity-50"
        >
          Ajouter
        </button>
      </form>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un aliment ou un synonyme…"
        aria-label="Rechercher"
        className="mt-2 w-full rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
      />

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : (
        <>
          <p className="mt-4 text-xs text-ink/40">
            {visible.length} aliment{visible.length > 1 ? "s" : ""}
            {query.trim() ? ` sur ${foods.length}` : ""}
          </p>

          <div className="mt-2 space-y-3">
            {visible.map((food) => (
              <section
                key={food.id}
                className="rounded-card border border-line bg-white/60 px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {editingNameId === food.id ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => saveName(food)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setEditingNameId(null);
                      }}
                      className="rounded border border-sage bg-white px-1.5 py-0.5 text-sm font-medium focus:outline-none"
                    />
                  ) : (
                    <h2
                      onClick={() => {
                        setEditingNameId(food.id);
                        setEditingName(food.canonical_name);
                      }}
                      title="Cliquer pour renommer"
                      className="cursor-pointer text-sm font-medium text-ink hover:text-sage-dark"
                    >
                      {food.canonical_name}
                    </h2>
                  )}

                  <select
                    value={food.category_id ?? ""}
                    onChange={(e) =>
                      run(
                        () =>
                          api.updateFood(food.id, {
                            category_id: e.target.value ? Number(e.target.value) : null,
                          }),
                        "Impossible de changer le rayon"
                      )
                    }
                    aria-label={`Rayon de ${food.canonical_name}`}
                    className="rounded border border-line bg-white px-1.5 py-0.5 text-xs text-ink/70 focus:border-sage focus:outline-none"
                  >
                    <option value="">Aucun rayon</option>
                    {sortedCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleDeleteFood(food)}
                    aria-label={`Supprimer ${food.canonical_name}`}
                    className="ml-auto text-ink/30 hover:text-brick"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {food.aliases.map((alias) => (
                    <span
                      key={alias.id}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-xs text-ink/70"
                    >
                      {alias.alias}
                      <button
                        onClick={() =>
                          run(
                            () => api.deleteFoodAlias(alias.id),
                            "Impossible de supprimer le synonyme"
                          )
                        }
                        aria-label={`Supprimer le synonyme ${alias.alias}`}
                        className="text-ink/30 hover:text-brick"
                      >
                        ✕
                      </button>
                    </span>
                  ))}

                  <input
                    value={aliasDrafts[food.id] ?? ""}
                    onChange={(e) =>
                      setAliasDrafts((drafts) => ({ ...drafts, [food.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addAlias(food);
                      }
                    }}
                    onBlur={() => addAlias(food)}
                    placeholder="+ synonyme"
                    aria-label={`Ajouter un synonyme à ${food.canonical_name}`}
                    className="w-28 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-xs focus:border-sage focus:outline-none"
                  />
                </div>
              </section>
            ))}
          </div>

          {visible.length === 0 && (
            <div className="mt-10 text-center text-ink/50">
              <p className="font-display text-xl">Aucun aliment trouvé</p>
              <p className="mt-1 text-sm">
                Ajoutez « {query.trim() || "un aliment"} » avec le formulaire ci-dessus pour
                que l'app le reconnaisse.
              </p>
            </div>
          )}

          <p className="mt-8 text-xs leading-relaxed text-ink/40">
            Les synonymes sont ce que l'app compare réellement au texte saisi. Le pluriel
            n'est pas déduit — ajoutez « pommes » à côté de « pomme » si vous écrivez les
            deux. Un synonyme ne peut appartenir qu'à un seul aliment.
          </p>
        </>
      )}
    </div>
  );
}
