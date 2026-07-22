import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import Nav from "./components/Nav";
import Login from "./pages/Login";
import RecipeList from "./pages/RecipeList";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeForm from "./pages/RecipeForm";
import GroceryList from "./pages/GroceryList";
import { getToken } from "./lib/api";

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/connexion" replace />;
  return children;
}

// React Router reuses a route's component instance when navigating between
// sibling routes that render the same component type at the same position
// (e.g. /recettes/1 -> /recettes/2, or edit -> nouvelle) — the component
// never unmounts, so state from the previous recipe can leak into the next
// page until its data finishes loading. Keying by the route param forces a
// clean remount on every navigation instead.
function RecipeDetailRoute() {
  const { id } = useParams();
  return <RecipeDetail key={id} />;
}

function RecipeFormRoute() {
  const { id } = useParams();
  return <RecipeForm key={id ?? "new"} />;
}

export default function App() {
  // Subscribe to route changes so the auth check below re-runs after login
  // navigates client-side (otherwise the token snapshot stays stale and the
  // nav bar never appears until a full page reload).
  useLocation();
  const authed = !!getToken();

  return (
    <>
      {authed && <Nav />}
      <main className={authed ? "sm:pt-0" : ""}>
        <Routes>
          <Route path="/connexion" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <RecipeList />
              </RequireAuth>
            }
          />
          <Route
            path="/recettes/nouvelle"
            element={
              <RequireAuth>
                <RecipeFormRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/recettes/:id"
            element={
              <RequireAuth>
                <RecipeDetailRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/recettes/:id/modifier"
            element={
              <RequireAuth>
                <RecipeFormRoute />
              </RequireAuth>
            }
          />
          <Route
            path="/courses"
            element={
              <RequireAuth>
                <GroceryList />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
