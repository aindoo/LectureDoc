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

  // ── Open ldoc from file dialog ──────────────────────────────────

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

  // ── Open ldoc ───────────────────────────────────────────────────

  async function openVideo(video: import("../../types").VideoEntry) {
    if (opening) return;

    // Stale "extracting" — app was closed mid-extraction, restart it
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

  // ── Import flows ────────────────────────────────────────────────

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
    await startExtraction(
      ldocPath,
      video.path,
      preferences.extractionIntervalS,
      video.durationSecs,
    );
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

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-3 border-b border-gray-700 shrink-0">
        <button
          onClick={() => { setError(null); setStep({ kind: "choose_type" }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-md transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Import
        </button>
        <button
          onClick={openLdocFile}
          disabled={!!opening}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-600 hover:bg-gray-700 disabled:opacity-50 rounded-md transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
          Open
        </button>
        <div className="w-px h-5 bg-gray-700 mx-1" />
        <span className="text-xs text-gray-500">
          {videos.length} file{videos.length !== 1 ? "s" : ""}
        </span>
        {/* View style toggles */}
        <div className="ml-auto flex items-center border border-gray-700 rounded-md overflow-hidden">
          {([
            { id: "grid" as const, title: "Grid", icon: (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            )},
            { id: "list" as const, title: "List", icon: (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16"/>
              </svg>
            )},
            { id: "columns" as const, title: "Compact", icon: (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="4" height="4" rx="0.5"/><rect x="10" y="3" width="4" height="4" rx="0.5"/><rect x="17" y="3" width="4" height="4" rx="0.5"/>
                <rect x="3" y="10" width="4" height="4" rx="0.5"/><rect x="10" y="10" width="4" height="4" rx="0.5"/><rect x="17" y="10" width="4" height="4" rx="0.5"/>
                <rect x="3" y="17" width="4" height="4" rx="0.5"/><rect x="10" y="17" width="4" height="4" rx="0.5"/><rect x="17" y="17" width="4" height="4" rx="0.5"/>
              </svg>
            )},
            { id: "gallery" as const, title: "Gallery", icon: (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="9" height="9" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="12" y="14" width="9" height="9" rx="1"/>
              </svg>
            )},
          ]).map(({ id, title, icon }) => (
            <button
              key={id}
              onClick={() => setViewStyle(id)}
              title={title}
              className={[
                "px-2 py-1.5 transition-colors",
                viewStyle === id
                  ? "bg-indigo-600 text-white"
                  : "text-gray-400 hover:bg-gray-700 hover:text-gray-200",
              ].join(" ")}
            >
              {icon}
            </button>
          ))}
        </div>

        {activeJobCount > 0 && (
          <button
            onClick={() => setQueuePanelOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 border border-gray-600 hover:bg-gray-700 rounded-md transition-colors"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inset-0 rounded-full bg-indigo-400 opacity-75" />
              <span className="relative rounded-full h-2 w-2 bg-indigo-500" />
            </span>
            {activeJobCount} extracting
            <svg
              className={["w-3.5 h-3.5 transition-transform", queuePanelOpen ? "rotate-180" : ""].join(" ")}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm shrink-0">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* Import modal */}
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

      {/* Library grid */}
      {videos.length > 0 ? (
        <div className="flex-1 overflow-y-auto p-4">
          {viewStyle === "list" ? (
            <div className="flex flex-col gap-1">
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
              "grid gap-4",
              viewStyle === "grid" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              : viewStyle === "columns" ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5", // gallery
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
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <svg className="w-14 h-14 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <p className="text-sm">Import videos to create .ldoc files and get started.</p>
        </div>
      )}

      <FloatingQueuePanel open={queuePanelOpen} onClose={() => setQueuePanelOpen(false)} />
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
        "flex items-center gap-3 bg-gray-800 rounded-lg border border-gray-700 p-2 transition-colors group",
        canClick ? "hover:border-gray-500 cursor-pointer" : "cursor-default",
      ].join(" ")}
      onClick={() => canClick && onOpen(video)}
    >
      <div className="w-20 shrink-0 aspect-video bg-gray-900 rounded overflow-hidden relative">
        {video.thumbnailPath ? (
          <img src={convertFileSrc(video.thumbnailPath)} alt={video.filename}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}
        {isExtracting && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-700">
            <div className="h-full bg-blue-500" style={{ width: `${video.extractionProgress}%` }} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100 truncate">{video.filename}</p>
        <p className="text-xs text-gray-500 truncate">{video.ldocPath.split("/").pop()}</p>
      </div>
      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
        {formatDuration(video.durationSecs)}
        {video.width > 0 ? ` · ${video.width}×${video.height}` : ""}
      </span>
      <div className="shrink-0">
        <StatusBadge status={video.extractionStatus} progress={video.extractionProgress} />
      </div>
    </div>
  );
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
        "bg-gray-800 rounded-lg overflow-hidden border border-gray-700 transition-colors group",
        canClick ? "hover:border-gray-500 cursor-pointer" : "cursor-default",
      ].join(" ")}
      onClick={() => canClick && onOpen(video)}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-900 relative overflow-hidden">
        {video.thumbnailPath ? (
          <img src={convertFileSrc(video.thumbnailPath)} alt={video.filename}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-700">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}
        {isExtracting && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
            <div className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${video.extractionProgress}%` }} />
          </div>
        )}
        {canClick && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-sm font-medium">
              {opening ? "Loading…" : isStale ? "Resume" : "Open"}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-gray-100 truncate" title={video.filename}>
          {video.filename}
        </p>
        <div className="flex items-center justify-between mt-1.5 gap-1">
          <span className="text-xs text-gray-400 truncate">
            {formatDuration(video.durationSecs)}
            {video.width > 0 ? ` · ${video.width}×${video.height}` : ""}
          </span>
          <StatusBadge status={video.extractionStatus} progress={video.extractionProgress} />
        </div>
        <p className="text-xs text-gray-600 mt-1 truncate" title={video.ldocPath}>
          {video.ldocPath.split("/").pop()}
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status, progress }: { status: string; progress: number }) {
  if (status === "ready") return <span className="px-2 py-0.5 text-xs bg-green-900 text-green-300 rounded-full shrink-0">Ready</span>;
  if (status === "extracting") return <span className="px-2 py-0.5 text-xs bg-blue-900 text-blue-300 rounded-full shrink-0">Extracting {progress}%</span>;
  if (status === "hashing") return <span className="px-2 py-0.5 text-xs bg-purple-900 text-purple-300 rounded-full shrink-0">Indexing…</span>;
  if (status === "packing") return <span className="px-2 py-0.5 text-xs bg-orange-900 text-orange-300 rounded-full shrink-0">Packing…</span>;
  if (status === "queued") return <span className="px-2 py-0.5 text-xs bg-yellow-900 text-yellow-300 rounded-full shrink-0">Queued</span>;
  if (status === "error") return <span className="px-2 py-0.5 text-xs bg-red-900 text-red-300 rounded-full shrink-0">Error</span>;
  return null;
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
    <div className="mb-4 bg-gray-800 border border-gray-600 rounded-xl p-5 shrink-0 shadow-xl">
      {step.kind === "choose_type" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-200 mb-4">Import Videos</h3>
          <div className="flex gap-3">
            <button onClick={onPickSingle}
              className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-700 hover:bg-gray-600 rounded-lg border border-gray-600 transition-colors text-left">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              <span className="text-sm text-gray-200 font-medium">Single Video File</span>
              <span className="text-xs text-gray-400 text-center">Pick one video and choose where to save the .ldoc</span>
            </button>
            <button onClick={onPickDir}
              className="flex-1 flex flex-col items-center gap-2 p-4 bg-gray-700 hover:bg-gray-600 rounded-lg border border-gray-600 transition-colors text-left">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
              <span className="text-sm text-gray-200 font-medium">Entire Directory</span>
              <span className="text-xs text-gray-400 text-center">Import all videos from a folder at once</span>
            </button>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {step.kind === "single_confirm" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Import: {step.video.filename}</h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-400 mb-1">Duration · Resolution</p>
              <p className="text-sm text-gray-300">
                {formatDuration(step.video.durationSecs)}
                {step.video.width > 0 ? ` · ${step.video.width}×${step.video.height}` : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-1">Save .ldoc to</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs text-gray-300 bg-gray-900 px-2 py-1.5 rounded truncate" title={step.destLdoc}>
                  {step.destLdoc}
                </code>
                <button onClick={() => onChangeSingleDest(step.destLdoc)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
            <button onClick={onConfirmSingle} disabled={importing}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
              {importing ? "Starting…" : "Import"}
            </button>
          </div>
        </div>
      )}

      {step.kind === "dir_pick_dest" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-200 mb-3">
            Import {step.videos.length} video{step.videos.length !== 1 ? "s" : ""} from directory
          </h3>
          <div className="max-h-32 overflow-y-auto mb-3 space-y-1">
            {step.videos.map((v) => (
              <div key={v.path} className="flex items-center gap-2 text-xs text-gray-300">
                <span className="text-green-400">✓</span>
                <span className="truncate">{v.filename}</span>
                <span className="text-gray-500 shrink-0">{formatDuration(v.durationSecs)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mb-2">Save .ldoc files in:</p>
          <div className="space-y-2">
            <button onClick={() => onConfirmDirDest(true)}
              className="w-full text-left px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm text-gray-300 transition-colors">
              Same directory as the videos
            </button>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 bg-gray-900 rounded text-xs text-gray-400 truncate">
                {customDest || "Choose a folder…"}
              </div>
              <button onClick={onPickCustomDest}
                className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0">Browse</button>
              {customDest && (
                <button onClick={() => onConfirmDirDest(false)}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded transition-colors shrink-0">
                  Use this folder
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {step.kind === "dir_confirm" && (
        <div>
          <h3 className="text-sm font-semibold text-gray-200 mb-3">Ready to import</h3>
          <p className="text-xs text-gray-400 mb-1">
            {step.videos.length} video{step.videos.length !== 1 ? "s" : ""} →
            <code className="ml-1 text-gray-300">{step.destDir}</code>
          </p>
          <p className="text-xs text-gray-500">Extraction will run in the background. Monitor progress with the extraction indicator above.</p>
          <div className="mt-4 flex justify-end gap-3">
            <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-200">Cancel</button>
            <button onClick={onConfirmDirImport} disabled={importing}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm rounded transition-colors">
              {importing ? "Starting…" : `Import ${step.videos.length} Video${step.videos.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
