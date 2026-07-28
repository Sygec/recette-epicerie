const TOKEN_KEY = "session_token";

// Shared between GroceryList (which list tab opens by default) and
// AddToListReview (which list an add defaults to / lands on) — the same
// key so adding items to a list also makes that the one you see on
// /courses afterward, instead of the two staying independently "last used."
export const ACTIVE_GROCERY_LIST_KEY = "active_grocery_list_id";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/connexion";
    throw new Error("Session expirée");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Une erreur est survenue");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) =>
    request<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  getRecipes: (params?: { q?: string; tag?: string; favorites?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.tag) qs.set("tag", params.tag);
    if (params?.favorites) qs.set("favorites", "1");
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<Recipe[]>(`/api/recipes${suffix}`);
  },

  getRecipe: (id: number) => request<RecipeDetail>(`/api/recipes/${id}`),

  createRecipe: (payload: RecipePayload) =>
    request<{ id: number }>("/api/recipes", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateRecipe: (id: number, payload: RecipePayload) =>
    request<{ ok: true }>(`/api/recipes/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteRecipe: (id: number) =>
    request<{ ok: true }>(`/api/recipes/${id}`, { method: "DELETE" }),

  uploadPhoto: (id: number, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    return request<{ photo_url: string }>(`/api/recipes/${id}/photo`, {
      method: "POST",
      body: form,
    });
  },

  importRecipe: (url: string) =>
    request<ImportedRecipe>("/api/recipes/import", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  setPhotoFromUrl: (id: number, url: string) =>
    request<{ photo_url: string }>(`/api/recipes/${id}/photo-from-url`, {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  setFavorite: (id: number, favorite: boolean) =>
    request<{ ok: true }>(`/api/recipes/${id}/favorite`, {
      method: favorite ? "POST" : "DELETE",
    }),

  getTags: () => request<Tag[]>("/api/tags"),

  getCategories: () => request<Category[]>("/api/categories"),

  createCategory: (name: string) =>
    request<{ id: number }>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  renameCategory: (id: number, name: string) =>
    request<{ ok: true }>(`/api/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),

  deleteCategory: (id: number) =>
    request<{ ok: true }>(`/api/categories/${id}`, { method: "DELETE" }),

  getStores: () => request<Store[]>("/api/stores"),

  createStore: (name: string) =>
    request<{ id: number }>("/api/stores", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  renameStore: (id: number, name: string) =>
    request<{ ok: true }>(`/api/stores/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),

  deleteStore: (id: number) =>
    request<{ ok: true }>(`/api/stores/${id}`, { method: "DELETE" }),

  getStoreCategoryOrder: (storeId: number) =>
    request<StoreCategoryOrderEntry[]>(`/api/stores/${storeId}/category-order`),

  setStoreCategoryOrder: (storeId: number, categoryIds: number[]) =>
    request<{ ok: true }>(`/api/stores/${storeId}/category-order`, {
      method: "PUT",
      body: JSON.stringify({ category_ids: categoryIds }),
    }),

  getGroceryLists: () => request<GroceryList[]>("/api/grocery-lists"),

  createGroceryList: (name: string, storeId?: number | null) =>
    request<{ id: number }>("/api/grocery-lists", {
      method: "POST",
      body: JSON.stringify({ name, store_id: storeId ?? null }),
    }),

  updateGroceryList: (
    id: number,
    payload: { name?: string; store_id?: number | null }
  ) =>
    request<{ ok: true }>(`/api/grocery-lists/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteGroceryList: (id: number) =>
    request<{ ok: true }>(`/api/grocery-lists/${id}`, { method: "DELETE" }),

  getGroceryItems: (listId: number) =>
    request<GroceryItem[]>(`/api/grocery-items?list_id=${listId}`),

  addGroceryItem: (payload: {
    name: string;
    quantity?: number;
    unit?: string;
    category_id?: number;
    recipe_id?: number;
    list_id: number;
  }) =>
    request<{ id: number }>("/api/grocery-items", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  toggleGroceryItem: (id: number, is_checked: boolean) =>
    request<{ ok: true }>(`/api/grocery-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_checked }),
    }),

  updateGroceryItemQuantity: (id: number, quantity: number | null, unit: string | null) =>
    request<{ ok: true }>(`/api/grocery-items/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ quantity, unit }),
    }),

  deleteGroceryItem: (id: number) =>
    request<{ ok: true }>(`/api/grocery-items/${id}`, { method: "DELETE" }),

  clearGroceryItems: (listId: number, checkedOnly: boolean) =>
    request<{ ok: true }>(
      `/api/grocery-lists/${listId}/items${checkedOnly ? "?checked_only=1" : ""}`,
      { method: "DELETE" }
    ),

  getMealPlan: (start: string, end: string) =>
    request<MealPlanEntry[]>(`/api/meal-plan?start=${start}&end=${end}`),

  setMealPlanEntry: (payload: { date: string; recipe_id: number; servings?: number }) =>
    request<{ ok: true }>("/api/meal-plan", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  deleteMealPlanEntry: (id: number) =>
    request<{ ok: true }>(`/api/meal-plan/${id}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Recipe {
  id: number;
  title: string;
  description: string | null;
  photo_url: string | null;
  servings: number | null;
  prep_time: number | null;
  cook_time: number | null;
  difficulty: string | null;
  source_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface Ingredient {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
}

export interface Step {
  id: number;
  step_number: number;
  text: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface RecipeDetail extends Recipe {
  ingredients: Ingredient[];
  steps: Step[];
  tags: Tag[];
  is_favorite: boolean;
}

export interface RecipePayload {
  title: string;
  description?: string;
  servings?: number;
  prep_time?: number;
  cook_time?: number;
  difficulty?: string;
  source_url?: string;
  notes?: string;
  ingredients?: { name: string; quantity?: number; unit?: string }[];
  steps?: { text: string }[];
  tags?: string[];
}

export interface ImportedIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface ImportedRecipe {
  title: string;
  description?: string;
  servings?: number;
  prep_time?: number;
  cook_time?: number;
  ingredients: ImportedIngredient[];
  steps: string[];
  tags: string[];
  image_url?: string;
  source: "json-ld" | "fallback";
  warning?: string;
}

export interface Category {
  id: number;
  name: string;
  is_custom: number;
  default_sort_order: number;
}

export interface Store {
  id: number;
  name: string;
  created_at: string;
}

export interface StoreCategoryOrderEntry {
  category_id: number;
  sort_order: number;
}

export interface GroceryList {
  id: number;
  name: string;
  store_id: number | null;
  store_name: string | null;
  created_at: string;
}

export interface MealPlanEntry {
  id: number;
  date: string;
  recipe_id: number;
  servings: number | null;
  notes: string | null;
  recipe_title: string;
  recipe_photo_url: string | null;
  recipe_servings: number | null;
  ingredients: Ingredient[];
}

export interface GroceryItem {
  id: number;
  list_id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  category_id: number | null;
  category_name: string | null;
  category_is_custom: number | null;
  recipe_id: number | null;
  is_checked: number;
}
