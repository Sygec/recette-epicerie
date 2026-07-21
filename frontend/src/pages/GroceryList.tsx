import { useEffect, useMemo, useState } from "react";
import { api, GroceryItem } from "../lib/api";

export default function GroceryList() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [loading, setLoading] = useState(true);

  function refresh() {
    return api.getGroceryItems().then(setItems);
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    await api.addGroceryItem({ name: newItemName.trim() });
    setNewItemName("");
    refresh();
  }

  async function handleToggle(item: GroceryItem) {
    setItems((rows) =>
      rows.map((r) =>
        r.id === item.id ? { ...r, is_checked: item.is_checked ? 0 : 1 } : r
      )
    );
    await api.toggleGroceryItem(item.id, !item.is_checked);
  }

  async function handleDelete(id: number) {
    setItems((rows) => rows.filter((r) => r.id !== id));
    await api.deleteGroceryItem(id);
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, GroceryItem[]>();
    for (const item of items) {
      const key = item.category_name ?? "Autres / Non classé";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    return groups;
  }, [items]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Liste de courses</h1>

      <form onSubmit={handleAdd} className="mt-4 flex gap-2">
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Ajouter un article…"
          className="flex-1 rounded-lg border border-line bg-white px-3 py-2.5 focus:border-sage focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark"
        >
          Ajouter
        </button>
      </form>

      {loading ? (
        <p className="mt-10 text-center text-ink/40">Chargement…</p>
      ) : items.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Votre liste est vide</p>
          <p className="mt-1 text-sm">
            Ajoutez un article ci-dessus ou depuis une recette.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {Array.from(grouped.entries()).map(([category, rows]) => (
            <section key={category}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-sage-dark/70">
                {category}
              </h2>
              <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-white/60">
                {rows.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      onClick={() => handleToggle(item)}
                      aria-label={
                        item.is_checked ? "Marquer comme non trouvé" : "Marquer comme trouvé"
                      }
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 ${
                        item.is_checked
                          ? "border-sage bg-sage text-white"
                          : "border-line"
                      }`}
                    >
                      {item.is_checked ? "✓" : ""}
                    </button>
                    <span
                      className={`flex-1 text-sm ${
                        item.is_checked ? "text-ink/30 line-through" : ""
                      }`}
                    >
                      {item.name}
                    </span>
                    {(item.quantity || item.unit) && (
                      <span className="font-mono text-xs text-ink/50">
                        {item.quantity ?? ""} {item.unit ?? ""}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(item.id)}
                      aria-label="Supprimer l'article"
                      className="text-ink/30 hover:text-brick"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
