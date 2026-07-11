import { COMPANY } from "../../data/site";
import { ASSESSMENT_PATH } from "../../lib/chatHandoff";

/**
 * @param {{ role: "user"|"bot", text: string, showHandoff?: boolean, onAssessment?: () => void }} props
 */
export function ChatMessage({ role, text, showHandoff, onAssessment }) {
  const isUser = role === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
      data-testid={isUser ? "chat-msg-user" : "chat-msg-bot"}
    >
      <div
        className={`max-w-[90%] rounded-sm px-3.5 py-2.5 text-sm leading-relaxed ${
          isUser
            ? "bg-brand-orange text-white"
            : "bg-white border border-black/10 text-brand-ink"
        }`}
      >
        <p className="whitespace-pre-wrap">{text}</p>
        {showHandoff && !isUser && (
          <div className="mt-3 pt-3 border-t border-black/10 space-y-2">
            <p className="text-xs text-brand-slate">
              For a free on-site assessment we use a short questionnaire on Contact so the crew gets the full picture.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href={ASSESSMENT_PATH}
                data-testid="chat-cta-assessment"
                onClick={(e) => {
                  if (onAssessment) {
                    e.preventDefault();
                    onAssessment();
                  }
                }}
                className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 text-xs font-bold uppercase tracking-wider bg-brand-orange text-white rounded-sm hover:brightness-110 transition"
              >
                Start free assessment
              </a>
              <a
                href={COMPANY.phoneHref}
                className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 text-xs font-semibold border border-brand-navy/20 text-brand-navy rounded-sm hover:bg-brand-navy/5 transition"
              >
                Call {COMPANY.phone}
              </a>
              <a
                href={COMPANY.smsHref}
                className="inline-flex items-center justify-center min-h-[40px] px-3 py-2 text-xs font-semibold border border-brand-navy/20 text-brand-navy rounded-sm hover:bg-brand-navy/5 transition"
              >
                Text us
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
