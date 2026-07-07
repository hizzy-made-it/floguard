import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut, Inbox, TrendingUp, FileDown, Phone, Mail, Search, Loader2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getLeads, getLeadStats, updateLeadStatus } from "../lib/api";
import { formatDate } from "../data/blog";
import { IMAGES } from "../data/site";

const STATUS = ["new", "contacted", "quoted", "won", "lost"];
const statusColor = {
  new: "bg-brand-orange/20 text-brand-orange border-brand-orange/40",
  contacted: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  quoted: "bg-purple-500/20 text-purple-300 border-purple-500/40",
  won: "bg-green-500/20 text-green-300 border-green-500/40",
  lost: "bg-white/10 text-white/40 border-white/20",
};

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [srcFilter, setSrcFilter] = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([getLeads(), getLeadStats()]);
      setLeads(l);
      setStats(s);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const onLogout = () => { logout(); nav("/admin/login"); };
  const onStatus = async (id, status) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, status } : l)));
    try { await updateLeadStatus(id, status); } catch { load(); }
  };

  const filtered = leads.filter((l) => {
    const matchesSrc = srcFilter === "all" || l.source === srcFilter;
    const t = `${l.name} ${l.email} ${l.phone} ${l.location}`.toLowerCase();
    return matchesSrc && t.includes(q.toLowerCase());
  });

  const cards = stats
    ? [
        { icon: Inbox, label: "Total leads", value: stats.total },
        { icon: TrendingUp, label: "Last 7 days", value: stats.recent_7d },
        { icon: Phone, label: "Assessment requests", value: stats.by_source?.contact || 0 },
        { icon: FileDown, label: "Guide downloads", value: stats.by_source?.guide || 0 },
      ]
    : [];

  return (
    <div className="min-h-screen bg-brand-ink text-white grain">
      <header className="glass border-b border-white/10 sticky top-0 z-20">
        <div className="container-fg h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={IMAGES.logo} alt="FloGuard" className="h-9 w-9 object-contain rounded-sm bg-white/95 p-0.5" />
            <span className="font-display text-lg">FloGuard <span className="text-white/40 text-sm">Leads</span></span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-white/50">{user?.email}</span>
            <button onClick={onLogout} data-testid="admin-logout" className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-brand-orange transition-colors">
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="container-fg py-10">
        <h1 className="font-display text-4xl tracking-tight mb-8">Lead dashboard</h1>

        {/* stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {cards.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-brand-surface border border-white/10 rounded-sm p-5"
            >
              <c.icon size={20} className="text-brand-orange mb-3" />
              <div className="font-display text-3xl">{c.value}</div>
              <div className="text-sm text-white/50 mt-1">{c.label}</div>
            </motion.div>
          ))}
        </div>

        {/* controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="admin-search"
              placeholder="Search name, email, phone, city…"
              className="w-full bg-brand-surface border border-white/15 text-white pl-10 pr-4 py-2.5 rounded-sm placeholder-white/30 focus:border-brand-orange outline-none"
            />
          </div>
          <div className="flex gap-2">
            {["all", "contact", "guide"].map((s) => (
              <button
                key={s}
                onClick={() => setSrcFilter(s)}
                className={`px-4 py-2.5 text-sm rounded-sm border capitalize transition-colors ${srcFilter === s ? "bg-brand-orange border-brand-orange text-white" : "border-white/15 text-white/60 hover:border-white/40"}`}
              >
                {s === "contact" ? "Assessments" : s === "guide" ? "Guide" : "All"}
              </button>
            ))}
          </div>
        </div>

        {/* table */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-orange" size={28} /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-white/40">No leads yet.</div>
        ) : (
          <div className="overflow-x-auto border border-white/10 rounded-sm">
            <table className="w-full text-sm" data-testid="admin-leads-table">
              <thead className="bg-brand-surface text-white/50 uppercase text-xs tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Contact</th>
                  <th className="text-left px-4 py-3">Location</th>
                  <th className="text-left px-4 py-3">Issues</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Date</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-white/5 hover:bg-white/[0.03]" data-testid={`lead-row-${l.id}`}>
                    <td className="px-4 py-3 font-medium text-white">{l.name}</td>
                    <td className="px-4 py-3 text-white/70">
                      <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 hover:text-brand-orange"><Mail size={12} /> {l.email}</a>
                      {l.phone && <a href={`tel:${l.phone}`} className="flex items-center gap-1.5 hover:text-brand-orange mt-1"><Phone size={12} /> {l.phone}</a>}
                    </td>
                    <td className="px-4 py-3 text-white/60">{l.location || "—"}</td>
                    <td className="px-4 py-3 text-white/60 max-w-[220px]">{l.issues?.join(", ") || "—"}</td>
                    <td className="px-4 py-3"><span className="text-xs uppercase tracking-wide text-white/50">{l.source}</span></td>
                    <td className="px-4 py-3 text-white/50 whitespace-nowrap">{l.created_at ? formatDate(l.created_at.slice(0, 10)) : "—"}</td>
                    <td className="px-4 py-3">
                      <select
                        value={l.status || "new"}
                        onChange={(e) => onStatus(l.id, e.target.value)}
                        data-testid={`lead-status-${l.id}`}
                        className={`text-xs px-2 py-1 rounded-sm border bg-transparent outline-none ${statusColor[l.status || "new"]}`}
                      >
                        {STATUS.map((s) => <option key={s} value={s} className="bg-brand-surface text-white">{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
