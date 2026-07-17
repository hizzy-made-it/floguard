import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ArrowRight, ArrowLeft, Loader2, PhoneCall, Upload, X, ImagePlus } from "lucide-react";
import { submitLead, uploadPhoto } from "../lib/api";
import { QUIZ, COMPANY, SERVICE_AREAS } from "../data/site";
import { EASE } from "../lib/animations";
import { consumeChatHandoff, formatHandoffMessage } from "../lib/chatHandoff";

const fieldBase =
  "w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm text-base placeholder-white/30 focus:border-brand-orange focus:ring-1 focus:ring-brand-orange outline-none transition-colors";

export const AssessmentQuiz = () => {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [contact, setContact] = useState({ name: "", phone: "", email: "", address: "", message: "", website: "" });
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState("idle");
  const [errors, setErrors] = useState({});
  const advancing = useRef(false);
  const handoffSource = useRef("landing");

  useEffect(() => {
    const handoff = consumeChatHandoff();
    if (!handoff) return;
    handoffSource.current = "chatbot";
    const note = formatHandoffMessage(handoff);
    setContact((c) => ({
      ...c,
      message: c.message?.trim() ? c.message : note,
    }));
    if (handoff.inferredLocation) {
      const loc = handoff.inferredLocation;
      const match =
        SERVICE_AREAS.find((a) => a.toLowerCase() === loc.toLowerCase()) ||
        (loc ? "Other / nearby" : "");
      if (match) {
        setAnswers((a) => (a.location ? a : { ...a, location: match }));
      }
    }
  }, []);

  const step = QUIZ[index];
  const last = QUIZ.length - 1;
  const progress = Math.round((index / last) * 100);

  const next = () => setIndex((i) => Math.min(i + 1, last));
  const back = () => {
    setErrors({});
    setIndex((i) => Math.max(i - 1, 0));
  };

  const pickSingle = (value) => {
    if (advancing.current) return;
    advancing.current = true;
    setAnswers((a) => ({ ...a, [step.id]: value }));
    setErrors({});
    setTimeout(() => {
      next();
      advancing.current = false;
    }, 260);
  };

  const toggleMulti = (value) => {
    setAnswers((a) => {
      const cur = a[step.id] || [];
      return { ...a, [step.id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const onFiles = async (fileList) => {
    const files = Array.from(fileList).slice(0, 6 - photos.length);
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const localUrl = URL.createObjectURL(file);
      const entry = { name: file.name, localUrl, status: "uploading", path: null };
      setPhotos((p) => [...p, entry]);
      try {
        const result = await uploadPhoto(file);
        // Prefer direct URL (Supabase) when available for best performance
        const storedValue = result.url || result.path;
        setPhotos((p) => p.map((x) => (x.localUrl === localUrl ? { ...x, status: "done", path: storedValue } : x)));
      } catch {
        setPhotos((p) => p.map((x) => (x.localUrl === localUrl ? { ...x, status: "error" } : x)));
      }
    }
  };

  const removePhoto = (localUrl) => setPhotos((p) => p.filter((x) => x.localUrl !== localUrl));

  const validateMulti = () => {
    if ((answers[step.id] || []).length === 0) {
      setErrors({ multi: "Select at least one option." });
      return false;
    }
    return true;
  };

  const validateContact = () => {
    const e = {};
    if (!contact.name.trim()) e.name = "Enter your name.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) e.email = "Enter a valid email.";
    if (!contact.phone.trim()) e.phone = "Enter a phone number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onContinue = () => {
    if (step.type === "multi" && !validateMulti()) return;
    next();
  };

  const onSubmit = async () => {
    if (!validateContact()) return;
    setStatus("loading");
    try {
      await submitLead({
        ...answers,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        message: contact.message,
        website: contact.website || "",
        photos: photos.filter((p) => p.status === "done").map((p) => p.path),
        source: handoffSource.current || "landing",
      });
      setStatus("success");
      try {
        const { trackEvent } = await import("../components/Analytics");
        trackEvent("quiz_complete", { source: handoffSource.current || "landing" });
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("submitLead failed", err);
      setStatus("error");
    }
  };

  const uploading = photos.some((p) => p.status === "uploading");

  if (status === "success") {
    return (
      <div data-testid="quiz-success" className="bg-brand-surface border border-white/10 rounded-sm p-8 sm:p-12 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="mx-auto w-16 h-16 rounded-full bg-brand-orange flex items-center justify-center"
        >
          <Check size={30} className="text-white" strokeWidth={3} />
        </motion.div>
        <h3 className="font-display text-3xl text-white mt-6">You're all set, {contact.name.split(" ")[0] || "there"}.</h3>
        <p className="text-white/60 mt-3 max-w-md mx-auto">
          A FloGuard specialist will call you within 24 hours to schedule your free on-site assessment — with the details
          you shared, we'll come ready with a plan.
        </p>
        <a href={COMPANY.phoneHref} className="mt-8 inline-flex items-center gap-2 text-brand-orange font-semibold hover:underline">
          <PhoneCall size={18} /> Need it sooner? Call {COMPANY.phone}
        </a>
      </div>
    );
  }

  return (
    <div data-testid="assessment-quiz" className="bg-brand-surface border border-white/10 rounded-sm p-6 sm:p-9">
      {/* progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between text-xs text-white/50 mb-2">
          <span id="quiz-step-label">
            Step {index + 1} of {QUIZ.length}
          </span>
          <span>{progress}% complete</span>
        </div>
        <div
          className="h-1.5 rounded-full bg-white/10 overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-labelledby="quiz-step-label"
        >
          <motion.div className="h-full bg-brand-orange" animate={{ width: `${progress}%` }} transition={{ duration: 0.5, ease: EASE }} />
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          Step {index + 1} of {QUIZ.length}: {step.q}
        </p>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -30 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          <h3 className="font-display text-2xl sm:text-3xl text-white leading-tight">{step.q}</h3>
          {step.sub && <p className="text-white/50 text-sm mt-2 mb-6">{step.sub}</p>}
          {!step.sub && <div className="mb-6" />}

          {/* SINGLE / MULTI options */}
          {(step.type === "single" || step.type === "multi") && (
            <div className="grid sm:grid-cols-2 gap-3">
              {step.options.map((opt, idx) => {
                const active =
                  step.type === "single" ? answers[step.id] === opt : (answers[step.id] || []).includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    data-testid={`quiz-option-${step.id}-${idx}`}
                    onClick={() => (step.type === "single" ? pickSingle(opt) : toggleMulti(opt))}
                    className={`flex items-center gap-3 text-left px-4 py-3.5 min-h-[48px] rounded-sm border text-sm transition-colors active:bg-white/10 ${
                      active ? "border-brand-orange bg-brand-orange/10 text-white" : "border-white/15 text-white/70 hover:border-white/40"
                    }`}
                  >
                    <span
                      className={`shrink-0 w-4 h-4 grid place-items-center rounded-[3px] border ${
                        active ? "bg-brand-orange border-brand-orange" : "border-white/30"
                      }`}
                    >
                      {active && <Check size={11} className="text-white" strokeWidth={3} />}
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
          )}
          {errors.multi && <p className="text-red-400 text-sm mt-3">{errors.multi}</p>}

          {/* PHOTOS */}
          {step.type === "photos" && (
            <div>
              <label
                data-testid="quiz-photo-dropzone"
                className="flex flex-col items-center justify-center gap-2 border border-dashed border-white/25 rounded-sm py-10 cursor-pointer hover:border-brand-orange transition-colors text-white/60"
              >
                <ImagePlus size={26} className="text-brand-orange" />
                <span className="text-sm">Tap to add photos of the flooding / problem area</span>
                <span className="text-xs text-white/35">JPG or PNG · up to 6 photos</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  data-testid="quiz-photo-input"
                  className="hidden"
                  onChange={(e) => onFiles(e.target.files)}
                />
              </label>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-4">
                  {photos.map((p) => (
                    <div key={p.localUrl} className="relative aspect-square rounded-sm overflow-hidden border border-white/10">
                      <img src={p.localUrl} alt={p.name} className="w-full h-full object-cover" />
                      {p.status === "uploading" && (
                        <div className="absolute inset-0 bg-black/50 grid place-items-center">
                          <Loader2 size={18} className="animate-spin text-white" />
                        </div>
                      )}
                      {p.status === "error" && (
                        <div className="absolute inset-0 bg-red-900/60 grid place-items-center text-[10px] text-white px-1 text-center">Upload failed</div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(p.localUrl)}
                        className="absolute top-1 right-1 bg-black/60 rounded-full p-1 text-white hover:bg-red-600 transition-colors"
                        aria-label="Remove photo"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CONTACT */}
          {step.type === "contact" && (
            <div className="space-y-5">
              {/* Honeypot — leave empty */}
              <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
                <label htmlFor="quiz-website">Website</label>
                <input
                  id="quiz-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={contact.website || ""}
                  onChange={(e) => setContact({ ...contact, website: e.target.value })}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <label htmlFor="quiz-input-name" className="text-sm text-white/60 mb-2 block">Full name</label>
                  <input
                    id="quiz-input-name"
                    data-testid="quiz-input-name"
                    value={contact.name}
                    onChange={(e) => setContact({ ...contact, name: e.target.value })}
                    className={fieldBase}
                    placeholder="Jane Homeowner"
                    autoComplete="name"
                    aria-invalid={!!errors.name}
                    aria-describedby={errors.name ? "quiz-err-name" : undefined}
                  />
                  {errors.name && <p id="quiz-err-name" className="text-red-400 text-sm mt-1" role="alert">{errors.name}</p>}
                </div>
                <div>
                  <label htmlFor="quiz-input-phone" className="text-sm text-white/60 mb-2 block">Phone</label>
                  <input
                    id="quiz-input-phone"
                    data-testid="quiz-input-phone"
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                    className={fieldBase}
                    placeholder="(386) 000-0000"
                    autoComplete="tel"
                    aria-invalid={!!errors.phone}
                    aria-describedby={errors.phone ? "quiz-err-phone" : undefined}
                  />
                  {errors.phone && <p id="quiz-err-phone" className="text-red-400 text-sm mt-1" role="alert">{errors.phone}</p>}
                </div>
              </div>
              <div>
                <label htmlFor="quiz-input-email" className="text-sm text-white/60 mb-2 block">Email</label>
                <input
                  id="quiz-input-email"
                  data-testid="quiz-input-email"
                  type="email"
                  value={contact.email}
                  onChange={(e) => setContact({ ...contact, email: e.target.value })}
                  className={fieldBase}
                  placeholder="you@email.com"
                  autoComplete="email"
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? "quiz-err-email" : undefined}
                />
                {errors.email && <p id="quiz-err-email" className="text-red-400 text-sm mt-1" role="alert">{errors.email}</p>}
              </div>
              <div>
                <label htmlFor="quiz-input-address" className="text-sm text-white/60 mb-2 block">Street address (optional)</label>
                <input
                  id="quiz-input-address"
                  data-testid="quiz-input-address"
                  value={contact.address}
                  onChange={(e) => setContact({ ...contact, address: e.target.value })}
                  className={fieldBase}
                  placeholder="123 Palm Ave, Port Orange"
                  autoComplete="street-address"
                />
              </div>
              <div>
                <label htmlFor="quiz-input-message" className="text-sm text-white/60 mb-2 block">Anything else? (optional)</label>
                <textarea
                  id="quiz-input-message"
                  data-testid="quiz-input-message"
                  value={contact.message}
                  onChange={(e) => setContact({ ...contact, message: e.target.value })}
                  rows={2}
                  className={fieldBase}
                  placeholder="Add any detail that helps us prepare…"
                />
              </div>
              {status === "error" && (
                <p className="text-red-400 text-sm" role="alert">
                  Something went wrong. Please call us at {COMPANY.phone} or check your connection and try again.
                </p>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* nav */}
      <div className="flex items-center justify-between mt-8">
        {index > 0 ? (
          <button type="button" onClick={back} data-testid="quiz-back" className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors">
            <ArrowLeft size={16} /> Back
          </button>
        ) : (
          <span />
        )}

        {step.type === "single" ? (
          <span className="text-xs text-white/30">Tap an option to continue</span>
        ) : step.type === "contact" ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={status === "loading"}
            data-testid="quiz-submit"
            className="inline-flex items-center gap-2 bg-brand-orange text-white px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors disabled:opacity-60"
          >
            {status === "loading" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {status === "loading" ? "Sending…" : "Get my free assessment"}
          </button>
        ) : (
          <div className="flex items-center gap-4">
            {step.type === "photos" && (
              <button type="button" onClick={next} data-testid="quiz-skip" className="text-white/50 hover:text-white text-sm transition-colors">
                Skip
              </button>
            )}
            <button
              type="button"
              onClick={onContinue}
              disabled={uploading}
              data-testid="quiz-continue"
              className="inline-flex items-center gap-2 bg-brand-orange text-white px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors disabled:opacity-60"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : null}
              Continue <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
