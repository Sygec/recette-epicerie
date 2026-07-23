import { useEffect, useMemo, useState } from "react";
import { api, Category, GroceryItem } from "../lib/api";

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  isCustom: boolean;
  items: GroceryItem[];
}

export default function GroceryList() {
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [newItemUnit, setNewItemUnit] = useState("");
  const [newItemCategoryId, setNewItemCategoryId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingItemQuantity, setEditingItemQuantity] = useState("");
  const [editingItemUnit, setEditingItemUnit] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    return api.getGroceryItems().then(setItems);
  }
  function refreshCategories() {
    return api.getCategories().then(setCategories);
  }

  useEffect(() => {
    Promise.all([refresh(), refreshCategories()]).finally(() => setLoading(false));
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    setError(null);
    const trimmedQuantity = newItemQuantity.trim();
    const quantity = trimmedQuantity ? Number(trimmedQuantity) : undefined;
    if (trimmedQuantity && Number.isNaN(quantity)) {
      setError("Quantité invalide");
      return;
    }
    try {
      await api.addGroceryItem({
        name: newItemName.trim(),
        quantity,
        unit: newItemUnit.trim() || undefined,
        category_id: newItemCategoryId ? Number(newItemCategoryId) : undefined,
      });
      setNewItemName("");
      setNewItemQuantity("");
      setNewItemUnit("");
      setNewItemCategoryId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ajouter l'article");
    }
  }

  async function handleToggle(item: GroceryItem) {
    setError(null);
    setItems((rows) =>
      rows.map((r) =>
        r.id === item.id ? { ...r, is_checked: item.is_checked ? 0 : 1 } : r
      )
    );
    try {
      await api.toggleGroceryItem(item.id, !item.is_checked);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de mettre à jour l'article"
      );
      refresh(); // undo the optimistic update by resyncing with the server
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    setItems((rows) => rows.filter((r) => r.id !== id));
    try {
      await api.deleteGroceryItem(id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de supprimer l'article"
      );
      refresh(); // undo the optimistic removal by resyncing with the server
    }
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setError(null);
    setAddingCategory(true);
    try {
      await api.createCategory(newCategoryName.trim());
      setNewCategoryName("");
      await refreshCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer la catégorie");
    } finally {
      setAddingCategory(false);
    }
  }

  function startEditingCategory(group: CategoryGroup) {
    if (group.categoryId == null) return;
    setEditingCategoryId(group.categoryId);
    setEditingCategoryName(group.categoryName);
  }

  async function saveEditingCategory() {
    const id = editingCategoryId;
    const name = editingCategoryName.trim();
    setEditingCategoryId(null);
    if (id == null || !name) return;
    setError(null);
    try {
      await api.renameCategory(id, name);
      await Promise.all([refresh(), refreshCategories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renommer la catégorie");
    }
  }

  function startEditingItem(item: GroceryItem) {
    setEditingItemId(item.id);
    setEditingItemQuantity(item.quantity != null ? String(item.quantity) : "");
    setEditingItemUnit(item.unit ?? "");
  }

  async function saveEditingItem() {
    const id = editingItemId;
    setEditingItemId(null);
    if (id == null) return;
    const trimmedQuantity = editingItemQuantity.trim();
    const quantity = trimmedQuantity ? Number(trimmedQuantity) : null;
    if (trimmedQuantity && Number.isNaN(quantity)) {
      setError("Quantité invalide");
      return;
    }
    const unit = editingItemUnit.trim() || null;
    setError(null);
    setItems((rows) => rows.map((r) => (r.id === id ? { ...r, quantity, unit } : r)));
    try {
      await api.updateGroceryItemQuantity(id, quantity, unit);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de mettre à jour la quantité"
      );
      refresh(); // undo the optimistic update by resyncing with the server
    }
  }

  async function handleDeleteCategory(id: number) {
    if (
      !confirm(
        "Supprimer cette catégorie ? Les articles seront déplacés vers « Autres / Non classé »."
      )
    )
      return;
    setError(null);
    try {
      await api.deleteCategory(id);
      await Promise.all([refresh(), refreshCategories()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer la catégorie");
    }
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, CategoryGroup>();
    for (const item of items) {
      const key = item.category_id != null ? String(item.category_id) : "none";
      if (!groups.has(key)) {
        groups.set(key, {
          categoryId: item.category_id,
          categoryName: item.category_name ?? "Autres / Non classé",
          isCustom: !!item.category_is_custom,
          items: [],
        });
      }
      groups.get(key)!.items.push(item);
    }
    return Array.from(groups.values());
  }, [items]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Liste de courses</h1>

      <form onSubmit={handleAdd} className="mt-4 flex flex-wrap gap-2">
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.target.value)}
          placeholder="Ajouter un article…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2.5 focus:border-sage focus:outline-none"
        />
        <input
          value={newItemQuantity}
          onChange={(e) => setNewItemQuantity(e.target.value)}
          placeholder="Qté"
          aria-label="Quantité"
          inputMode="decimal"
          className="w-16 rounded-lg border border-line bg-white px-2 py-2.5 text-sm focus:border-sage focus:outline-none"
        />
        <input
          value={newItemUnit}
          onChange={(e) => setNewItemUnit(e.target.value)}
          placeholder="Unité"
          aria-label="Unité"
          className="w-20 rounded-lg border border-line bg-white px-2 py-2.5 text-sm focus:border-sage focus:outline-none"
        />
        <select
          value={newItemCategoryId}
          onChange={(e) => setNewItemCategoryId(e.target.value)}
          aria-label="Catégorie"
          className="rounded-lg border border-line bg-white px-2 py-2.5 text-sm text-ink/70 focus:border-sage focus:outline-none"
        >
          <option value="">Catégorie (auto)</option>
          {categories
            .slice()
            .sort((a, b) => a.default_sort_order - b.default_sort_order)
            .map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-sage px-4 py-2.5 font-medium text-white hover:bg-sage-dark"
        >
          Ajouter
        </button>
      </form>

      <form onSubmit={handleAddCategory} className="mt-2 flex gap-2">
        <input
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          placeholder="Nouvelle catégorie…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
        />
        <button
          type="submit"
          disabled={addingCategory || !newCategoryName.trim()}
          className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
        >
          + Catégorie
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

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
          {grouped.map((group) => (
            <section key={group.categoryId ?? "none"}>
              <div className="flex items-center gap-2">
                {editingCategoryId === group.categoryId && group.categoryId != null ? (
                  <input
                    autoFocus
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                    onBlur={saveEditingCategory}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditingCategoryId(null);
                    }}
                    className="rounded border border-sage bg-white px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-sage-dark focus:outline-none"
                  />
                ) : (
                  <h2
                    onClick={() => startEditingCategory(group)}
                    className={`text-xs font-semibold uppercase tracking-wide text-sage-dark/70 ${
                      group.categoryId != null ? "cursor-pointer hover:text-sage-dark" : ""
                    }`}
                    title={group.categoryId != null ? "Cliquer pour renommer" : undefined}
                  >
                    {group.categoryName}
                  </h2>
                )}
                {group.isCustom && group.categoryId != null && (
                  <button
                    onClick={() => handleDeleteCategory(group.categoryId!)}
                    aria-label="Supprimer la catégorie"
                    className="text-ink/30 hover:text-brick"
                  >
                    <span className="text-xs">✕</span>
                  </button>
                )}
              </div>
              <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-white/60">
                {group.items.map((item) => (
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
                    {editingItemId === item.id ? (
                      <span
                        className="flex flex-shrink-0 items-center gap-1"
                        onBlur={(e) => {
                          // Tabbing from the quantity field to the unit field
                          // fires a blur on the quantity input too — only
                          // save once focus actually leaves both fields,
                          // otherwise the fields unmount mid-edit.
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                            saveEditingItem();
                          }
                        }}
                      >
                        <input
                          autoFocus
                          value={editingItemQuantity}
                          onChange={(e) => setEditingItemQuantity(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingItemId(null);
                          }}
                          placeholder="Qté"
                          aria-label="Quantité"
                          inputMode="decimal"
                          className="w-12 rounded border border-sage bg-white px-1 py-0.5 text-right font-mono text-xs focus:outline-none"
                        />
                        <input
                          value={editingItemUnit}
                          onChange={(e) => setEditingItemUnit(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                            if (e.key === "Escape") setEditingItemId(null);
                          }}
                          placeholder="Unité"
                          aria-label="Unité"
                          className="w-16 rounded border border-sage bg-white px-1 py-0.5 font-mono text-xs focus:outline-none"
                        />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditingItem(item)}
                        title="Cliquer pour modifier la quantité"
                        className="flex-shrink-0 font-mono text-xs text-ink/50 hover:text-sage-dark"
                      >
                        {item.quantity != null || item.unit
                          ? `${item.quantity ?? ""} ${item.unit ?? ""}`.trim()
                          : "+ qté"}
                      </button>
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
