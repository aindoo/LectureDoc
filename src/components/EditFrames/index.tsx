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
  const [previewWidth, setPreviewWidth] = useState(300);
  const [previewOpen, setPreviewOpen] = useState(true);

  const leftResizeRef = useRef<{ x: number; w: number } | null>(null);
  const previewResizeRef = useRef<{ x: number; w: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevVideoRef = useRef<string | null>(null);

  const activeTabRef = useRef<ActiveTab>(activeTab);
  activeTabRef.current = activeTab;
  const framesRef = useRef<FrameEntry[]>(frames);
  framesRef.current = frames;
  const previewFrameRef = useRef<FrameEntry | null>(previewFrame);
  previewFrameRef.current = previewFrame;

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (leftResizeRef.current) {
        const d = e.clientX - leftResizeRef.current.x;
        setLeftWidth(Math.max(180, Math.min(380, leftResizeRef.current.w + d)));
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

  useEffect(() => {
    if (!selectedVideo || selectedVideo.extractionStatus !== "ready") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => applySettings(), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [viewSettings.intervalS, viewSettings.diffThreshold]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-600">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
        </svg>
        <p className="text-sm text-zinc-600">Select a video from the Library tab</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-zinc-950">
      {/* Left settings panel */}
      <div
        className="shrink-0 flex flex-col bg-zinc-900 border-r border-zinc-800 overflow-y-auto"
        style={{ width: leftWidth }}
      >
        {/* Video info */}
        <div className="px-4 pt-4 pb-3 border-b border-zinc-800">
          <p className="text-sm font-medium text-zinc-100 truncate" title={selectedVideo.filename}>
            {selectedVideo.filename}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {selectedVideo.width > 0 ? `${selectedVideo.width}×${selectedVideo.height} · ` : ""}
            {Math.round(selectedVideo.durationSecs / 60)}m
          </p>
        </div>

        {/* Settings */}
        <div className="p-4 flex-1">
          <SettingsPanel />
        </div>

        {/* Status */}
        {loadingFrames && (
          <div className="px-4 py-2 border-t border-zinc-800">
            <p className="text-xs text-indigo-400 animate-pulse">Applying settings…</p>
          </div>
        )}

        {error && (
          <div className="mx-4 mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-2.5">
            {error}
          </div>
        )}

        {/* Actions */}
        {frames.length > 0 && (
          <div className="p-4 border-t border-zinc-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-500">{included.length} / {frames.length} selected</span>
              <span className="text-zinc-600">{frames.length - included.length} excluded</span>
            </div>
            <button
              onClick={previewDocument}
              disabled={included.length === 0}
              className="w-full py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              Preview Document
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Left resize handle */}
      <div
        className="w-px shrink-0 cursor-col-resize bg-zinc-800 hover:bg-indigo-500/60 transition-colors"
        onMouseDown={(e) => { leftResizeRef.current = { x: e.clientX, w: leftWidth }; e.preventDefault(); }}
      />

      {/* Middle frame gallery */}
      <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
        <FrameGallery
          onFrameSelect={(f) => setPreviewFrame(f)}
          selectedFrameIndex={previewFrame?.index ?? null}
        />
      </div>

      {/* Right resize handle — hidden when preview closed */}
      {previewOpen && (
        <div
          className="w-px shrink-0 cursor-col-resize bg-zinc-800 hover:bg-indigo-500/60 transition-colors"
          onMouseDown={(e) => { previewResizeRef.current = { x: e.clientX, w: previewWidth }; e.preventDefault(); }}
        />
      )}

      {/* Right preview panel */}
      {previewOpen ? (
        <div
          className="shrink-0 bg-zinc-900 border-l border-zinc-800"
          style={{ width: previewWidth }}
        >
          <FramePreviewPanel frame={previewFrame} onClose={() => setPreviewOpen(false)} />
        </div>
      ) : (
        <button
          onClick={() => setPreviewOpen(true)}
          className="shrink-0 w-8 border-l border-zinc-800 flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-900 transition-colors bg-zinc-950"
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
