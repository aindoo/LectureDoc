import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore } from "../../store";
import { loadManifest, startExtraction, ldocMetaToVideoEntry } from "./actions";
import FloatingQueuePanel from "./FloatingQueuePanel";
import type { VideoMeta, LdocMetadata, FrameEntry } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(secs: number): string {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type ImportStep =
  | { kind: "idle" }
  | { kind: "choose_type" }
  | { kind: "single_confirm"; video: VideoMeta; destLdoc: string }
  | { kind: "dir_pick_dest"; videos: VideoMeta[]; srcDir: string }
  | { kind: "dir_confirm"; videos: VideoMeta[]; destDir: string; sameDir: boolean };

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, progress }: { status: string; progress: number }) {
  if (status === "ready") return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      Ready
    </span>
  );
  if (status === "extracting") return (
    <span className="text-xs text-blue-400 font-medium tabular-nums shrink-0">{progress}%</span>
  );
  if (status === "hashing") return (
    <span className="flex items-center gap-1.5 text-xs text-violet-400 font-medium shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse shrink-0" />
      Indexing
    </span>
  );
  if (status === "packing") return (
    <span className="flex items-center gap-1.5 text-xs text-orange-400 font-medium shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />
      Packing
    </span>
  );
  if (status === "queued") return (
    <span className="flex items-center gap-1.5 text-xs text-amber-400 font-medium shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
      Queued
    </span>
  );
  if (status === "error") return (
    <span className="flex items-center gap-1.5 text-xs text-red-400 font-medium shrink-0">
      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
      Error
    </span>
  );
  return null;
}

// ─── LdocCard ─────────────────────────────────────────────────────────────────

