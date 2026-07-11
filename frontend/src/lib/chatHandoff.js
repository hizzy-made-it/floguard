/** Contact-quiz handoff from the site chatbot (sessionStorage). */

export const HANDOFF_KEY = "fg_chat_handoff";
export const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ lastUserMessage?: string, topics?: string[], inferredLocation?: string }} payload
 */
export function writeChatHandoff(payload = {}) {
  if (typeof sessionStorage === "undefined") return;
  const data = {
    v: 1,
    createdAt: new Date().toISOString(),
    lastUserMessage: payload.lastUserMessage || "",
    topics: Array.isArray(payload.topics) ? payload.topics.slice(0, 8) : [],
    inferredLocation: payload.inferredLocation || "",
    source: "chatbot",
  };
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Read handoff without consuming. Returns null if missing/stale. */
export function peekChatHandoff() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1 || !data.createdAt) return null;
    const age = Date.now() - new Date(data.createdAt).getTime();
    if (Number.isNaN(age) || age > HANDOFF_MAX_AGE_MS) {
      sessionStorage.removeItem(HANDOFF_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/** Read once and remove from storage. */
export function consumeChatHandoff() {
  const data = peekChatHandoff();
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      /* ignore */
    }
  }
  return data;
}

/** Build a short note for the assessment quiz message field. */
export function formatHandoffMessage(data) {
  if (!data) return "";
  const parts = ["[Chatbot handoff]"];
  if (data.topics?.length) parts.push(`Topics: ${data.topics.join(", ")}`);
  if (data.lastUserMessage) parts.push(`Last question: ${data.lastUserMessage}`);
  return parts.join(" | ");
}

export const ASSESSMENT_PATH = "/contact#assessment";
