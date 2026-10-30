// Plain-text helpers for inline markdown in src/data/* strings (no React imports, so data
// modules and JSON-LD builders can use them). Rendering lives in lib/inlineMarkdown.jsx.

/** "[label](/path)" → "label", "**bold**" → "bold". For JSON-LD, meta and the chat KB. */
export function stripInline(text) {
  if (typeof text !== "string") return text;
  return text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1");
}
