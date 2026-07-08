import { Suspense, lazy, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Circle, Download, ArrowLeft, Loader2, Monitor, Video } from "lucide-react";
import { ThreeBoundary } from "../components/ThreeBoundary";
import { DURATION } from "../components/three/RainJourney3D";

const RainJourney3D = lazy(() => import("../components/three/RainJourney3D"));

export default function Studio() {
  const sceneRef = useRef();
  const [recording, setRecording] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [quality, setQuality] = useState("1080p");

  const recordWebm = () => {
    const gl = sceneRef.current?.getGl();
    const canvas = gl?.domElement;
    if (!canvas || recording) return;
    sceneRef.current.restart();

    const upscaleFactor = quality === "4K" ? 2 : 1;
    const origPR = gl.getPixelRatio();
    gl.setPixelRatio(origPR * upscaleFactor);

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const stream = canvas.captureStream(60);
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: quality === "4K" ? 50e6 : 20e6,
    });
    const chunks = [];

    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      gl.setPixelRatio(origPR);
      const url = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `floguard-rain-journey-${quality === "4K" ? "4k" : "1080p"}.webm`;
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

  const exportFrames = () => {
    const gl = sceneRef.current?.getGl();
    if (!gl || exporting) return;
    setExporting(true);
    sceneRef.current.restart();

    // bump resolution for capture
    const origPR = gl.getPixelRatio();
    gl.setPixelRatio(origPR * 2);

    const fps = 24;
    const totalFrames = Math.ceil(DURATION * fps);
    let frameIndex = 0;
    const frames = [];

    const captureNext = () => {
      if (frameIndex >= totalFrames) {
        gl.setPixelRatio(origPR);
        setExporting(false);
        setCountdown(0);
        downloadFramesAsHtml(frames, fps);
        return;
      }
      // snapshot one frame from the live rendering loop
      gl.domElement.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          frames.push({ url, index: frameIndex });
        }
        frameIndex++;
        const remaining = Math.round((totalFrames - frameIndex) / fps);
        setCountdown(remaining);
        setTimeout(captureNext, 1000 / fps);
      }, "image/png");
    };

    captureNext();
  };

  return (
    <div className="relative w-screen h-[100svh] overflow-hidden bg-[#7b93a3]">
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center bg-[#7b93a3] text-white"><Loader2 className="animate-spin" /></div>}>
        <ThreeBoundary fallback={<div className="absolute inset-0 grid place-items-center bg-brand-ink text-white/60">3D not supported on this device.</div>}>
          <RainJourney3D ref={sceneRef} showCaptions={false} />
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

        <div className="flex items-center gap-3">
          {/* Quality toggle */}
          <div className="flex bg-black/30 backdrop-blur rounded-full p-0.5">
            {["1080p", "4K"].map((q) => (
              <button
                key={q}
                onClick={() => setQuality(q)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  quality === q ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          {/* Record WebM */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={recordWebm}
            disabled={recording || exporting}
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
                <Video size={16} /> {quality === "4K" ? "Record 4K" : "Record HD"}
              </>
            )}
          </motion.button>

          {/* Export PNG sequence */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={exportFrames}
            disabled={recording || exporting}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold text-white transition-colors ${
              exporting ? "bg-emerald-700 cursor-default" : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {exporting ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Frames {countdown}s
              </>
            ) : (
              <>
                <Monitor size={14} /> PNG 4K
              </>
            )}
          </motion.button>
        </div>
      </div>

      {/* helper note */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-center text-white/70 text-xs px-4">
        Studio · Record HD/4K webm for ads or export 4K PNG frames for external compositing.
      </div>
    </div>
  );
}

/* Download frames as an HTML gallery page for review */
function downloadFramesAsHtml(frames, fps) {
  if (frames.length === 0) return;
  const images = frames
    .map(
      (f) =>
        `<div style="margin:0 0 12px 0;border-bottom:1px solid #333;padding:0 0 12px 0">
          <div style="font:12px monospace;color:#999;margin:0 0 4px 0">frame_${String(f.index).padStart(4, "0")}.png</div>
          <img src="${f.url}" style="width:100%;max-width:960px;display:block" />
        </div>`
    )
    .join("");
  const html = `<!DOCTYPE html><html><head><title>Frame Export</title><style>body{background:#111;color:#eee;font-family:system-ui;padding:24px;max-width:1200px;margin:0 auto}h1{font-size:16px;font-weight:400;margin:0 0 20px 0;color:#888}</style></head><body><h1>${frames.length} frames @ ${fps}fps &middot; ${(frames.length / fps).toFixed(1)}s</h1>${images}</body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "floguard-4k-frames.html";
  a.click();
  URL.revokeObjectURL(url);
  // cleanup blob URLs after a moment
  setTimeout(() => frames.forEach((f) => URL.revokeObjectURL(f.url)), 5000);
}
