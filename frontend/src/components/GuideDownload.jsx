import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileDown, Check, Loader2, ArrowRight } from "lucide-react";
import { submitGuide, guideDownloadUrl } from "../lib/api";
import { IMAGES } from "../data/site";
import { EASE } from "../lib/animations";

export const GuideDownload = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError("Enter a valid email."); return; }
    setError("");
    setStatus("loading");
    try {
      await submitGuide({ name: name || "Homeowner", email });
      setStatus("success");
      const a = document.createElement("a");
      a.href = guideDownloadUrl;
      a.setAttribute("download", "FloGuard-Florida-Drainage-Guide.pdf");
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setStatus("idle");
      setError("Something went wrong. Please try again.");
    }
  };

  return (
    <section data-testid="guide-download" className="relative bg-brand-navy text-white overflow-hidden">
      <div className="absolute -right-24 -bottom-24 w-[400px] h-[400px] rounded-full border border-white/10" />
      <div className="container-fg relative z-10 py-20 md:py-24 grid lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-6">
          <p className="overline mb-5">Free download</p>
          <h2 className="font-display text-4xl sm:text-5xl tracking-tight leading-[0.98] max-w-lg">
            The Florida Drainage Guide.
          </h2>
          <p className="mt-5 text-lg text-white/70 max-w-lg">
            A plain-English PDF on how French drain + sump pump systems protect your home — plus the 5 warning signs
            you shouldn't ignore. Free, instant download.
          </p>
          <div className="mt-8 hidden lg:block">
            <img
              src="/images/diagram.webp"
              alt="Technical diagram of FloGuard French drain and sump pump system"
              width={960}
              height={540}
              className="w-full max-w-md rounded-sm border border-white/10"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>

        <div className="lg:col-span-6 lg:pl-8">
          <div className="bg-brand-surface border border-white/10 rounded-sm p-8">
            <AnimatePresence mode="wait">
              {status === "success" ? (
                <motion.div
                  key="ok"
                  data-testid="guide-success"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: EASE }}
                  className="text-center py-6"
                >
                  <div className="mx-auto w-14 h-14 rounded-full bg-brand-orange flex items-center justify-center">
                    <Check size={28} className="text-white" strokeWidth={3} />
                  </div>
                  <h3 className="font-display text-2xl mt-5">Your guide is downloading.</h3>
                  <p className="text-white/60 mt-2">Didn't start?{" "}
                    <a href={guideDownloadUrl} className="text-brand-orange underline">Click here to download</a>.
                  </p>
                </motion.div>
              ) : (
                <motion.form key="form" onSubmit={onSubmit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                  <div className="flex items-center gap-3 text-brand-orange mb-2">
                    <FileDown size={22} /> <span className="text-sm uppercase tracking-widest text-white/60">Get the free PDF</span>
                  </div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="guide-name"
                    placeholder="Your name"
                    className="w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm placeholder-white/30 focus:border-brand-orange outline-none"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="guide-email"
                    placeholder="you@email.com"
                    className="w-full bg-white/5 border border-white/15 text-white px-4 py-3 rounded-sm placeholder-white/30 focus:border-brand-orange outline-none"
                  />
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    data-testid="guide-submit"
                    className="w-full inline-flex items-center justify-center gap-2 bg-brand-orange text-white px-6 py-3.5 text-sm font-bold uppercase tracking-wider rounded-sm hover:bg-brand-orangeDark transition-colors disabled:opacity-60"
                  >
                    {status === "loading" ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    {status === "loading" ? "Preparing…" : "Download the guide"}
                  </button>
                  <p className="text-xs text-white/40 text-center">No spam. We'll only reach out about your drainage needs.</p>
                </motion.form>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
};
