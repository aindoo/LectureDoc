import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore, includedFrames } from "../../store";
import { buildPdf } from "../../lib/pdfBuilder";
import { writeFrameLog } from "../../lib/frameLog";
import SearchPanel from "./SearchPanel";
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
const BASE_PAGE_WIDTH = 896;

type ViewMode = "continuous" | "single" | "two-page";
type ViewSource = "document" | "video";

export default function View() {
  const selectedVideo = useStore((s) => s.selectedVideo);
  const frames = useStore((s) => s.frames);
  const ocrIndex = useStore((s) => s.ocrIndex);
  const isOcrIndexing = useStore((s) => s.isOcrIndexing);
  const included = includedFrames(frames);

  // ── Page / display state ────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("continuous");
  const [viewSource, setViewSource] = useState<ViewSource>("document");
  const [zoom, setZoom] = useState(1.0);

  // ── Sidebar ─────────────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(160);

  // ── Search panel + query ─────────────────────────────────────────────────────
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchPanelWidth, setSearchPanelWidth] = useState(280);
  const [query, setQuery] = useState("");

  // ── Playback state ──────────────────────────────────────────────────────────
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

  // ── Refs ────────────────────────────────────────────────────────────────────
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const videoRef = useRef<HTMLVideoElement>(null);
  const animFrameRef = useRef(0);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const scrubActiveRef = useRef(false);
  const scrubHandlerRef = useRef<(clientX: number) => void>(() => {});
  const scrubEndHandlerRef = useRef<() => void>(() => {});
  const isPlayingRef = useRef(false);
  const sidebarResizeRef = useRef<{ x: number; w: number } | null>(null);
  const searchResizeRef = useRef<{ x: number; w: number } | null>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(0);
  const currentPageRef = useRef(0);
  const includedRef = useRef<FrameEntry[]>([]);
  const viewModeRef = useRef<ViewMode>("continuous");
  const viewSourceRef = useRef<ViewSource>("document");

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { includedRef.current = included; }, [included]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { viewSourceRef.current = viewSource; }, [viewSource]);

  // ── Auto-open search panel when user types a query ───────────────────────────
  useEffect(() => {
    if (query.trim()) setSearchPanelOpen(true);
  }, [query]);

  // ── Scroll → page indicator sync (continuous doc mode only) ─────────────────
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || viewMode !== "continuous" || viewSource !== "document" || included.length === 0) return;

    let rafId = 0;

    function onScroll() {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const mid = el!.scrollTop + el!.clientHeight / 2;
        let bestIdx = 0;
        let bestDist = Infinity;
        pageRefs.current.forEach((ref, idx) => {
          const d = Math.abs((ref.offsetTop + ref.offsetHeight / 2) - mid);
          if (d < bestDist) { bestDist = d; bestIdx = idx; }
        });
        setCurrentPage(bestIdx);
      });
    }

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId);
    };
  }, [viewMode, viewSource, included.length]);

  // ── Page changed → sync audio ───────────────────────────────────────────────
  useEffect(() => {
    if (prevPageRef.current === currentPage) return;
    prevPageRef.current = currentPage;
    const video = videoRef.current;
    const frame = included[currentPage];
    if (!video || !frame || !isPlayingRef.current) return;
    video.currentTime = frame.timestampMs / 1000;
    if (video.paused) {
      video.play()
        .then(() => { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = requestAnimationFrame(tick); })
        .catch((e) => console.warn("Auto-resume failed:", e));
    }
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // ── Global mouse handlers (resize + scrub) ──────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (scrubActiveRef.current) scrubHandlerRef.current(e.clientX);
      if (sidebarResizeRef.current) {
        const delta = e.clientX - sidebarResizeRef.current.x;
        setSidebarWidth(Math.max(80, Math.min(360, sidebarResizeRef.current.w + delta)));
      }
      if (searchResizeRef.current) {
        // Dragging left = wider panel
        const delta = searchResizeRef.current.x - e.clientX;
        setSearchPanelWidth(Math.max(220, Math.min(500, searchResizeRef.current.w + delta)));
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
      searchResizeRef.current = null;
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

  // ── Scrub handlers ───────────────────────────────────────────────────────────
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
          .then(() => { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = requestAnimationFrame(tick); })
          .catch(() => {});
      }
    }
  };

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

  // Navigate to a page AND seek audio — used by search results
  function navigateToPageWithSeek(pageIndex: number) {
    goToPage(pageIndex);
    const frame = included[pageIndex];
    if (frame && videoRef.current) {
      videoRef.current.currentTime = frame.timestampMs / 1000;
      const dur = videoRef.current.duration || 0;
      setAudioProgress(dur > 0 ? (frame.timestampMs / 1000 / dur) * 100 : 0);
      setCurrentTimeSec(frame.timestampMs / 1000);
    }
  }

  function handleViewSourceChange(newSource: ViewSource) {
    const video = videoRef.current;
    if (newSource === "video") {
      const frame = included[currentPage];
      if (frame && video) {
        video.currentTime = frame.timestampMs / 1000;
        const dur = video.duration || 0;
        setAudioProgress(dur > 0 ? (frame.timestampMs / 1000 / dur) * 100 : 0);
        setCurrentTimeSec(frame.timestampMs / 1000);
      }
    } else {
      if (video) {
        const pageIdx = getPageAtOrBefore(video.currentTime * 1000);
        // Set page state immediately so the navbar is correct right away,
        // then scroll after the next render so the video overlay is gone
        setCurrentPage(pageIdx);
        requestAnimationFrame(() => {
          pageRefs.current.get(pageIdx)?.scrollIntoView({ behavior: "instant", block: "start" });
        });
      }
    }
    setViewSource(newSource);
  }

  function tick() {
    const video = videoRef.current;
    if (!video) return;
    if (!scrubActiveRef.current) {
      const t = video.currentTime;
      const dur = video.duration || 0;
      setAudioProgress(dur > 0 ? (t / dur) * 100 : 0);
      setCurrentTimeSec(t);
      if (isPlayingRef.current && !video.paused && viewSourceRef.current === "document") {
        const segEnd = getSegmentEnd(currentPageRef.current);
        if (t >= segEnd) video.pause();
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
      const ocrData = Object.keys(ocrIndex).length > 0 ? ocrIndex : undefined;
      await buildPdf(included, savePath, ocrData);
      const basePath = savePath.replace(/\.pdf$/i, "");
      await writeFrameLog(basePath, included, selectedVideo.path, selectedVideo.filename);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setIsSaving(false);
    }
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!selectedVideo || included.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center bg-zinc-950">
        <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
          <svg className="w-7 h-7 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-medium text-zinc-400">No frames selected</p>
          <p className="text-xs text-zinc-600 mt-1">Go to Edit Frames to configure your document</p>
        </div>
        <button
          onClick={() => useStore.getState().setActiveTab("editframes")}
          className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Go to Edit Frames
        </button>
      </div>
    );
  }

  // ── Derived display values ───────────────────────────────────────────────────
  const displayProgress = isScrubbing && scrubPercent !== null ? scrubPercent : audioProgress;
  const scrubMs =
    isScrubbing && scrubPercent !== null && videoDuration > 0
      ? (scrubPercent / 100) * videoDuration * 1000
      : null;
  const scrubThumbPath = scrubMs !== null ? getNearestFramePath(scrubMs) : null;
  const pageWidth = Math.round(BASE_PAGE_WIDTH * zoom);
  const halfPageWidth = Math.round(BASE_PAGE_WIDTH * 0.5 * zoom);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">

      {/* ── Main row: sidebar + center column + search panel ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Thumbnail sidebar */}
        {sidebarOpen && (
          <div
            className="shrink-0 border-r border-zinc-800 bg-zinc-900 overflow-y-auto flex flex-col relative"
            style={{ width: sidebarWidth }}
          >
            <div className="px-3 py-2.5 border-b border-zinc-800 sticky top-0 bg-zinc-900/95 z-10 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Pages</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 p-2">
              {included.map((f, idx) => (
                <button
                  key={f.index}
                  onClick={() => goToPage(idx)}
                  className={[
                    "relative rounded-lg overflow-hidden ring-2 transition-all text-left",
                    currentPage === idx ? "ring-indigo-500" : "ring-transparent hover:ring-zinc-600",
                  ].join(" ")}
                >
                  <img
                    src={convertFileSrc(f.path)}
                    alt={`Page ${idx + 1}`}
                    className="w-full block"
                    loading="lazy"
                  />
                  <div className={[
                    "absolute bottom-0 left-0 right-0 py-0.5 text-center text-xs font-medium",
                    currentPage === idx ? "bg-indigo-500/80 text-white" : "bg-black/60 text-zinc-400",
                  ].join(" ")}>
                    {idx + 1}
                  </div>
                </button>
              ))}
            </div>
            <div
              className="absolute top-0 right-0 w-px h-full cursor-col-resize hover:bg-indigo-500/60 transition-colors bg-transparent"
              onMouseDown={(e) => { sidebarResizeRef.current = { x: e.clientX, w: sidebarWidth }; e.preventDefault(); }}
            />
          </div>
        )}

        {/* ── Center column: nav bar + content ── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Navigation bar — top of center column ── */}
          <div className="shrink-0 border-b border-zinc-800 bg-zinc-900 flex items-center h-10 px-2 gap-1">

            {/* Left: Doc/Video toggle */}
            <div className="flex items-center bg-zinc-800 rounded-md p-0.5 gap-0.5 shrink-0">
              <button
                onClick={() => handleViewSourceChange("document")}
                title="Document view"
                className={[
                  "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                  viewSource === "document" ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Doc
              </button>
              <button
                onClick={() => handleViewSourceChange("video")}
                title="Video view"
                className={[
                  "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
                  viewSource === "video" ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
                ].join(" ")}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
                Video
              </button>
            </div>

            <div className="w-px h-4 bg-zinc-800 mx-0.5 shrink-0" />

            {/* Sidebar toggle (only when closed) */}
            {!sidebarOpen && (
              <>
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors shrink-0"
                  title="Show thumbnail sidebar"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                      d="M4 6h16M4 12h10M4 18h16" />
                  </svg>
                </button>
                <div className="w-px h-4 bg-zinc-800 shrink-0" />
              </>
            )}

            {/* ── Centered controls ── */}
            <div className="flex-1 flex items-center justify-center gap-1.5">
              {/* Prev */}
              <button
                onClick={() => navigatePage(-1)}
                disabled={currentPage === 0}
                className="p-1.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-25 transition-colors rounded-md hover:bg-zinc-800"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>

              <span className="text-xs text-zinc-400 tabular-nums font-medium min-w-[3.5rem] text-center select-none">
                {currentPage + 1} / {included.length}
              </span>

              <button
                onClick={() => navigatePage(1)}
                disabled={currentPage >= included.length - (viewMode === "two-page" ? 2 : 1)}
                className="p-1.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-25 transition-colors rounded-md hover:bg-zinc-800"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <div className="w-px h-4 bg-zinc-800 mx-0.5 shrink-0" />

              {/* View mode */}
              <div className="flex items-center bg-zinc-800 rounded-md p-0.5 gap-0.5 shrink-0">
                {([
                  { id: "continuous" as const, label: "Continuous",
                    icon: (<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>) },
                  { id: "single" as const, label: "Single page",
                    icon: (<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="1.5" strokeWidth={1.75} /></svg>) },
                  { id: "two-page" as const, label: "Two-page spread",
                    icon: (<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="3" width="9" height="18" rx="1.5" strokeWidth={1.75} /><rect x="13" y="3" width="9" height="18" rx="1.5" strokeWidth={1.75} /></svg>) },
                ] as const).map(({ id, label, icon }) => (
                  <button key={id} onClick={() => setViewMode(id)} title={label} disabled={viewSource === "video"}
                    className={["p-1.5 rounded transition-colors disabled:opacity-30",
                      viewMode === id && viewSource === "document" ? "bg-zinc-600 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"].join(" ")}
                  >{icon}</button>
                ))}
              </div>

              <div className="w-px h-4 bg-zinc-800 mx-0.5 shrink-0" />

              {/* Zoom */}
              <select value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))}
                disabled={viewSource === "video"}
                className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-md px-2 py-1 focus:outline-none focus:border-indigo-500 disabled:opacity-30 shrink-0"
              >
                {ZOOM_LEVELS.map((z) => (
                  <option key={z} value={z}>{Math.round(z * 100)}%</option>
                ))}
              </select>
            </div>

            {/* ── Right: search input ── */}
            <div className="relative shrink-0 flex items-center">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-zinc-500"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search slides…"
                className={[
                  "pl-7 py-1 text-xs bg-zinc-800 border text-zinc-200 placeholder:text-zinc-600 rounded-lg focus:outline-none focus:border-indigo-500 transition-colors",
                  query ? "pr-6" : "pr-2.5",
                  isOcrIndexing ? "border-indigo-500/50" : "border-zinc-700",
                ].join(" ")}
                style={{ width: 168 }}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Content area: relative wrapper so video can be an absolute overlay */}
          <div className="flex-1 relative overflow-hidden">

            {/* Video element — outside scroll container so WebKit fires onLoadedMetadata reliably.
                In video mode: absolute overlay covering the full area.
                In document mode: hidden (display:none) but stays mounted to preserve duration. */}
            <video
              ref={videoRef}
              src={convertFileSrc(selectedVideo.path)}
              preload="metadata"
              onLoadedMetadata={() => setVideoDuration(videoRef.current?.duration ?? 0)}
              onEnded={() => {
                cancelAnimationFrame(animFrameRef.current);
                setIsPlaying(false);
                setAudioProgress(100);
                setCurrentTimeSec(videoRef.current?.duration ?? videoDuration);
              }}
              style={viewSource === "video"
                ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", backgroundColor: "#000", zIndex: 10 }
                : { display: "none", position: "absolute" }}
            />

            {/* Scroll area — absolute inset-0, always in DOM to preserve scroll position */}
            <div
              ref={scrollContainerRef}
              className="absolute inset-0 overflow-auto"
              style={{ backgroundColor: "#404040" }}
            >
              {viewMode === "continuous" && (
                <div className="flex flex-col items-center gap-8 px-8 py-8">
                  {included.map((frame, idx) => (
                    <div
                      key={frame.index}
                      data-idx={idx}
                      ref={(el) => {
                        if (el) pageRefs.current.set(idx, el);
                        else pageRefs.current.delete(idx);
                      }}
                      className="relative shrink-0"
                      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.4)" }}
                    >
                      <div className="absolute -top-6 left-0 text-xs text-white/40 select-none font-medium tabular-nums">
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
                <div className="flex flex-col items-center justify-center min-h-full px-8 py-8">
                  {included[currentPage] && (
                    <div
                      className="relative shrink-0"
                      style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.4)" }}
                    >
                      <div className="absolute -top-6 left-0 text-xs text-white/40 select-none font-medium tabular-nums">
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
                <div className="flex flex-col items-center justify-center min-h-full px-8 py-8">
                  <div className="flex items-start gap-8 shrink-0">
                    {included[currentPage] && (
                      <div
                        className="relative"
                        style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.4)" }}
                      >
                        <div className="absolute -top-6 left-0 text-xs text-white/40 select-none font-medium tabular-nums">
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
                        style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.6), 0 8px 40px rgba(0,0,0,0.4)" }}
                      >
                        <div className="absolute -top-6 left-0 text-xs text-white/40 select-none font-medium tabular-nums">
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

        </div>
        {/* ── End center column ── */}

        {/* Search panel resize handle */}
        {searchPanelOpen && (
          <div
            className="w-px shrink-0 cursor-col-resize bg-zinc-800 hover:bg-indigo-500/60 transition-colors"
            onMouseDown={(e) => { searchResizeRef.current = { x: e.clientX, w: searchPanelWidth }; e.preventDefault(); }}
          />
        )}

        {/* Search panel */}
        {searchPanelOpen && (
          <div className="shrink-0" style={{ width: searchPanelWidth }}>
            <SearchPanel
              query={query}
              onNavigate={navigateToPageWithSeek}
            />
          </div>
        )}
      </div>
      {/* ── End main row ── */}

      {/* ── Bottom playback bar — full width ── */}
      <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
        {saveError && <p className="text-xs text-red-400 mb-2">{saveError}</p>}
        <div className="flex items-center gap-3">
          {/* Play / Pause */}
          <button
            onClick={isPlaying ? stopAudio : playAudio}
            className="w-8 h-8 shrink-0 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full text-white transition-colors"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <span className="text-xs text-zinc-500 font-mono tabular-nums whitespace-nowrap shrink-0">
            {formatHMS(currentTimeSec)}
          </span>

          {/* Progress / scrub bar */}
          <div
            ref={progressBarRef}
            className="relative flex-1 h-1.5 bg-zinc-800 rounded-full cursor-pointer min-w-0 select-none group"
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
                  className="absolute top-0 h-full w-px bg-zinc-600 pointer-events-none"
                  style={{ left: `${(f.timestampMs / 1000 / videoDuration) * 100}%` }}
                />
              ))}
            <div
              className="absolute top-1/2 w-3 h-3 bg-white rounded-full shadow-md pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                left: `${displayProgress}%`,
                transform: "translate(-50%, -50%)",
                boxShadow: "0 0 0 2px rgba(99,102,241,0.6)",
              }}
            />
            {isScrubbing && scrubThumbPath && (
              <div
                className="absolute pointer-events-none z-30"
                style={{
                  left: `${displayProgress}%`,
                  bottom: "calc(100% + 10px)",
                  transform: "translateX(-50%)",
                }}
              >
                <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden shadow-2xl">
                  <img src={convertFileSrc(scrubThumbPath)} className="w-36 block" alt="Preview" />
                  <div className="py-1 text-center text-xs text-zinc-400 font-mono tabular-nums">
                    {formatHMS(scrubMs! / 1000)}
                  </div>
                </div>
              </div>
            )}
          </div>

          <span className="text-xs text-zinc-500 font-mono tabular-nums whitespace-nowrap shrink-0">
            {formatHMS(videoDuration)}
          </span>

          {/* Playback speed */}
          <div ref={speedMenuRef} className="relative shrink-0">
            <button
              onClick={() => setShowSpeedMenu((v) => !v)}
              className="text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-md px-2 py-1 transition-colors tabular-nums"
            >
              {playbackRate}×
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-full mb-1.5 right-0 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden z-30 py-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => { setPlaybackRate(s); setShowSpeedMenu(false); }}
                    className={[
                      "flex items-center gap-2 w-full px-4 py-1.5 text-xs transition-colors",
                      playbackRate === s
                        ? "text-indigo-400 bg-indigo-600/10"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
                    ].join(" ")}
                  >
                    <span className="w-3 shrink-0">
                      {playbackRate === s && (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                      )}
                    </span>
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Export PDF */}
          <button
            onClick={savePdf}
            disabled={isSaving}
            className="shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {isSaving ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
