import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  ACTIVE_GROCERY_LIST_KEY,
  api,
  Category,
  GroceryItem,
  GroceryList as GroceryListType,
  SortMode,
  Store,
  StoreCategoryOrderEntry,
} from "../lib/api";
import ListStoreManager from "../components/ListStoreManager";
import GroceryItemRow from "../components/GroceryItemRow";
import SortableGroceryItemRow from "../components/SortableGroceryItemRow";

// Same identity rule the server matches on: a merge whose target name only
// differs by case or accents isn't worth remarking on.
function normalize(text: string): string {
  return text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

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
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [mergeNotice, setMergeNotice] = useState<{ typed: string; into: string } | null>(
    null
  );
  const [showManageModal, setShowManageModal] = useState(false);
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

  // A failed load used to reject unhandled, leaving items empty — so the page
  // rendered "Votre liste est vide" and looked like a list with nothing in it
  // rather than a list that couldn't be read. Keep whatever was last loaded
  // and say so instead: an empty list and an unreadable one are very
  // different things, and only one of them is worth panicking about.
  function refreshItems(listId: number) {
    return api
      .getGroceryItems(listId)
      .then(setItems)
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Impossible de charger la liste"
        );
      });
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
  const sortMode: SortMode = activeList?.sort_mode ?? "category";

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
    if (trimmedQuantity && Number.isNaN(Number(trimmedQuantity))) {
      setError("Quantité invalide");
      return;
    }
    // Typing a name and nothing else means one of the thing. Only here, on
    // the manual add form: a recipe ingredient with no quantity means the
    // amount is unspecified ("poivre noir", "sel au goût"), and inventing a
    // 1 for it would be wrong. It also makes adding the same item twice sum
    // to 2 rather than staying a single quantity-less line.
    const quantity = trimmedQuantity ? Number(trimmedQuantity) : 1;
    try {
      const name = newItemName.trim();
      const result = await api.addGroceryItem({
        name,
        quantity,
        unit: newItemUnit.trim() || undefined,
        category_id: newItemCategoryId ? Number(newItemCategoryId) : undefined,
        list_id: activeListId,
      });
      // Adding can fold into an existing line. That's usually what you want
      // ("oignons" onto "onions"), but when the names differ it looks like
      // the app ignored what was typed — which is exactly what happens with
      // "sucre en poudre" landing on "sucre". Say so, and point at the fix.
      setMergeNotice(
        result.merged && normalize(result.merged_into ?? "") !== normalize(name)
          ? { typed: name, into: result.merged_into ?? "" }
          : null
      );
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

  async function saveItemQuantity(id: number, rawQuantity: string, rawUnit: string) {
    const trimmedQuantity = rawQuantity.trim();
    const quantity = trimmedQuantity ? Number(trimmedQuantity) : null;
    if (trimmedQuantity && Number.isNaN(quantity)) {
      setError("Quantité invalide");
      return;
    }
    const unit = rawUnit.trim() || null;
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

  // The item moves to a different group, and group order is derived from the
  // list's store order — so resync rather than patching local state, the
  // same way renaming a category does.
  async function changeItemCategory(
    item: GroceryItem,
    categoryId: number | null,
    remember: boolean
  ) {
    setError(null);
    try {
      await api.updateGroceryItemCategory(item.id, categoryId, remember);
      if (activeListId != null) await refreshItems(activeListId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de changer le rayon");
    }
  }

  // A drag has to beat a tap: without a small activation distance, tapping
  // the checkbox on a touch screen registers as a drag and the item never
  // toggles. The delay does the same for the touch sensor.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  async function changeSortMode(mode: SortMode) {
    if (activeListId == null) return;
    setError(null);
    try {
      await api.updateGroceryList(activeListId, { sort_mode: mode });
      await Promise.all([refreshLists(), refreshItems(activeListId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de changer le tri");
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || activeListId == null) return;

    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;

    const reordered = arrayMove(items, from, to);
    setItems(reordered);
    setError(null);
    try {
      await api.reorderGroceryItems(activeListId, reordered.map((i) => i.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de réordonner la liste");
      refreshItems(activeListId); // undo the optimistic reorder by resyncing
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

  async function handleListsChanged(selectId?: number) {
    await refreshLists();
    if (selectId != null) setActiveListId(selectId);
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
  const sortedCategories = useMemo(
    () => categories.slice().sort((a, b) => a.default_sort_order - b.default_sort_order),
    [categories]
  );

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
          {lists.map((list) => (
            <button
              key={list.id}
              onClick={() => setActiveListId(list.id)}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                list.id === activeListId
                  ? "border-sage bg-sage text-white"
                  : "border-line bg-white/60 text-ink/70 hover:border-sage"
              }`}
            >
              {list.name}
              {list.store_name &&
              list.store_name.trim().toLowerCase() !== list.name.trim().toLowerCase()
                ? ` · ${list.store_name}`
                : ""}
            </button>
          ))}
        </div>
      )}

      {/* The dictionary had its own nav tab for a while; the cookbook
          catalogue needed that slot more. It lives here again because this is
          where it's actually used — it exists to categorize and merge what
          goes on this list. The merge notice below still links to it too,
          where it's contextual rather than a second permanent entry point. */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowManageModal(true)}
          className="text-xs font-medium text-sage-dark hover:underline"
        >
          Gérer les listes et magasins
        </button>
        <Link
          to="/dictionnaire"
          className="text-xs font-medium text-sage-dark hover:underline"
        >
          Aliments
        </Link>
      </div>
      {showManageModal && (
        <ListStoreManager
          lists={lists}
          stores={stores}
          categories={categories}
          onListsChanged={handleListsChanged}
          onStoresChanged={refreshStores}
          onCategoriesChanged={refreshCategories}
          onDeleteList={handleDeleteList}
          onClose={() => setShowManageModal(false)}
        />
      )}

      {error && <p className="mt-3 text-sm text-brick">{error}</p>}

      {lists.length === 0 ? (
        <div className="mt-16 text-center text-ink/50">
          <p className="font-display text-xl">Aucune liste de courses</p>
          <p className="mt-1 text-sm">Créez-en une ci-dessus pour commencer.</p>
        </div>
      ) : activeListId == null ? null : (
        <>
          <div className="mt-4 rounded-card border border-sage/25 bg-sage/5 p-3">
            <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
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
                {sortedCategories.map((cat) => (
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
          </div>

          {mergeNotice && (
            <div className="mt-3 flex items-start gap-2 rounded-card border border-mustard/40 bg-mustard/10 px-3 py-2 text-sm">
              <p className="flex-1 text-ink/70">
                « {mergeNotice.typed} » a été regroupé avec « {mergeNotice.into} » — l'app
                les considère comme le même aliment.{" "}
                <Link to="/dictionnaire" className="underline hover:text-sage-dark">
                  Séparez-les dans le dictionnaire
                </Link>{" "}
                si ce n'est pas le cas.
              </p>
              <button
                onClick={() => setMergeNotice(null)}
                aria-label="Fermer"
                className="text-ink/30 hover:text-ink"
              >
                ✕
              </button>
            </div>
          )}

          {/* Shown for any list, empty or not. Sorting nothing is
              meaningless, but the mode is a property of the list rather than
              of its current contents — hiding it on an empty list makes the
              feature look missing on a list you haven't filled yet. */}
          {activeListId != null && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="text-xs text-ink/40">Trier</span>
              <div
                role="group"
                aria-label="Mode de tri"
                className="flex overflow-hidden rounded-lg border border-line text-xs"
              >
                {(["category", "manual"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => changeSortMode(mode)}
                    aria-pressed={sortMode === mode}
                    className={`px-3 py-1.5 font-medium ${
                      sortMode === mode
                        ? "bg-sage text-white"
                        : "bg-white text-ink/60 hover:text-ink"
                    }`}
                  >
                    {mode === "category" ? "Rayons" : "Manuel"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <div className="mt-16 text-center text-ink/50">
              <p className="font-display text-xl">Votre liste est vide</p>
              <p className="mt-1 text-sm">
                Ajoutez un article ci-dessus ou depuis une recette.
              </p>
            </div>
          ) : sortMode === "manual" ? (
            // One flat list, no aisle headers. Items keep their categories —
            // they just aren't the sort key here, so the 🏷 control on each
            // row still works and switching back to Rayons finds everything
            // filed, including under this list's store order.
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="mt-4 divide-y divide-line rounded-card border border-line">
                  {items.map((item) => (
                    <SortableGroceryItemRow
                      key={item.id}
                      item={item}
                      categories={sortedCategories}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                      onSaveQuantity={saveItemQuantity}
                      onChangeCategory={changeItemCategory}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
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
                      <GroceryItemRow
                        key={item.id}
                        item={item}
                        categories={sortedCategories}
                        onToggle={handleToggle}
                        onDelete={handleDelete}
                        onSaveQuantity={saveItemQuantity}
                        onChangeCategory={changeItemCategory}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-8 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClearChecked}
                disabled={!items.some((i) => i.is_checked)}
                className="rounded-lg border border-brick px-3 py-1.5 text-sm font-medium text-brick hover:bg-brick/10 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Retirer les articles cochés
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="rounded-lg border border-brick px-3 py-1.5 text-sm font-medium text-brick hover:bg-brick/10"
              >
                Vider la liste
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
