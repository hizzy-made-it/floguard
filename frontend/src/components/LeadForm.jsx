import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ArrowRight, ArrowLeft, Loader2, PhoneCall } from "lucide-react";
import { submitLead } from "../lib/api";
import { ISSUE_OPTIONS, PROPERTY_TYPES, SERVICE_AREAS, COMPANY } from "../data/site";
import { EASE } from "../lib/animations";

const STEPS = ["Your situation", "Property details", "Contact info"];

export const LeadForm = () => {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({
    issues: [],
    propertyType: "",
    location: "",
    address: "",
    name: "",
    email: "",
    phone: "",
    message: "",
  });

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleIssue = (issue) =>
    setForm((f) => ({
      ...f,
      issues: f.issues.includes(issue) ? f.issues.filter((i) => i !== issue) : [...f.issues, issue],
    }));

  const validateStep = () => {
    const e = {};
    if (step === 0 && form.issues.length === 0) e.issues = "Select at least one.";
    if (step === 1) {
      if (!form.propertyType) e.propertyType = "Required.";
      if (!form.location) e.location = "Required.";
    }
    if (step === 2) {
      if (!form.name.trim()) e.name = "Enter your name.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = "Enter a valid email.";
      if (!form.phone.trim()) e.phone = "Enter a phone number.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => validateStep() && setStep((s) => Math.min(s + 1, 2));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const onSubmit = async () => {
    if (!validateStep()) return;
    setStatus("loading");
    try {
      await submitLead(form);
      setStatus("success");
    } catch (err) {
      setStatus("error");
    }
  };

  const fieldBase =
    "w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm text-base placeholder-white/30 focus:border-brand-orange focus:ring-1 focus:ring-brand-orange outline-none transition-colors";

  return (
    <div data-testid="lead-form" className="bg-brand-surface border border-white/10 rounded-sm p-6 sm:p-10">
      <AnimatePresence mode="wait">
        {status === "success" ? (
          <motion.div
            key="success"
            data-testid="lead-form-success"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="text-center py-10"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
              className="mx-auto w-16 h-16 rounded-full bg-brand-orange flex items-center justify-center"
            >
              <Check size={30} className="text-white" strokeWidth={3} />
            </motion.div>
            <h3 className="font-display text-3xl text-white mt-6">Request received.</h3>
            <p className="text-white/60 mt-3 max-w-md mx-auto">
              Thanks, {form.name.split(" ")[0] || "there"} — a FloGuard specialist will reach out within 24 hours to
              schedule your free on-site drainage assessment.
            </p>
            <a
              href={COMPANY.phoneHref}
              className="mt-8 inline-flex items-center gap-2 text-brand-orange font-semibold hover:underline"
            >
              <PhoneCall size={18} /> Prefer to talk now? {COMPANY.phone}
            </a>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* progress */}
            <div className="flex items-center gap-2 mb-8">
              {STEPS.map((label, i) => (
                <div key={label} className="flex-1">
                  <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                    <motion.div
                      className="h-full bg-brand-orange"
                      initial={false}
                      animate={{ width: i <= step ? "100%" : "0%" }}
                      transition={{ duration: 0.5, ease: EASE }}
                    />
                  </div>
                  <span className={`mt-2 block text-xs ${i === step ? "text-white" : "text-white/40"}`}>
                    {i + 1}. {label}
                  </span>
                </div>
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.35, ease: EASE }}
              >
                {step === 0 && (
                  <div>
                    <h3 className="font-display text-2xl text-white mb-1">What's happening on your property?</h3>
                    <p className="text-white/50 text-sm mb-6">Select everything that applies.</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {ISSUE_OPTIONS.map((issue, idx) => {
                        const active = form.issues.includes(issue);
                        return (
                          <button
                            key={issue}
                            type="button"
                            data-testid={`issue-option-${idx}`}
                            onClick={() => toggleIssue(issue)}
                            className={`text-left px-4 py-3 rounded-sm border text-sm transition-colors ${
                              active
                                ? "border-brand-orange bg-brand-orange/10 text-white"
                                : "border-white/15 text-white/70 hover:border-white/40"
                            }`}
                          >
                            {issue}
                          </button>
                        );
                      })}
                    </div>
                    {errors.issues && <p className="text-red-400 text-sm mt-3">{errors.issues}</p>}
                  </div>
                )}

                {step === 1 && (
                  <div className="space-y-5">
                    <h3 className="font-display text-2xl text-white mb-4">Tell us about the property.</h3>
                    <div>
                      <label className="text-sm text-white/60 mb-2 block">Property type</label>
                      <select
                        data-testid="input-property-type"
                        value={form.propertyType}
                        onChange={(e) => update("propertyType", e.target.value)}
                        className={fieldBase}
                      >
                        <option value="" className="bg-brand-surface">Select…</option>
                        {PROPERTY_TYPES.map((p) => (
                          <option key={p} value={p} className="bg-brand-surface">{p}</option>
                        ))}
                      </select>
                      {errors.propertyType && <p className="text-red-400 text-sm mt-1">{errors.propertyType}</p>}
                    </div>
                    <div>
                      <label className="text-sm text-white/60 mb-2 block">Nearest city</label>
                      <select
                        data-testid="input-location"
                        value={form.location}
                        onChange={(e) => update("location", e.target.value)}
                        className={fieldBase}
                      >
                        <option value="" className="bg-brand-surface">Select…</option>
                        {SERVICE_AREAS.map((a) => (
                          <option key={a} value={a} className="bg-brand-surface">{a}</option>
                        ))}
                      </select>
                      {errors.location && <p className="text-red-400 text-sm mt-1">{errors.location}</p>}
                    </div>
                    <div>
                      <label className="text-sm text-white/60 mb-2 block">Street address (optional)</label>
                      <input
                        data-testid="input-address"
                        value={form.address}
                        onChange={(e) => update("address", e.target.value)}
                        className={fieldBase}
                        placeholder="123 Palm Ave"
                      />
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5">
                    <h3 className="font-display text-2xl text-white mb-4">Where should we send your assessment?</h3>
                    <div className="grid sm:grid-cols-2 gap-5">
                      <div>
                        <label className="text-sm text-white/60 mb-2 block">Full name</label>
                        <input
                          data-testid="input-name"
                          value={form.name}
                          onChange={(e) => update("name", e.target.value)}
                          className={fieldBase}
                          placeholder="Jane Homeowner"
                        />
                        {errors.name && <p className="text-red-400 text-sm mt-1">{errors.name}</p>}
                      </div>
                      <div>
                        <label className="text-sm text-white/60 mb-2 block">Phone</label>
                        <input
                          data-testid="input-phone"
                          value={form.phone}
                          onChange={(e) => update("phone", e.target.value)}
                          className={fieldBase}
                          placeholder="(386) 000-0000"
                        />
                        {errors.phone && <p className="text-red-400 text-sm mt-1">{errors.phone}</p>}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm text-white/60 mb-2 block">Email</label>
                      <input
                        data-testid="input-email"
                        value={form.email}
                        onChange={(e) => update("email", e.target.value)}
                        className={fieldBase}
                        placeholder="you@email.com"
                      />
                      {errors.email && <p className="text-red-400 text-sm mt-1">{errors.email}</p>}
                    </div>
                    <div>
                      <label className="text-sm text-white/60 mb-2 block">Anything else? (optional)</label>
                      <textarea
                        data-testid="input-message"
                        value={form.message}
                        onChange={(e) => update("message", e.target.value)}
                        rows={3}
                        className={fieldBase}
                        placeholder="Tell us more about the flooding you're seeing…"
                      />
                    </div>
                    {status === "error" && (
                      <p className="text-red-400 text-sm">Something went wrong. Please call us at {COMPANY.phone}.</p>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between mt-8">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={back}
                  data-testid="form-back"
                  className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm transition-colors"
                >
                  <ArrowLeft size={16} /> Back
                </button>
              ) : (
                <span />
              )}
              {step < 2 ? (
                <button
                  type="button"
                  onClick={next}
                  data-testid="form-next"
                  className="inline-flex items-center gap-2 bg-brand-orange text-white px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors"
                >
                  Continue <ArrowRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={status === "loading"}
                  data-testid="form-submit"
                  className="inline-flex items-center gap-2 bg-brand-orange text-white px-6 py-3 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors disabled:opacity-60"
                >
                  {status === "loading" ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {status === "loading" ? "Sending…" : "Request assessment"}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
