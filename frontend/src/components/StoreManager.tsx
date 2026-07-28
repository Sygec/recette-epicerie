import { useState } from "react";
import { api, Category, Store } from "../lib/api";

interface Props {
  stores: Store[];
  categories: Category[];
  onStoresChanged: () => void;
}

// Store CRUD + per-store aisle ordering, folded inline behind a toggle on
// the grocery list page (same "no separate settings page" pattern the app
// already uses for custom categories). Reordering is up/down buttons rather
// than drag-and-drop — no extra dependency, still fully usable.
export default function StoreManager({ stores, categories, onStoresChanged }: Props) {
  const [newStoreName, setNewStoreName] = useState("");
  const [addingStore, setAddingStore] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editingStoreName, setEditingStoreName] = useState("");
  const [expandedStoreId, setExpandedStoreId] = useState<number | null>(null);
  const [orderedCategories, setOrderedCategories] = useState<Category[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAddStore(e: React.FormEvent) {
    e.preventDefault();
    if (!newStoreName.trim()) return;
    setError(null);
    setAddingStore(true);
    try {
      await api.createStore(newStoreName.trim());
      setNewStoreName("");
      onStoresChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer le magasin");
    } finally {
      setAddingStore(false);
    }
  }

  function startEditingStore(store: Store) {
    setEditingStoreId(store.id);
    setEditingStoreName(store.name);
  }

  async function saveEditingStore() {
    const id = editingStoreId;
    const name = editingStoreName.trim();
    setEditingStoreId(null);
    if (id == null || !name) return;
    setError(null);
    try {
      await api.renameStore(id, name);
      onStoresChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renommer le magasin");
    }
  }

  async function handleDeleteStore(id: number) {
    if (
      !confirm(
        "Supprimer ce magasin ? Les listes qui l'utilisent reviendront à l'ordre par défaut."
      )
    )
      return;
    setError(null);
    try {
      await api.deleteStore(id);
      if (expandedStoreId === id) setExpandedStoreId(null);
      onStoresChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer le magasin");
    }
  }

  async function toggleExpand(store: Store) {
    if (expandedStoreId === store.id) {
      setExpandedStoreId(null);
      return;
    }
    setOrderError(null);
    const orderEntries = await api.getStoreCategoryOrder(store.id);
    const orderedIds = orderEntries
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((e) => e.category_id);
    const known = new Set(orderedIds);
    const rest = categories
      .filter((c) => !known.has(c.id))
      .sort((a, b) => a.default_sort_order - b.default_sort_order);
    const resolved = [
      ...orderedIds
        .map((catId) => categories.find((c) => c.id === catId))
        .filter((c): c is Category => !!c),
      ...rest,
    ];
    setOrderedCategories(resolved);
    setExpandedStoreId(store.id);
  }

  function move(index: number, direction: -1 | 1) {
    setOrderedCategories((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveOrder() {
    if (expandedStoreId == null) return;
    setOrderError(null);
    try {
      await api.setStoreCategoryOrder(
        expandedStoreId,
        orderedCategories.map((c) => c.id)
      );
      setExpandedStoreId(null);
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Impossible d'enregistrer l'ordre");
    }
  }

  return (
    <div className="mt-3 rounded-card border border-line bg-white/60 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-sage-dark/70">
        Magasins
      </h3>

      {error && <p className="mt-2 text-sm text-brick">{error}</p>}

      <ul className="mt-2 space-y-1">
        {stores.map((store) => (
          <li key={store.id}>
            <div className="flex items-center gap-2 py-1">
              {editingStoreId === store.id ? (
                <input
                  autoFocus
                  value={editingStoreName}
                  onChange={(e) => setEditingStoreName(e.target.value)}
                  onBlur={saveEditingStore}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingStoreId(null);
                  }}
                  className="flex-1 rounded border border-sage bg-white px-1.5 py-0.5 text-sm focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => startEditingStore(store)}
                  title="Cliquer pour renommer"
                  className="flex-1 text-left text-sm hover:text-sage-dark"
                >
                  {store.name}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleExpand(store)}
                className="text-xs text-ink/50 hover:text-sage-dark"
              >
                {expandedStoreId === store.id ? "Fermer" : "Ordre des allées"}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteStore(store.id)}
                aria-label="Supprimer le magasin"
                className="text-ink/30 hover:text-brick"
              >
                ✕
              </button>
            </div>

            {expandedStoreId === store.id && (
              <div className="ml-2 mt-1 rounded border border-line bg-paper/60 p-2">
                {orderError && <p className="mb-2 text-xs text-brick">{orderError}</p>}
                <ol className="space-y-1">
                  {orderedCategories.map((cat, idx) => (
                    <li key={cat.id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1">{cat.name}</span>
                      <button
                        type="button"
                        onClick={() => move(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Monter ${cat.name}`}
                        className="text-ink/40 hover:text-sage-dark disabled:opacity-20"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(idx, 1)}
                        disabled={idx === orderedCategories.length - 1}
                        aria-label={`Descendre ${cat.name}`}
                        className="text-ink/40 hover:text-sage-dark disabled:opacity-20"
                      >
                        ↓
                      </button>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  onClick={saveOrder}
                  className="mt-2 rounded border border-sage px-2 py-1 text-xs font-medium text-sage-dark hover:bg-sage/10"
                >
                  Enregistrer l'ordre
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={handleAddStore} className="mt-2 flex gap-2">
        <input
          value={newStoreName}
          onChange={(e) => setNewStoreName(e.target.value)}
          placeholder="Nouveau magasin…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
        />
        <button
          type="submit"
          disabled={addingStore || !newStoreName.trim()}
          className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
        >
          + Magasin
        </button>
      </form>
    </div>
  );
}
