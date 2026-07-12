import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Send, X, Phone } from "lucide-react";
import { CHAT_KNOWLEDGE, DEFAULT_CHIPS, GREETING } from "../../data/chatKnowledge";
import { SERVICE_AREAS, COMPANY } from "../../data/site";
import { matchAnswer } from "../../lib/chatMatcher";
import { writeChatHandoff, ASSESSMENT_PATH } from "../../lib/chatHandoff";
import { ChatMessage } from "./ChatMessage";

const HISTORY_KEY = "fg_chat_history";
const MAX_HISTORY = 40;

function loadHistory() {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : null;
  } catch {
    return null;
  }
}

function saveHistory(messages) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {{ onClose: () => void, open: boolean, titleId?: string }} props
 */
export function ChatPanel({ onClose, open, titleId = "fg-chat-title" }) {
  const navigate = useNavigate();
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const answeredCount = useRef(0);
  const topicsRef = useRef([]);
  const lastUserRef = useRef("");
  const locationRef = useRef("");

  const [messages, setMessages] = useState(() => {
    const hist = typeof sessionStorage !== "undefined" ? loadHistory() : null;
    if (hist?.length) return hist;
    return [
      {
        id: "greet",
        role: "bot",
        text: GREETING,
        showHandoff: false,
      },
    ];
  });
  const [input, setInput] = useState("");
  const [chips, setChips] = useState(DEFAULT_CHIPS);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, chips]);

  const persistHandoff = () => {
    writeChatHandoff({
      lastUserMessage: lastUserRef.current,
      topics: topicsRef.current,
      inferredLocation: locationRef.current,
    });
  };

  const goAssessment = () => {
    persistHandoff();
    onClose();
    navigate(ASSESSMENT_PATH);
  };

  const respond = (rawText) => {
    const text = String(rawText || "").trim();
    if (!text) return;

    lastUserRef.current = text;
    const userMsg = { id: makeId(), role: "user", text };
    setMessages((m) => [...m, userMsg]);

    const result = matchAnswer(text, CHAT_KNOWLEDGE, { serviceAreas: SERVICE_AREAS });
    if (result.inferredLocation) locationRef.current = result.inferredLocation;
    if (result.entry?.title) {
      topicsRef.current = [...new Set([...topicsRef.current, result.entry.title])].slice(-6);
    }

    const isBookChip = /book free assessment|start free assessment|free assessment/i.test(text);
    let showHandoff = result.handoff || isBookChip;

    if (result.type === "match") {
      answeredCount.current += 1;
      // Soft handoff after first solid answer
      if (answeredCount.current >= 1) showHandoff = true;
    }
    if (result.type === "fallback") showHandoff = true;

    let botText = result.answer;
    if (isBookChip) {
      botText =
        "Great — we'll send you to our free assessment questionnaire on the Contact page. It takes a few minutes and gives our crew everything they need.";
      showHandoff = true;
    }

    const botMsg = {
      id: makeId(),
      role: "bot",
      text: botText,
      showHandoff,
    };
    setMessages((m) => [...m, botMsg]);
    setChips(result.relatedChips?.length ? result.relatedChips : DEFAULT_CHIPS);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    const t = input.trim();
    if (!t) return;
    setInput("");
    respond(t);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="chat-panel"
      className="flex flex-col w-[min(100vw-1.5rem,380px)] h-[min(70vh,520px)] bg-brand-surface border border-white/15 shadow-2xl rounded-sm overflow-hidden"
    >
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-brand-ink text-white border-b border-white/10">
        <div className="flex-1 min-w-0">
          <h2 id={titleId} className="font-display text-lg leading-tight">
            FloGuard Assistant
          </h2>
          <p className="text-xs text-white/55 truncate">Drainage help · Central Florida</p>
        </div>
        <a
          href={COMPANY.phoneHref}
          className="p-2 rounded-sm text-white/80 hover:bg-white/10 hover:text-white"
          aria-label={`Call ${COMPANY.phone}`}
        >
          <Phone size={18} />
        </a>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-sm text-white/80 hover:bg-white/10 hover:text-white min-h-[44px] min-w-[44px] grid place-items-center"
          aria-label="Close chat"
          data-testid="chat-close"
        >
          <X size={18} />
        </button>
      </div>

      {/* messages */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-[#f4f5f7]"
        aria-live="polite"
        data-testid="chat-messages"
      >
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            text={msg.text}
            showHandoff={msg.showHandoff}
            onAssessment={goAssessment}
          />
        ))}
      </div>

      {/* chips */}
      <div className="px-3 py-2 flex flex-wrap gap-1.5 bg-white border-t border-black/5">
        {chips.map((chip) => (
          <button
            key={chip}
            type="button"
            data-testid="chat-chip"
            onClick={() => respond(chip)}
            className="text-xs px-2.5 py-1.5 min-h-[36px] rounded-full border border-brand-navy/15 text-brand-navy/80 hover:border-brand-orange hover:text-brand-orange transition bg-white"
          >
            {chip}
          </button>
        ))}
      </div>

      {/* input */}
      <form onSubmit={onSubmit} className="flex items-end gap-2 p-3 bg-white border-t border-black/10">
        <label htmlFor="fg-chat-input" className="sr-only">
          Message
        </label>
        <input
          id="fg-chat-input"
          ref={inputRef}
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about drainage…"
          autoComplete="off"
          className="flex-1 min-h-[44px] px-3 py-2 text-base sm:text-sm rounded-sm border border-black/15 bg-white text-brand-ink placeholder:text-black/35 focus:border-brand-orange focus:ring-1 focus:ring-brand-orange outline-none"
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={!input.trim()}
          className="min-h-[44px] min-w-[44px] grid place-items-center rounded-sm bg-brand-orange text-white disabled:opacity-40 hover:brightness-110 transition"
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