function LdocCard({ video, onOpen, opening, hasActiveJob }: {
  video: import("../../types").VideoEntry;
  onOpen: (v: import("../../types").VideoEntry) => void;
  opening: boolean;
  hasActiveJob: boolean;
}) {
  const isExtracting = video.extractionStatus === "extracting"
    || video.extractionStatus === "hashing"
    || video.extractionStatus === "queued";
  const isReady = video.extractionStatus === "ready";
  const isStale = isExtracting && !hasActiveJob;
  const canClick = (isReady || isStale) && !opening;

  return (
    <div
      className={[
        "bg-zinc-900 rounded-xl overflow-hidden ring-1 transition-all duration-150 group",
        canClick
          ? "ring-zinc-800 hover:ring-zinc-600 cursor-pointer hover:shadow-lg hover:shadow-black/20"
          : "ring-zinc-800 cursor-default",
      ].join(" ")}
      onClick={() => canClick && onOpen(video)}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-zinc-950 relative overflow-hidden">
        {video.thumbnailPath ? (
          <img
            src={convertFileSrc(video.thumbnailPath)}
            alt={video.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}

        {/* Progress bar */}
        {isExtracting && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-800">
            <div
              className="h-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${video.extractionProgress}%` }}
            />
          </div>
        )}

        {/* Open overlay */}
        {canClick && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <div className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {opening ? "Loading…" : isStale ? "Resume" : "Open"}
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-zinc-100 truncate leading-tight" title={video.filename}>
          {video.filename}
        </p>
        <div className="flex items-center justify-between mt-1.5 gap-1">
          <span className="text-xs text-zinc-500 truncate">
            {formatDuration(video.durationSecs)}
            {video.width > 0 ? ` · ${video.width}×${video.height}` : ""}
          </span>
          <StatusBadge status={video.extractionStatus} progress={video.extractionProgress} />
        </div>
      </div>
    </div>
  );
}

// ─── LdocListRow ─────────────────────────────────────────────────────────────

function LdocListRow({ video, onOpen, opening, hasActiveJob }: {
  video: import("../../types").VideoEntry;
  onOpen: (v: import("../../types").VideoEntry) => void;
  opening: boolean;
  hasActiveJob: boolean;
}) {
  const isExtracting = video.extractionStatus === "extracting"
    || video.extractionStatus === "hashing"
    || video.extractionStatus === "queued";
  const isReady = video.extractionStatus === "ready";
  const isStale = isExtracting && !hasActiveJob;
  const canClick = (isReady || isStale) && !opening;

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors group",
        canClick ? "hover:bg-zinc-800/60 cursor-pointer" : "cursor-default",
      ].join(" ")}
      onClick={() => canClick && onOpen(video)}
    >
      {/* Thumbnail */}
      <div className="w-16 shrink-0 aspect-video bg-zinc-900 rounded-lg overflow-hidden relative">
        {video.thumbnailPath ? (
          <img src={convertFileSrc(video.thumbnailPath)} alt={video.filename}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}
        {isExtracting && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-700">
            <div className="h-full bg-indigo-500" style={{ width: `${video.extractionProgress}%` }} />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100 truncate">{video.filename}</p>
        <p className="text-xs text-zinc-600 truncate mt-0.5">{video.ldocPath.split("/").pop()}</p>
      </div>

      <span className="text-xs text-zinc-500 whitespace-nowrap shrink-0 tabular-nums">
        {formatDuration(video.durationSecs)}
        {video.width > 0 ? ` · ${video.width}×${video.height}` : ""}
      </span>

      <div className="shrink-0 w-20 flex justify-end">
        <StatusBadge status={video.extractionStatus} progress={video.extractionProgress} />
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Library() {
  const videos = useStore((s) => s.videos);
  const preferences = useStore((s) => s.preferences);
  const jobs = useStore((s) => s.jobs);
  const selectVideo = useStore((s) => s.selectVideo);
  const setVideoFrameCacheDir = useStore((s) => s.setVideoFrameCacheDir);
  const upsertVideo = useStore((s) => s.upsertVideo);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setViewSettings = useStore((s) => s.setViewSettings);
  const setFrames = useStore((s) => s.setFrames);

  const [step, setStep] = useState<ImportStep>({ kind: "idle" });
  const [customDest, setCustomDest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);
  const [viewStyle, setViewStyle] = useState<"grid" | "list" | "columns" | "gallery">("grid");

  const activeJobCount = jobs.filter(
    (j) => j.status === "extracting" || j.status === "hashing" || j.status === "queued"
  ).length;

  useEffect(() => {
    if (activeJobCount === 0) setQueuePanelOpen(false);
  }, [activeJobCount]);

  async function openLdocFile() {
    if (opening) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Lecture Doc", extensions: ["ldoc"] }],
    });
    if (!selected || typeof selected !== "string") return;
    const ldocPath = selected;
    setOpening(ldocPath);
    setError(null);
    try {
      const result = await invoke<{
        cacheDir: string;
        metadata: LdocMetadata;
        frameLog: { version: number; pages: Array<{ page: number; timestampMs: number; frameFile: string }> } | null;
      }>("open_ldoc", { ldocPath });

      invoke("upsert_manifest_entry", {
        entry: {
          path: ldocPath,
          videoFilename: result.metadata.videoFilename,
          status: result.metadata.status,
          lastModifiedAt: Date.now(),
        },
      }).catch(() => {});
      await loadManifest();

      const existing = useStore.getState().videos.find((v) => v.ldocPath === ldocPath);
      const video = existing
        ? { ...existing, frameCacheDir: result.cacheDir }
        : {
            ...ldocMetaToVideoEntry(ldocPath, result.metadata as unknown as Record<string, unknown>),
            frameCacheDir: result.cacheDir,
          };

      setVideoFrameCacheDir(ldocPath, result.cacheDir);
      if (!existing) upsertVideo(video);

      if (result.frameLog) {
        const saved = result.metadata.frameSettings;
        selectVideo(video);
        setViewSettings({ intervalS: saved.intervalS, diffThreshold: saved.diffThreshold });
        setActiveTab("view");
        const entries: FrameEntry[] = result.frameLog.pages.map((p, i) => ({
          index: i,
          filename: p.frameFile,
          path: `${result.cacheDir}/frames/${p.frameFile}`,
          timestampMs: p.timestampMs,
          diffScore: 100,
          autoIncluded: true,
          manualOverride: null,
        }));
        setFrames(entries);
      } else {
        selectVideo(video);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setOpening(null);
    }
  }

  async function openVideo(video: import("../../types").VideoEntry) {
    if (opening) return;

    const isExtracting = video.extractionStatus === "extracting"
      || video.extractionStatus === "hashing"
      || video.extractionStatus === "queued";
    if (isExtracting) {
      const hasActive = jobs.some((j) => j.ldocPath === video.ldocPath);
      if (hasActive) return;
      setOpening(video.ldocPath);
      try {
        await startExtraction(video.ldocPath, video.path, video.extractionIntervalS, video.durationSecs);
        await invoke("upsert_manifest_entry", {
          entry: {
            path: video.ldocPath,
            videoFilename: video.filename,
            status: "extracting",
            lastModifiedAt: Date.now(),
          },
        });
      } catch (e) {
        setError(String(e));
      } finally {
        setOpening(null);
      }
      return;
    }

    setOpening(video.ldocPath);
    try {
      const result = await invoke<{
        cacheDir: string;
        metadata: LdocMetadata;
        frameLog: { version: number; pages: Array<{ page: number; timestampMs: number; frameFile: string }> } | null;
      }>("open_ldoc", { ldocPath: video.ldocPath });

      setVideoFrameCacheDir(video.ldocPath, result.cacheDir);
      const updatedVideo = { ...video, frameCacheDir: result.cacheDir };

      if (result.frameLog) {
        const saved = result.metadata.frameSettings;
        selectVideo(updatedVideo);
        setViewSettings({ intervalS: saved.intervalS, diffThreshold: saved.diffThreshold });
        setActiveTab("view");
        const entries: FrameEntry[] = result.frameLog.pages.map((p, i) => ({
          index: i,
          filename: p.frameFile,
          path: `${result.cacheDir}/frames/${p.frameFile}`,
          timestampMs: p.timestampMs,
          diffScore: 100,
          autoIncluded: true,
          manualOverride: null,
        }));
        setFrames(entries);
      } else {
        selectVideo(updatedVideo);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setOpening(null);
    }
  }

  async function pickSingleVideo() {
    const selected = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4","mov","mkv","avi","webm","m4v","mpg","mpeg","wmv","flv"] }] });
    if (!selected || typeof selected !== "string") return;
    try {
      const meta: VideoMeta = await invoke("get_video_meta", { filePath: selected });
      const stem = meta.filename.replace(/\.[^/.]+$/, "");
      const dir = selected.substring(0, selected.lastIndexOf("/") + 1) || selected.substring(0, selected.lastIndexOf("\\") + 1);
      const defaultLdoc = `${dir}${stem}.ldoc`;
      setStep({ kind: "single_confirm", video: meta, destLdoc: defaultLdoc });
    } catch (e) {
      setError(String(e));
    }
  }

  async function changeSingleDest(_current: string) {
    const dir = await open({ directory: true, multiple: false, title: "Choose folder to save .ldoc" });
    if (!dir || typeof dir !== "string") return;
    if (step.kind !== "single_confirm") return;
    const stem = step.video.filename.replace(/\.[^/.]+$/, "");
    setStep({ ...step, destLdoc: `${dir}/${stem}.ldoc` });
  }

  async function confirmSingleImport() {
    if (step.kind !== "single_confirm") return;
    setImporting(true);
    setError(null);
    try {
      await doImport(step.video, step.destLdoc);
      setStep({ kind: "idle" });
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function pickDirectory() {
    const dir = await open({ directory: true, multiple: false });
    if (!dir || typeof dir !== "string") return;
    try {
      const metas: VideoMeta[] = await invoke("list_videos_in_dir", { folderPath: dir });
      if (metas.length === 0) { setError("No video files found in that directory."); return; }
      setStep({ kind: "dir_pick_dest", videos: metas, srcDir: dir });
      setCustomDest("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function pickCustomDestDir() {
    const dir = await open({ directory: true, multiple: false, title: "Choose folder for .ldoc files" });
    if (dir && typeof dir === "string") setCustomDest(dir);
  }

  async function confirmDirImport(sameDir: boolean) {
    if (step.kind !== "dir_pick_dest") return;
    const destDir = sameDir ? step.srcDir : customDest;
    if (!destDir) { setError("Please choose a destination directory."); return; }
    setStep({ kind: "dir_confirm", videos: step.videos, destDir, sameDir });
  }

  async function doDirImport() {
    if (step.kind !== "dir_confirm") return;
    setImporting(true);
    setError(null);
    try {
      for (const video of step.videos) {
        const stem = video.filename.replace(/\.[^/.]+$/, "");
        const ldocPath = `${step.destDir}/${stem}.ldoc`;
        await doImport(video, ldocPath);
      }
      setStep({ kind: "idle" });
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function doImport(video: VideoMeta, ldocPath: string) {
    await startExtraction(ldocPath, video.path, preferences.extractionIntervalS, video.durationSecs);
    await invoke("upsert_manifest_entry", {
      entry: {
        path: ldocPath,
        videoFilename: video.filename,
        status: "extracting",
        lastModifiedAt: Date.now(),
      },
    });
    await loadManifest();
  }

  const viewStyleOptions = [
    {
      id: "grid" as const,
      title: "Grid",
      icon: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      ),
    },
    {
      id: "list" as const,
      title: "List",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      ),
    },
    {
      id: "columns" as const,
      title: "Compact",
      icon: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="4" height="4" rx="0.75" />
          <rect x="10" y="3" width="4" height="4" rx="0.75" />
          <rect x="17" y="3" width="4" height="4" rx="0.75" />
          <rect x="3" y="10" width="4" height="4" rx="0.75" />
          <rect x="10" y="10" width="4" height="4" rx="0.75" />
          <rect x="17" y="10" width="4" height="4" rx="0.75" />
          <rect x="3" y="17" width="4" height="4" rx="0.75" />
          <rect x="10" y="17" width="4" height="4" rx="0.75" />
          <rect x="17" y="17" width="4" height="4" rx="0.75" />
        </svg>
      ),
    },
    {
      id: "gallery" as const,
      title: "Gallery",
      icon: (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="9" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="12" y="13" width="9" height="8" rx="1.5" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-zinc-950">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">
        <button
          onClick={() => { setError(null); setStep({ kind: "choose_type" }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Import
        </button>
        <button
          onClick={openLdocFile}
          disabled={!!opening}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
          Open
        </button>

        <div className="w-px h-4 bg-zinc-800 mx-0.5 shrink-0" />

        <span className="text-xs text-zinc-600 tabular-nums">
          {videos.length} {videos.length !== 1 ? "files" : "file"}
        </span>

        {/* View style toggles */}
        <div className="ml-auto flex items-center bg-zinc-800 border border-zinc-700 rounded-lg p-0.5 gap-0.5">
          {viewStyleOptions.map(({ id, title, icon }) => (
            <button
              key={id}
              onClick={() => setViewStyle(id)}
              title={title}
              className={[
                "p-1.5 rounded-md transition-colors",
                viewStyle === id
                  ? "bg-zinc-600 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {icon}
            </button>
          ))}
        </div>

        {activeJobCount > 0 && (
          <button
            onClick={() => setQueuePanelOpen((v) => !v)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inset-0 rounded-full bg-indigo-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            <span className="text-xs font-medium tabular-nums">{activeJobCount} extracting</span>
            <svg
              className={["w-3 h-3 text-zinc-500 transition-transform", queuePanelOpen ? "rotate-180" : ""].join(" ")}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center justify-between shrink-0">
          <span>{error}</span>
          <button className="ml-3 text-red-500 hover:text-red-300 shrink-0" onClick={() => setError(null)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Import panel */}
      {step.kind !== "idle" && (
        <div className="px-4 pt-3 shrink-0">
          <ImportModal
            step={step}
            customDest={customDest}
            importing={importing}
            onPickSingle={pickSingleVideo}
            onPickDir={pickDirectory}
            onChangeSingleDest={changeSingleDest}
            onConfirmSingle={confirmSingleImport}
            onPickCustomDest={pickCustomDestDir}
            onConfirmDirDest={confirmDirImport}
            onConfirmDirImport={doDirImport}
            onCancel={() => { setStep({ kind: "idle" }); setError(null); }}
          />
        </div>
      )}

      {/* Library content */}
      {videos.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-4">
          {viewStyle === "list" ? (
            <div className="flex flex-col">
              {videos.map((v) => (
                <LdocListRow
                  key={v.ldocPath}
                  video={v}
                  onOpen={openVideo}
                  opening={opening === v.ldocPath}
                  hasActiveJob={jobs.some((j) => j.ldocPath === v.ldocPath)}
                />
              ))}
            </div>
          ) : (
            <div className={[
              "grid",
              viewStyle === "grid" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
              : viewStyle === "columns" ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5",
            ].join(" ")}>
              {videos.map((v) => (
                <LdocCard
                  key={v.ldocPath}
                  video={v}
                  onOpen={openVideo}
                  opening={opening === v.ldocPath}
                  hasActiveJob={jobs.some((j) => j.ldocPath === v.ldocPath)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-400">No files yet</p>
            <p className="text-xs text-zinc-600 mt-1">Import a video or drop one anywhere in the app</p>
          </div>
          <button
            onClick={() => { setError(null); setStep({ kind: "choose_type" }); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Import Video
          </button>
        </div>
      )}

      <FloatingQueuePanel open={queuePanelOpen} onClose={() => setQueuePanelOpen(false)} />
    </div>
  );
}

// ─── ImportModal ──────────────────────────────────────────────────────────────

function ImportModal({
  step, customDest, importing,
  onPickSingle, onPickDir, onChangeSingleDest, onConfirmSingle,
  onPickCustomDest, onConfirmDirDest, onConfirmDirImport, onCancel,
}: {
  step: ImportStep; customDest: string; importing: boolean;
  onPickSingle: () => void; onPickDir: () => void;
  onChangeSingleDest: (current: string) => void;
  onConfirmSingle: () => void;
  onPickCustomDest: () => void;
  onConfirmDirDest: (sameDir: boolean) => void;
  onConfirmDirImport: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-xl">
      {step.kind === "choose_type" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-100">Import Videos</h3>
            <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onPickSingle}
              className="flex flex-col items-start gap-3 p-4 bg-zinc-800/60 hover:bg-zinc-800 rounded-xl border border-zinc-700 hover:border-zinc-600 transition-all text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-600/10 border border-indigo-600/20 flex items-center justify-center group-hover:bg-indigo-600/20 transition-colors">
                <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Single Video</p>
                <p className="text-xs text-zinc-500 mt-0.5">Pick one video file</p>
              </div>
            </button>
            <button
              onClick={onPickDir}
              className="flex flex-col items-start gap-3 p-4 bg-zinc-800/60 hover:bg-zinc-800 rounded-xl border border-zinc-700 hover:border-zinc-600 transition-all text-left group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-600/10 border border-indigo-600/20 flex items-center justify-center group-hover:bg-indigo-600/20 transition-colors">
                <svg className="w-4.5 h-4.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Entire Folder</p>
                <p className="text-xs text-zinc-500 mt-0.5">Import all videos from a folder</p>
              </div>
            </button>
          </div>
        </div>
      )}

      {step.kind === "single_confirm" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-100">{step.video.filename}</h3>
            <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex gap-4 text-xs text-zinc-400">
              <span>{formatDuration(step.video.durationSecs)}</span>
              {step.video.width > 0 && <span>{step.video.width}×{step.video.height}</span>}
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">Save .ldoc to</p>
              <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                <code className="flex-1 text-xs text-zinc-300 truncate font-mono" title={step.destLdoc}>
                  {step.destLdoc}
                </code>
                <button
                  onClick={() => onChangeSingleDest(step.destLdoc)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 transition-colors"
                >
                  Change
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            <button
              onClick={onConfirmSingle}
              disabled={importing}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {importing ? "Starting…" : "Import"}
            </button>
          </div>
        </div>
      )}

      {step.kind === "dir_pick_dest" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-100">
              {step.videos.length} video{step.videos.length !== 1 ? "s" : ""} found
            </h3>
            <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="max-h-28 overflow-y-auto mb-4 space-y-1.5 bg-zinc-800/50 rounded-lg p-2">
            {step.videos.map((v) => (
              <div key={v.path} className="flex items-center gap-2 text-xs">
                <span className="text-emerald-500">✓</span>
                <span className="text-zinc-300 truncate flex-1">{v.filename}</span>
                <span className="text-zinc-600 shrink-0 tabular-nums">{formatDuration(v.durationSecs)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mb-2">Save .ldoc files to:</p>
          <div className="space-y-2">
            <button
              onClick={() => onConfirmDirDest(true)}
              className="w-full text-left px-3 py-2.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300 transition-colors"
            >
              Same folder as the videos
            </button>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-500 truncate font-mono">
                {customDest || "Choose a different folder…"}
              </div>
              <button
                onClick={onPickCustomDest}
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors shrink-0"
              >
                Browse
              </button>
              {customDest && (
                <button
                  onClick={() => onConfirmDirDest(false)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors shrink-0"
                >
                  Use folder
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {step.kind === "dir_confirm" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-100">Ready to import</h3>
            <button onClick={onCancel} className="text-zinc-600 hover:text-zinc-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="bg-zinc-800/50 rounded-lg px-3 py-2.5 text-xs text-zinc-400 mb-4">
            <span className="text-zinc-300 font-medium">{step.videos.length} video{step.videos.length !== 1 ? "s" : ""}</span>
            {" → "}
            <code className="text-zinc-400 font-mono">{step.destDir}</code>
          </div>
          <p className="text-xs text-zinc-600 mb-4">Extraction runs in the background. Monitor progress with the queue indicator.</p>
          <div className="flex justify-end gap-2">
            <button onClick={onCancel} className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
            <button
              onClick={onConfirmDirImport}
              disabled={importing}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {importing ? "Starting…" : `Import ${step.videos.length} Video${step.videos.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
