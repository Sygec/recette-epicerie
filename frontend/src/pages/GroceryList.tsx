import { useEffect, useMemo, useState } from "react";
import {
  ACTIVE_GROCERY_LIST_KEY,
  api,
  Category,
  GroceryItem,
  GroceryList as GroceryListType,
  Store,
  StoreCategoryOrderEntry,
} from "../lib/api";
import StoreManager from "../components/StoreManager";

interface CategoryGroup {
  categoryId: number | null;
  categoryName: string;
  isCustom: boolean;
  items: GroceryItem[];
}

export default function GroceryList() {
  const [lists, setLists] = useState<GroceryListType[]>([]);
  const [activeListId, setActiveListId] = useState<number | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [storeOrder, setStoreOrder] = useState<StoreCategoryOrderEntry[]>([]);
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
  const [newListName, setNewListName] = useState("");
  const [newListStoreId, setNewListStoreId] = useState("");
  const [addingList, setAddingList] = useState(false);
  const [editingListId, setEditingListId] = useState<number | null>(null);
  const [editingListName, setEditingListName] = useState("");
  const [showStoreManager, setShowStoreManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function refreshCategories() {
    return api.getCategories().then(setCategories);
  }
  function refreshStores() {
    return api.getStores().then(setStores);
  }
  function refreshLists() {
    return api.getGroceryLists().then((ls) => {
      setLists(ls);
      return ls;
    });
  }

  // Load lists/categories/stores once, then pick which list is "active":
  // whatever was last open (persisted across visits), falling back to the
  // first list if that one's gone (e.g. deleted from another session).
  useEffect(() => {
    Promise.all([refreshLists(), refreshCategories(), refreshStores()])
      .then(([ls]) => {
        const savedId = Number(localStorage.getItem(ACTIVE_GROCERY_LIST_KEY));
        const initial = ls.find((l) => l.id === savedId) ?? ls[0];
        setActiveListId(initial ? initial.id : null);
      })
      .finally(() => setLoading(false));
  }, []);

  function refreshItems(listId: number) {
    return api.getGroceryItems(listId).then(setItems);
  }

  useEffect(() => {
    if (activeListId == null) {
      setItems([]);
      return;
    }
    localStorage.setItem(ACTIVE_GROCERY_LIST_KEY, String(activeListId));
    refreshItems(activeListId);
  }, [activeListId]);

  const activeList = lists.find((l) => l.id === activeListId) ?? null;

  useEffect(() => {
    if (activeList?.store_id == null) {
      setStoreOrder([]);
      return;
    }
    api.getStoreCategoryOrder(activeList.store_id).then(setStoreOrder);
  }, [activeList?.store_id]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim() || activeListId == null) return;
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
        list_id: activeListId,
      });
      setNewItemName("");
      setNewItemQuantity("");
      setNewItemUnit("");
      setNewItemCategoryId("");
      await refreshItems(activeListId);
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
      if (activeListId != null) refreshItems(activeListId); // undo the optimistic update by resyncing with the server
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
      if (activeListId != null) refreshItems(activeListId); // undo the optimistic removal by resyncing with the server
    }
  }

  async function handleClearChecked() {
    if (activeListId == null) return;
    if (!confirm("Retirer tous les articles cochés de cette liste ?")) return;
    setError(null);
    try {
      await api.clearGroceryItems(activeListId, true);
      await refreshItems(activeListId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Impossible de retirer les articles cochés"
      );
    }
  }

  async function handleClearAll() {
    if (activeListId == null) return;
    if (!confirm("Vider complètement cette liste ? Tous les articles seront supprimés."))
      return;
    setError(null);
    try {
      await api.clearGroceryItems(activeListId, false);
      await refreshItems(activeListId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de vider la liste");
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
      await Promise.all([
        activeListId != null ? refreshItems(activeListId) : Promise.resolve(),
        refreshCategories(),
      ]);
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
      if (activeListId != null) refreshItems(activeListId); // undo the optimistic update by resyncing with the server
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
      await Promise.all([
        activeListId != null ? refreshItems(activeListId) : Promise.resolve(),
        refreshCategories(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer la catégorie");
    }
  }

  async function handleAddList(e: React.FormEvent) {
    e.preventDefault();
    if (!newListName.trim()) return;
    setError(null);
    setAddingList(true);
    try {
      const storeId = newListStoreId ? Number(newListStoreId) : null;
      const { id } = await api.createGroceryList(newListName.trim(), storeId);
      setNewListName("");
      setNewListStoreId("");
      await refreshLists();
      setActiveListId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de créer la liste");
    } finally {
      setAddingList(false);
    }
  }

  function startEditingList(list: GroceryListType) {
    setEditingListId(list.id);
    setEditingListName(list.name);
  }

  async function saveEditingList() {
    const id = editingListId;
    const name = editingListName.trim();
    setEditingListId(null);
    if (id == null || !name) return;
    setError(null);
    try {
      await api.updateGroceryList(id, { name });
      await refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de renommer la liste");
    }
  }

  async function handleChangeListStore(storeId: string) {
    if (activeListId == null) return;
    setError(null);
    try {
      await api.updateGroceryList(activeListId, {
        store_id: storeId ? Number(storeId) : null,
      });
      await refreshLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'associer le magasin");
    }
  }

  async function handleDeleteList(id: number) {
    if (
      !confirm(
        "Supprimer cette liste ? Tous ses articles seront supprimés définitivement."
      )
    )
      return;
    setError(null);
    try {
      await api.deleteGroceryList(id);
      const remaining = await refreshLists();
      if (activeListId === id) {
        setActiveListId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de supprimer la liste");
    }
  }

  // Resolved aisle position for a category under the active list's store:
  // a category the store has an explicit order for uses that; everything
  // else falls back after it, in the categories' own default order. Once a
  // store's order has been edited once (see StoreManager), it covers every
  // category, so this fallback only matters for brand-new/untouched stores.
  const sortPosition = useMemo(() => {
    const overrides = new Map(storeOrder.map((e) => [e.category_id, e.sort_order]));
    return (categoryId: number | null): number => {
      if (categoryId == null) return Infinity;
      if (overrides.has(categoryId)) return overrides.get(categoryId)!;
      const cat = categories.find((c) => c.id === categoryId);
      return 1000 + (cat?.default_sort_order ?? 0);
    };
  }, [storeOrder, categories]);

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
    return Array.from(groups.values()).sort(
      (a, b) => sortPosition(a.categoryId) - sortPosition(b.categoryId)
    );
  }, [items, sortPosition]);

  if (loading) {
    return <p className="mt-10 text-center text-ink/40">Chargement…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:pt-8">
      <h1 className="font-display text-3xl text-sage-dark">Liste de courses</h1>

      {lists.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {lists.map((list) =>
            editingListId === list.id ? (
              <input
                key={list.id}
                autoFocus
                value={editingListName}
                onChange={(e) => setEditingListName(e.target.value)}
                onBlur={saveEditingList}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingListId(null);
                }}
                className="rounded-full border border-sage bg-white px-3 py-1.5 text-sm focus:outline-none"
              />
            ) : (
              <button
                key={list.id}
                onClick={() => setActiveListId(list.id)}
                onDoubleClick={() => startEditingList(list)}
                title="Double-cliquer pour renommer"
                className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                  list.id === activeListId
                    ? "border-sage bg-sage text-white"
                    : "border-line bg-white/60 text-ink/70 hover:border-sage"
                }`}
              >
                {list.name}
                {list.store_name ? ` · ${list.store_name}` : ""}
              </button>
            )
          )}
        </div>
      )}

      <form onSubmit={handleAddList} className="mt-2 flex flex-wrap gap-2">
        <input
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          placeholder="Nouvelle liste…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-white/60 px-3 py-1.5 text-sm focus:border-sage focus:outline-none"
        />
        <select
          value={newListStoreId}
          onChange={(e) => setNewListStoreId(e.target.value)}
          aria-label="Magasin de la nouvelle liste"
          className="rounded-lg border border-line bg-white/60 px-2 py-1.5 text-sm text-ink/70 focus:border-sage focus:outline-none"
        >
          <option value="">Aucun magasin</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={addingList || !newListName.trim()}
          className="rounded-lg border border-sage px-3 py-1.5 text-sm font-medium text-sage-dark hover:bg-sage/10 disabled:opacity-50"
        >
          + Liste
        </button>
      </form>

      {activeList && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink/60">
          <label htmlFor="active-list-store">Magasin :</label>
          <select
            id="active-list-store"
            value={activeList.store_id ?? ""}
            onChange={(e) => handleChangeListStore(e.target.value)}
            className="rounded-lg border border-line bg-white/60 px-2 py-1 text-sm focus:border-sage focus:outline-none"
          >
            <option value="">Aucun magasin</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleDeleteList(activeList.id)}
            className="text-ink/40 hover:text-brick"
          >
            Supprimer cette liste
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowStoreManager((v) => !v)}
        className="mt-2 text-xs font-medium text-sage-dark hover:underline"
      >
        {showStoreManager ? "Masquer les magasins" : "Gérer les magasins"}
      </button>
      {showStoreManager && (
        <StoreManager stores={stores} categories={categories} onStoresChanged={refreshStores} />
      )}

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      {lists.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Aucune liste de courses</p>
          <p className="mt-1 text-sm">Créez-en une ci-dessus pour commencer.</p>
        </div>
      ) : activeListId == null ? null : (
        <>
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

          {items.length > 0 && (
            <div className="mt-2 flex gap-2 text-sm">
              <button
                type="button"
                onClick={handleClearChecked}
                disabled={!items.some((i) => i.is_checked)}
                className="text-ink/50 hover:text-brick disabled:opacity-40 disabled:hover:text-ink/50"
              >
                Retirer les articles cochés
              </button>
              <span className="text-ink/20">·</span>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-ink/50 hover:text-brick"
              >
                Vider la liste
              </button>
            </div>
          )}

          {items.length === 0 ? (
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
        </>
      )}
    </div>
  );
}
