import { useState } from "react";
import { Loader2, ExternalLink, Send, Wand2 } from "lucide-react";
import { buildLeadPages } from "../lib/api";

/**
 * Builds (or reuses) each saved lead's public page on the CRM and lists them for review.
 * Building never emails anyone. "Send replies" emails only the checked leads, and only when
 * auto-replies are switched on in the CRM (LEAD_AUTOREPLY_ENABLED).
 */
export default function LeadPagesPanel() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [checked, setChecked] = useState({});

  const run = async (body, label) => {
    setBusy(label);
    setError("");
    try {
      const data = await buildLeadPages(body);
      setRows(data.leads || []);
    } catch (e) {
      setError(e?.response?.data?.detail || e?.message || "Something went wrong.");
    } finally {
      setBusy("");
    }
  };

  const ids = Object.keys(checked).filter((k) => checked[k]);
  const sendingOn = rows?.some((r) => r.sending_enabled);

  const send = () => {
    if (!ids.length) return;
    const names = rows.filter((r) => ids.includes(r.id)).map((r) => `${r.name} <${r.email}>`).join("\n");
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Email the auto-reply to these ${ids.length} lead(s)?\n\n${names}`)) return;
    run({ send: true, send_ids: ids, only_ids: ids }, "send");
  };

  return (
    <section className="mb-10 bg-brand-surface border border-white/10 rounded-sm p-5" data-testid="lead-pages-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Lead pages + auto-replies</h2>
          <p className="text-sm text-white/60 mt-1">Builds each lead's private page. Building never emails anyone.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => run({}, "build")} disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm rounded-sm bg-brand-orange text-white disabled:opacity-50">
            {busy === "build" ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Build pages (no emails)
          </button>
          {rows && (
            <button onClick={send} disabled={!!busy || !ids.length || !sendingOn} title={sendingOn ? "" : "Auto-replies are switched off in the CRM"} className="inline-flex items-center gap-2 px-4 py-2.5 text-sm rounded-sm border border-white/20 text-white disabled:opacity-40">
              {busy === "send" ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Send replies ({ids.length})
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
      {rows && (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead className="text-white/50 uppercase text-xs tracking-wider">
              <tr><th className="w-8"></th><th className="text-left py-2">Name</th><th className="text-left py-2">Address</th><th className="text-left py-2">Version</th><th className="text-left py-2">Page</th><th className="text-left py-2">Email</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/5">
                  <td className="py-2"><input type="checkbox" disabled={!r.ok || !!r.already_sent_at} checked={!!checked[r.id]} onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))} aria-label={`Select ${r.name}`} /></td>
                  <td className="py-2 text-white">{r.name}</td>
                  <td className="py-2 text-white/60">{r.address || "—"}</td>
                  <td className="py-2">{r.ok ? <span className={r.version === "full" ? "text-green-300" : "text-white/60"}>{r.version === "full" ? "Full (visuals)" : "Simple"}</span> : <span className="text-red-300">Failed</span>}</td>
                  <td className="py-2">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-orange">Open <ExternalLink size={12} /></a> : "—"}</td>
                  <td className="py-2 text-white/60">{r.already_sent_at ? `Sent ${r.already_sent_at.slice(0, 10)}` : r.sent === "sent" ? "Sent" : r.sent === "test_only" ? "Test mode" : "Not sent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sendingOn && <p className="text-xs text-white/50 mt-3">Auto-replies are switched off in the CRM, so Send is disabled.</p>}
        </div>
      )}
    </section>
  );
}
