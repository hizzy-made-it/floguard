import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";

const OPEN_KEY = "fg_chat_open";

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
    // restore focus to FAB after close
    setTimeout(() => fabRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
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
        <div className="pointer-events-auto">
          <ChatPanel open={open} onClose={close} aria-labelledby={titleId} />
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        data-testid="chat-fab"
        aria-expanded={open}
        aria-controls={open ? undefined : undefined}
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
