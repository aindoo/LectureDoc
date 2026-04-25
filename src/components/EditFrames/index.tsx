import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import SettingsPanel from "../View/SettingsPanel";
import FrameGallery from "../View/FrameGallery";
import FramePreviewPanel from "./FramePreviewPanel";
import { useStore, includedFrames, buildLdocFrameSettings } from "../../store";
import { buildFrameEntries } from "../../lib/frameFilter";
import type { ActiveTab, FrameEntry, FrameInfo } from "../../types";

export default function EditFrames() {
  const selectedVideo = useStore((s) => s.selectedVideo);
  const frames = useStore((s) => s.frames);
  const viewSettings = useStore((s) => s.viewSettings);
  const activeTab = useStore((s) => s.activeTab);
  const setFrames = useStore((s) => s.setFrames);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const toggleFrameOverride = useStore((s) => s.toggleFrameOverride);

  const [loadingFrames, setLoadingFrames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewFrame, setPreviewFrame] = useState<FrameEntry | null>(null);
  const [leftWidth, setLeftWidth] = useState(240);
  const [previewWidth, setPreviewWidth] = useState(320);
  const [previewOpen, setPreviewOpen] = useState(true);

  const leftResizeRef = useRef<{ x: number; w: number } | null>(null);
  const previewResizeRef = useRef<{ x: number; w: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevVideoRef = useRef<string | null>(null);

  // Refs for keyboard handler (always current, no stale closure)
  const activeTabRef = useRef<ActiveTab>(activeTab);
  activeTabRef.current = activeTab;
  const framesRef = useRef<FrameEntry[]>(frames);
  framesRef.current = frames;
  const previewFrameRef = useRef<FrameEntry | null>(previewFrame);
  previewFrameRef.current = previewFrame;

  // Global resize mouse handlers
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (leftResizeRef.current) {
        const d = e.clientX - leftResizeRef.current.x;
        setLeftWidth(Math.max(160, Math.min(360, leftResizeRef.current.w + d)));
      }
      if (previewResizeRef.current) {
        const d = e.clientX - previewResizeRef.current.x;
        setPreviewWidth(Math.max(200, Math.min(560, previewResizeRef.current.w - d)));
      }
    }
    function onMouseUp() {
      leftResizeRef.current = null;
      previewResizeRef.current = null;
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Keyboard shortcuts (←/→ navigate preview, Space toggle)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (activeTabRef.current !== "editframes") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const currentFrames = framesRef.current;
      const current = previewFrameRef.current;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (currentFrames.length === 0) return;
        const idx = current ? currentFrames.findIndex((f) => f.index === current.index) : 0;
        const prev = currentFrames[Math.max(0, idx - 1)];
        if (prev) setPreviewFrame(prev);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (currentFrames.length === 0) return;
        const idx = current ? currentFrames.findIndex((f) => f.index === current.index) : -1;
        const next = currentFrames[Math.min(currentFrames.length - 1, idx + 1)];
        if (next) setPreviewFrame(next);
      } else if (e.key === " ") {
        e.preventDefault();
        if (!current) return;
        toggleFrameOverride(current.index);
        const { frames: liveFrames, viewSettings: liveSettings, selectedVideo: liveVideo } = useStore.getState();
        if (liveVideo) {
          const settings = buildLdocFrameSettings(liveFrames, liveSettings);
          invoke("save_ldoc_settings", {
            ldocPath: liveVideo.ldocPath,
            frameSettings: settings,
            status: "extracted",
          }).catch(() => {});
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function applySettings() {
    if (!selectedVideo) return;
    if (selectedVideo.extractionStatus !== "ready") {
      setError("Video frames have not been extracted yet.");
      return;
    }
    setLoadingFrames(true);
    setError(null);
    try {
      const frameDir = `${selectedVideo.frameCacheDir}/frames`;
      const allFrames: FrameInfo[] = await invoke("list_frame_files", {
        frameDir,
        intervalS: selectedVideo.extractionIntervalS,
      });
      const entries = await buildFrameEntries(
        frameDir,
        allFrames,
        viewSettings.intervalS,
        selectedVideo.extractionIntervalS,
        viewSettings.diffThreshold,
        viewSettings.diffMode
      );
      setFrames(entries);
      const settings = buildLdocFrameSettings(entries, viewSettings);
      await invoke("save_ldoc_settings", {
        ldocPath: selectedVideo.ldocPath,
        frameSettings: settings,
        status: "extracted",
      }).catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingFrames(false);
    }
  }

  // Debounce auto-apply when settings change
  useEffect(() => {
    if (!selectedVideo || selectedVideo.extractionStatus !== "ready") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applySettings(), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [viewSettings.intervalS, viewSettings.diffThreshold]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial apply when video changes
  useEffect(() => {
    if (!selectedVideo || selectedVideo.extractionStatus !== "ready") return;
    if (prevVideoRef.current === selectedVideo.ldocPath) return;
    prevVideoRef.current = selectedVideo.ldocPath;
    applySettings();
  }, [selectedVideo?.ldocPath, selectedVideo?.extractionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  async function previewDocument() {
    if (!selectedVideo) return;
    const inc: FrameEntry[] = includedFrames(frames);
    const settings = buildLdocFrameSettings(frames, viewSettings);
    const pages = inc.map((f, i) => ({
      page: i + 1,
      timestampMs: f.timestampMs,
      frameFile: f.filename,
    }));
    await invoke("save_ldoc_frame_log", {
      ldocPath: selectedVideo.ldocPath,
      pages,
      frameSettings: settings,
    }).catch(() => {});
    await invoke("upsert_manifest_entry", {
      entry: {
        path: selectedVideo.ldocPath,
        videoFilename: selectedVideo.filename,
        status: "reviewed",
        lastModifiedAt: Date.now(),
      },
    }).catch(() => {});
    setActiveTab("view");
  }

  const included = includedFrames(frames);

  if (!selectedVideo) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        Select a video from the Library tab.
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left settings panel */}
      <div
        className="shrink-0 flex flex-col border-r border-gray-700 p-4 gap-4 overflow-y-auto"
        style={{ width: leftWidth }}
      >
        <div>
          <p className="text-sm font-medium text-gray-200 truncate" title={selectedVideo.filename}>
            {selectedVideo.filename}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {selectedVideo.width}×{selectedVideo.height} ·{" "}
            {Math.round(selectedVideo.durationSecs / 60)}m
          </p>
          <p className="text-xs text-gray-600 mt-0.5 truncate" title={selectedVideo.ldocPath}>
            {selectedVideo.ldocPath.split("/").pop()}
          </p>
        </div>

        <SettingsPanel />

        {loadingFrames && (
          <p className="text-xs text-indigo-400 animate-pulse">Applying…</p>
        )}

        {frames.length > 0 && (
          <div className="border-t border-gray-700 pt-4 space-y-2">
            <p className="text-xs text-gray-400">
              {included.length} / {frames.length} frames selected
            </p>
            <button
              onClick={previewDocument}
              disabled={included.length === 0}
              className="w-full py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              Preview Document →
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 border border-red-800 rounded p-2">
            {error}
          </div>
        )}
      </div>

      {/* Left resize handle */}
      <div
        className="w-1 shrink-0 cursor-col-resize hover:bg-indigo-500/40 transition-colors"
        onMouseDown={(e) => { leftResizeRef.current = { x: e.clientX, w: leftWidth }; e.preventDefault(); }}
      />

      {/* Middle frame gallery */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FrameGallery
          onFrameSelect={(f) => setPreviewFrame(f)}
          selectedFrameIndex={previewFrame?.index ?? null}
        />
      </div>

      {/* Right resize handle — hidden when preview closed */}
      {previewOpen && (
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-indigo-500/40 transition-colors"
          onMouseDown={(e) => { previewResizeRef.current = { x: e.clientX, w: previewWidth }; e.preventDefault(); }}
        />
      )}

      {/* Right preview panel */}
      {previewOpen ? (
        <div
          className="shrink-0 border-l border-gray-700"
          style={{ width: previewWidth }}
        >
          <FramePreviewPanel frame={previewFrame} onClose={() => setPreviewOpen(false)} />
        </div>
      ) : (
        <button
          onClick={() => setPreviewOpen(true)}
          className="shrink-0 w-7 border-l border-gray-700 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors"
          title="Show preview panel"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
    </div>
  );
}
