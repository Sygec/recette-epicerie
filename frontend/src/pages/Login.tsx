import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../lib/api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token } = await api.login(password);
      setToken(token);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-card border border-line bg-white/50 p-8 shadow-sm"
      >
        <h1 className="font-display text-3xl text-sage-dark">Recettes & Courses</h1>
        <p className="mt-1 text-sm text-ink/60">
          Entrez le mot de passe partagé pour continuer.
        </p>

        <label className="mt-6 block text-sm font-medium text-ink/80">
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2
                       focus:border-sage focus:outline-none"
            autoFocus
            required
          />
        </label>

        {error && <p className="mt-3 text-sm text-brick">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-sage px-4 py-2.5 font-medium text-white
                     transition-colors hover:bg-sage-dark disabled:opacity-50"
        >
          {loading ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
