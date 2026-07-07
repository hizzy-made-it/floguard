import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { IMAGES } from "../data/site";
import { EASE } from "../lib/animations";

function formatErr(detail) {
  if (!detail) return "Login failed. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || "").join(" ");
  return String(detail);
}

export default function AdminLogin() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      nav("/admin");
    } catch (err) {
      setError(formatErr(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-ink grain flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="flex items-center gap-3 mb-8 justify-center">
          <img src={IMAGES.logo} alt="FloGuard" className="h-11 w-11 object-contain rounded-sm bg-white/95 p-0.5" />
          <span className="font-display text-2xl text-white">Flo<span className="text-brand-orange">Guard</span></span>
        </div>
        <div className="bg-brand-surface border border-white/10 rounded-sm p-8">
          <div className="flex items-center gap-2 text-white/50 text-xs uppercase tracking-widest mb-6">
            <Lock size={14} className="text-brand-orange" /> Admin access
          </div>
          <h1 className="font-display text-3xl text-white tracking-tight mb-6">Sign in</h1>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-white/60 mb-2 block">Email</label>
              <input
                type="email"
                data-testid="admin-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm placeholder-white/30 focus:border-brand-orange outline-none"
                placeholder="admin@floguardfl.com"
              />
            </div>
            <div>
              <label className="text-sm text-white/60 mb-2 block">Password</label>
              <input
                type="password"
                data-testid="admin-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm placeholder-white/30 focus:border-brand-orange outline-none"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-red-400 text-sm" data-testid="admin-error">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              data-testid="admin-login-submit"
              className="w-full inline-flex items-center justify-center gap-2 bg-brand-orange text-white px-6 py-3.5 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors disabled:opacity-60"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
