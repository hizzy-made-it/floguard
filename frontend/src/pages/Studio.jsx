import { Suspense, lazy, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Circle, Download, ArrowLeft, Loader2 } from "lucide-react";
import { ThreeBoundary } from "../components/ThreeBoundary";
import { DURATION } from "../components/three/RainJourney3D";

const RainJourney3D = lazy(() => import("../components/three/RainJourney3D"));

export default function Studio() {
  const sceneRef = useRef();
  const [recording, setRecording] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const record = () => {
    const gl = sceneRef.current?.getGl();
    const canvas = gl?.domElement;
    if (!canvas || recording) return;
    sceneRef.current.restart();
    const stream = canvas.captureStream(60);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "floguard-rain-journey-10s.webm";
      a.click();
      URL.revokeObjectURL(url);
      setRecording(false);
      setCountdown(0);
    };
    setRecording(true);
    setCountdown(DURATION);
    rec.start();
    const iv = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    setTimeout(() => {
      clearInterval(iv);
      rec.stop();
    }, DURATION * 1000);
  };

  return (
    <div className="relative w-screen h-[100svh] overflow-hidden bg-[#7b93a3]">
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center bg-[#7b93a3] text-white"><Loader2 className="animate-spin" /></div>}>
        <ThreeBoundary fallback={<div className="absolute inset-0 grid place-items-center bg-brand-ink text-white/60">3D not supported on this device.</div>}>
          <RainJourney3D ref={sceneRef} showCaptions />
        </ThreeBoundary>
      </Suspense>

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-5">
        <Link
          to="/"
          data-testid="studio-back"
          className="inline-flex items-center gap-2 text-white/90 bg-black/40 backdrop-blur px-4 py-2 rounded-full text-sm hover:bg-black/60 transition-colors"
        >
          <ArrowLeft size={16} /> Back to site
        </Link>

        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          onClick={record}
          disabled={recording}
          data-testid="studio-record"
          className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
            recording ? "bg-red-600 cursor-default" : "bg-brand-orange hover:bg-brand-orangeDark"
          }`}
        >
          {recording ? (
            <>
              <Circle size={12} className="fill-white animate-pulse" /> Recording… {countdown}s
            </>
          ) : (
            <>
              <Download size={16} /> Record 10s ad clip
            </>
          )}
        </motion.button>
      </div>

      {/* helper note */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-center text-white/70 text-xs px-4">
        Private studio · Records a downloadable .webm you can upload to Facebook / Instagram ads.
      </div>
    </div>
  );
}
