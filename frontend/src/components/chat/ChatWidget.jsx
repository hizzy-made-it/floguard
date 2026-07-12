import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";

const OPEN_KEY = "fg_chat_open";
const PANEL_ID = "fg-chat-panel";

/**
 * Floating site assistant — marketing Layout only.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pulse, setPulse] = useState(false);
  const fabRef = useRef(null);
  const panelWrapRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    try {
      sessionStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    try {
      if (sessionStorage.getItem("fg_chat_pulsed") === "1") return;
      sessionStorage.setItem("fg_chat_pulsed", "1");
    } catch {
      /* ignore */
    }
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 4000);
    return () => clearTimeout(t);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => fabRef.current?.focus(), 0);
  }, []);

  // Escape + rudimentary focus trap while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelWrapRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      const list = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <div
      className="fixed z-[90] bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] flex flex-col items-end gap-3 pointer-events-none"
      data-testid="chat-widget"
    >
      {open && (
        <div ref={panelWrapRef} className="pointer-events-auto" id={PANEL_ID}>
          <ChatPanel open={open} onClose={close} titleId={titleId} />
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        data-testid="chat-fab"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-haspopup="dialog"
        aria-label={open ? "Close FloGuard assistant" : "Open FloGuard assistant"}
        onClick={() => setOpen((v) => !v)}
        className={`pointer-events-auto relative flex items-center justify-center w-14 h-14 min-w-[56px] min-h-[56px] rounded-full bg-brand-orange text-white shadow-lg shadow-brand-orange/30 hover:brightness-110 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2 ${
          pulse ? "animate-pulse" : ""
        }`}
      >
        {open ? <X size={24} strokeWidth={2.5} /> : <MessageCircle size={24} strokeWidth={2.5} />}
        {!open && pulse && (
          <span className="absolute inset-0 rounded-full bg-brand-orange/40 animate-ping pointer-events-none" aria-hidden />
        )}
      </button>
    </div>
  );
}
