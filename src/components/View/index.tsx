import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore, includedFrames } from "../../store";
import { buildPdf } from "../../lib/pdfBuilder";
import { writeFrameLog } from "../../lib/frameLog";
import type { FrameEntry } from "../../types";

function formatHMS(secs: number): string {
  if (!isFinite(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.5, 2, 3];
const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const BASE_PAGE_WIDTH = 896; // px, matches max-w-4xl

type ViewMode = "continuous" | "single" | "two-page";

export default function View() {
  const selectedVideo = useStore((s) => s.selectedVideo);
  const frames = useStore((s) => s.frames);
  const included = includedFrames(frames);

  const [currentPage, setCurrentPage] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(160);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [viewMode, setViewMode] = useState<ViewMode>("continuous");

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef(0);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubActiveRef = useRef(false);
  const scrubHandlerRef = useRef<(clientX: number) => void>(() => {});
  const scrubEndHandlerRef = useRef<() => void>(() => {});
  const isPlayingRef = useRef(false);
  const sidebarResizeRef = useRef<{ x: number; w: number } | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(0);
  const currentPageRef = useRef(0);
  const includedRef = useRef<FrameEntry[]>([]);
  const viewModeRef = useRef<ViewMode>("continuous");

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { includedRef.current = included; }, [included]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);

  function getSegmentEnd(pageIdx: number): number {
    const inc = includedRef.current;
    const next = inc[pageIdx + 1];
    return next ? next.timestampMs / 1000 : (videoRef.current?.duration ?? Infinity);
  }

  function getPageAtOrBefore(ms: number): number {
    const inc = includedRef.current;
    let idx = 0;
    for (let i = 0; i < inc.length; i++) {
      if (inc[i].timestampMs <= ms) idx = i;
      else break;
    }
    return idx;
  }

  // IntersectionObserver — only used in continuous mode
  useEffect(() => {
    observerRef.current?.disconnect();
    if (viewMode !== "continuous" || included.length === 0) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        let best: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting && (!best || entry.intersectionRatio > best.intersectionRatio)) {
            best = entry;
          }
        }
        if (best) {
          const idx = parseInt((best.target as HTMLElement).dataset.idx ?? "0", 10);
          setCurrentPage(idx);
        }
      },
      { root: scrollContainerRef.current, threshold: [0.3, 0.6] }
    );

    pageRefs.current.forEach((el) => observerRef.current!.observe(el));
    return () => observerRef.current?.disconnect();
  }, [viewMode, included.length]);

  // Page changed — seek video if playing
  useEffect(() => {
    if (prevPageRef.current === currentPage) return;
    prevPageRef.current = currentPage;
    const video = videoRef.current;
    const frame = included[currentPage];
    if (!video || !frame) return;
    if (!isPlayingRef.current) return;

    video.currentTime = frame.timestampMs / 1000;
    if (video.paused) {
      video.play()
        .then(() => {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = requestAnimationFrame(tick);
        })
        .catch((e) => console.warn("Auto-resume failed:", e));
    }
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Global mouse handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (scrubActiveRef.current) scrubHandlerRef.current(e.clientX);
      if (sidebarResizeRef.current) {
        const delta = e.clientX - sidebarResizeRef.current.x;
        setSidebarWidth(Math.max(80, Math.min(360, sidebarResizeRef.current.w + delta)));
      }
    }
    function onMouseUp() {
      if (scrubActiveRef.current) {
        scrubActiveRef.current = false;
        setIsScrubbing(false);
        setScrubPercent(null);
        scrubEndHandlerRef.current();
      }
      sidebarResizeRef.current = null;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!showSpeedMenu) return;
    function onDown(e: MouseEvent) {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node))
        setShowSpeedMenu(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSpeedMenu]);

  scrubHandlerRef.current = (clientX: number) => {
    const bar = progressBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setScrubPercent(pct);
    const video = videoRef.current;
    if (video && isFinite(video.duration) && video.duration > 0)
      video.currentTime = (pct / 100) * video.duration;
  };

  scrubEndHandlerRef.current = () => {
    const video = videoRef.current;
    if (!video) return;
    const ms = video.currentTime * 1000;
    const pageIdx = getPageAtOrBefore(ms);
    goToPage(pageIdx);
    setCurrentPage(pageIdx);
    currentPageRef.current = pageIdx;
    if (isPlayingRef.current) {
      const frame = includedRef.current[pageIdx];
      if (frame) video.currentTime = frame.timestampMs / 1000;
      if (video.paused) {
        video.play()
          .then(() => {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = requestAnimationFrame(tick);
          })
          .catch(() => {});
      }
    }
  };

  function goToPage(idx: number) {
    setCurrentPage(idx);
    if (viewModeRef.current === "continuous") {
      pageRefs.current.get(idx)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function navigatePage(delta: number) {
    const step = viewMode === "two-page" ? 2 : 1;
    const newPage = Math.max(0, Math.min(included.length - 1, currentPage + delta * step));
    goToPage(newPage);
  }

  function tick() {
    const video = videoRef.current;
    if (!video) return;
    if (!scrubActiveRef.current) {
      const t = video.currentTime;
      const dur = video.duration || 0;
      setAudioProgress(dur > 0 ? (t / dur) * 100 : 0);
      setCurrentTimeSec(t);

      if (isPlayingRef.current && !video.paused) {
        const segEnd = getSegmentEnd(currentPageRef.current);
        if (t >= segEnd) {
          video.pause();
        }
      }
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }

  function playAudio() {
    const video = videoRef.current;
    if (!video || !selectedVideo) return;
    const frame = includedRef.current[currentPageRef.current];
    if (frame) video.currentTime = frame.timestampMs / 1000;
    video.playbackRate = playbackRate;

    video.play()
      .then(() => {
        setIsPlaying(true);
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(tick);
      })
      .catch((e) => console.warn("Audio playback failed:", e));
  }

  function stopAudio() {
    cancelAnimationFrame(animFrameRef.current);
    videoRef.current?.pause();
    setIsPlaying(false);
  }

  function startScrub(e: React.MouseEvent) {
    scrubActiveRef.current = true;
    setIsScrubbing(true);
    scrubHandlerRef.current(e.clientX);
    e.preventDefault();
  }

  function startSidebarResize(e: React.MouseEvent) {
    sidebarResizeRef.current = { x: e.clientX, w: sidebarWidth };
    e.preventDefault();
  }

  function getNearestFramePath(ms: number): string | null {
    if (frames.length === 0) return null;
    return frames.reduce((best, f) =>
      Math.abs(f.timestampMs - ms) < Math.abs(best.timestampMs - ms) ? f : best
    ).path;
  }

  async function savePdf() {
    if (!selectedVideo || included.length === 0) return;
    const savePath = await save({
      defaultPath: selectedVideo.filename.replace(/\.[^/.]+$/, "") + ".pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!savePath) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await buildPdf(included, savePath);
      const basePath = savePath.replace(/\.pdf$/i, "");
      await writeFrameLog(basePath, included, selectedVideo.path, selectedVideo.filename);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setIsSaving(false);
    }
  }

  if (!selectedVideo || included.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-2 text-sm">
        <p>No frames selected.</p>
        <button
          onClick={() => useStore.getState().setActiveTab("editframes")}
          className="text-indigo-400 hover:text-indigo-300 underline"
        >
          ← Go to Edit Frames
        </button>
      </div>
    );
  }

  const displayProgress = isScrubbing && scrubPercent !== null ? scrubPercent : audioProgress;
  const scrubMs =
    isScrubbing && scrubPercent !== null && videoDuration > 0
      ? (scrubPercent / 100) * videoDuration * 1000
      : null;
  const scrubThumbPath = scrubMs !== null ? getNearestFramePath(scrubMs) : null;
  const pageWidth = Math.round(BASE_PAGE_WIDTH * zoom);
  const halfPageWidth = Math.round(BASE_PAGE_WIDTH * 0.5 * zoom);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-900">
      {/* Hidden audio source */}
      <video
        ref={videoRef}
        src={convertFileSrc(selectedVideo.path)}
        preload="metadata"
        style={{ display: "none" }}
        onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
        onEnded={() => {
          cancelAnimationFrame(animFrameRef.current);
          setIsPlaying(false);
          setAudioProgress(100);
          setCurrentTimeSec(videoRef.current?.duration ?? videoDuration);
        }}
      />

      {/* Main area: sidebar + scrollable pages */}
      <div className="flex flex-1 overflow-hidden">
        {/* Thumbnail sidebar */}
        {sidebarOpen && (
          <div
            className="shrink-0 border-r border-gray-700 bg-gray-800 overflow-y-auto flex flex-col relative"
            style={{ width: sidebarWidth }}
          >
            <div className="px-2 py-2 border-b border-gray-700 text-xs text-gray-500 font-medium sticky top-0 bg-gray-800 z-10 flex items-center justify-between">
              <span>Pages</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-gray-500 hover:text-gray-300 text-lg leading-none"
                title="Close sidebar"
              >
                ×
              </button>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {included.map((f, idx) => (
                <button
                  key={f.index}
                  onClick={() => goToPage(idx)}
                  className={[
                    "relative rounded overflow-hidden border-2 transition-colors text-left",
                    currentPage === idx
                      ? "border-indigo-500"
                      : "border-transparent hover:border-gray-500",
                  ].join(" ")}
                >
                  <img
                    src={convertFileSrc(f.path)}
                    alt={`Page ${idx + 1}`}
                    className="w-full block"
                    loading="lazy"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-xs text-gray-300 py-0.5">
                    {idx + 1}
                  </div>
                </button>
              ))}
            </div>
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-500/50 transition-colors"
              onMouseDown={startSidebarResize}
            />
          </div>
        )}

        {/* Scrollable document */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto py-6"
          style={{ backgroundColor: "#525659" }}
        >
          {viewMode === "continuous" && (
            <div className="flex flex-col items-center gap-6 px-6">
              {included.map((frame, idx) => (
                <div
                  key={frame.index}
                  data-idx={idx}
                  ref={(el) => {
                    if (el) pageRefs.current.set(idx, el);
                    else pageRefs.current.delete(idx);
                  }}
                  className="relative shrink-0"
                  style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.55), 0 6px 30px rgba(0,0,0,0.4)" }}
                >
                  <div className="absolute -top-5 left-0 text-xs text-gray-400 select-none">
                    {idx + 1}
                  </div>
                  <img
                    src={convertFileSrc(frame.path)}
                    alt={`Page ${idx + 1}`}
                    style={{ width: pageWidth, maxWidth: "none", display: "block" }}
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}

          {viewMode === "single" && (
            <div className="flex flex-col items-center justify-center min-h-full px-6">
              {included[currentPage] && (
                <div
                  className="relative shrink-0"
                  style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.55), 0 6px 30px rgba(0,0,0,0.4)" }}
                >
                  <div className="absolute -top-5 left-0 text-xs text-gray-400 select-none">
                    {currentPage + 1}
                  </div>
                  <img
                    src={convertFileSrc(included[currentPage].path)}
                    alt={`Page ${currentPage + 1}`}
                    style={{ width: pageWidth, maxWidth: "none", display: "block" }}
                  />
                </div>
              )}
            </div>
          )}

          {viewMode === "two-page" && (
            <div className="flex flex-col items-center justify-center min-h-full px-6">
              <div className="flex items-start gap-6 shrink-0">
                {included[currentPage] && (
                  <div
                    className="relative"
                    style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.55), 0 6px 30px rgba(0,0,0,0.4)" }}
                  >
                    <div className="absolute -top-5 left-0 text-xs text-gray-400 select-none">
                      {currentPage + 1}
                    </div>
                    <img
                      src={convertFileSrc(included[currentPage].path)}
                      alt={`Page ${currentPage + 1}`}
                      style={{ width: halfPageWidth, maxWidth: "none", display: "block" }}
                    />
                  </div>
                )}
                {included[currentPage + 1] && (
                  <div
                    className="relative"
                    style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.55), 0 6px 30px rgba(0,0,0,0.4)" }}
                  >
                    <div className="absolute -top-5 left-0 text-xs text-gray-400 select-none">
                      {currentPage + 2}
                    </div>
                    <img
                      src={convertFileSrc(included[currentPage + 1].path)}
                      alt={`Page ${currentPage + 2}`}
                      style={{ width: halfPageWidth, maxWidth: "none", display: "block" }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Page navigation bar */}
      <div className="shrink-0 border-t border-gray-700 bg-gray-850 px-4 py-1.5 flex items-center gap-2" style={{ backgroundColor: "#1e2230" }}>
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-gray-200 text-xs border border-gray-600 rounded px-1.5 py-0.5 transition-colors shrink-0 mr-1"
            title="Show thumbnail sidebar"
          >
            ▤
          </button>
        )}

        {/* Prev / page indicator / Next */}
        <button
          onClick={() => navigatePage(-1)}
          disabled={currentPage === 0}
          className="text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors p-0.5"
          title="Previous page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-xs text-gray-300 tabular-nums min-w-[4rem] text-center select-none">
          {currentPage + 1} / {included.length}
        </span>
        <button
          onClick={() => navigatePage(1)}
          disabled={currentPage >= included.length - (viewMode === "two-page" ? 2 : 1)}
          className="text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors p-0.5"
          title="Next page"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <div className="w-px h-4 bg-gray-700 mx-1 shrink-0" />

        {/* View mode */}
        <div className="flex border border-gray-600 rounded overflow-hidden text-xs shrink-0">
          {([
            { id: "continuous" as const, label: "Continuous", short: "≡" },
            { id: "single" as const, label: "Single page", short: "□" },
            { id: "two-page" as const, label: "Two-page spread", short: "⬜⬜" },
          ]).map(({ id, label, short }) => (
            <button
              key={id}
              onClick={() => setViewMode(id)}
              title={label}
              className={[
                "px-2.5 py-1 transition-colors",
                viewMode === id
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-700 hover:text-gray-200",
              ].join(" ")}
            >
              {short}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-gray-700 mx-1 shrink-0" />

        {/* Zoom */}
        <select
          value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-indigo-500"
        >
          {ZOOM_LEVELS.map((z) => (
            <option key={z} value={z}>{Math.round(z * 100)}%</option>
          ))}
        </select>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-gray-700 bg-gray-800 px-4 py-2.5">
        {saveError && <p className="text-xs text-red-400 mb-1">{saveError}</p>}
        <div className="flex items-center gap-3">
          {/* Play / Pause */}
          <button
            onClick={isPlaying ? stopAudio : playAudio}
            className="w-8 h-8 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full text-white text-sm transition-colors shrink-0"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>

          <span className="text-xs text-gray-400 font-mono whitespace-nowrap shrink-0 tabular-nums">
            {formatHMS(currentTimeSec)}
          </span>

          {/* Progress bar */}
          <div
            ref={progressBarRef}
            className="relative flex-1 h-2 bg-gray-700 rounded-full cursor-pointer min-w-0 select-none"
            onMouseDown={startScrub}
          >
            <div
              className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full pointer-events-none"
              style={{ width: `${displayProgress}%` }}
            />

            {videoDuration > 0 &&
              included.map((f) => (
                <div
                  key={f.index}
                  className="absolute top-0 h-full w-px bg-white/30 pointer-events-none"
                  style={{ left: `${(f.timestampMs / 1000 / videoDuration) * 100}%` }}
                />
              ))}

            <div
              className="absolute top-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md pointer-events-none ring-2 ring-indigo-400"
              style={{
                left: `${displayProgress}%`,
                transform: "translate(-50%, -50%)",
              }}
            />

            {isScrubbing && scrubThumbPath && (
              <div
                className="absolute pointer-events-none z-30"
                style={{
                  left: `${displayProgress}%`,
                  bottom: "calc(100% + 12px)",
                  transform: "translateX(-50%)",
                }}
              >
                <img
                  src={convertFileSrc(scrubThumbPath)}
                  className="w-36 rounded shadow-2xl border border-gray-500"
                  alt="Preview"
                />
                <div className="text-center text-xs text-gray-300 mt-1 font-mono tabular-nums">
                  {formatHMS(scrubMs! / 1000)}
                </div>
              </div>
            )}
          </div>

          <span className="text-xs text-gray-400 font-mono whitespace-nowrap shrink-0 tabular-nums">
            {formatHMS(videoDuration)}
          </span>

          {/* Playback speed */}
          <div ref={speedMenuRef} className="relative shrink-0">
            <button
              onClick={() => setShowSpeedMenu((v) => !v)}
              className="text-xs text-gray-300 border border-gray-600 rounded px-2 py-1 hover:bg-gray-700 transition-colors whitespace-nowrap"
              title="Playback speed"
            >
              {playbackRate}×
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full mb-1 right-0 bg-gray-800 border border-gray-600 rounded shadow-xl overflow-hidden z-30">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setPlaybackRate(s); setShowSpeedMenu(false); }}
                    className={[
                      "block w-full px-4 py-1.5 text-xs text-left transition-colors whitespace-nowrap",
                      playbackRate === s
                        ? "bg-indigo-600 text-white"
                        : "text-gray-300 hover:bg-gray-700",
                    ].join(" ")}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Save as PDF */}
          <button
            onClick={savePdf}
            disabled={isSaving}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-xs rounded-lg transition-colors font-medium"
          >
            {isSaving ? (
              "Saving…"
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Save as PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
