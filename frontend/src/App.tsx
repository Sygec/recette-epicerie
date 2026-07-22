import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
                <RecipeForm />
              </RequireAuth>
            }
          />
          <Route
            path="/recettes/:id"
            element={
              <RequireAuth>
                <RecipeDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/recettes/:id/modifier"
            element={
              <RequireAuth>
                <RecipeForm />
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
