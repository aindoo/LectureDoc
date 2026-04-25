import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Library from "./components/Library";
import EditFrames from "./components/EditFrames";
import View from "./components/View";
import Preferences from "./components/Preferences";
import { useStore } from "./store";
import { loadManifest, startExtraction, ldocMetaToVideoEntry } from "./components/Library/actions";
import type { ActiveTab, ExtractionStatus, FrameEntry, LdocMetadata, VideoEntry, VideoMeta } from "./types";

const VIDEO_EXTS = new Set(["mp4","mov","mkv","avi","webm","m4v","mpg","mpeg","wmv","flv"]);

export default function App() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const preferencesOpen = useStore((s) => s.preferencesOpen);
  const setPreferencesOpen = useStore((s) => s.setPreferencesOpen);
  const {
    updateExtractionStatus, upsertJob, removeJob,
    setVideoThumbnail, setVideoFrameCacheDir, setViewSettings,
    selectVideo, setFrames, upsertVideo,
  } = useStore();

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // ── External-open routing ────────────────────────────────────────────────────

  const handleExternalOpen = useCallback(async (ldocPath: string) => {
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

      const existing = useStore.getState().videos.find((v) => v.ldocPath === ldocPath);
      const video: VideoEntry = existing
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
      } else if (result.metadata.status !== "extracting") {
        selectVideo(video);
      }
    } catch (e) {
      console.error("handleExternalOpen failed:", e);
    }
  }, [selectVideo, setViewSettings, setFrames, setVideoFrameCacheDir, setActiveTab, upsertVideo]);

  // ── Drag-and-drop handler ────────────────────────────────────────────────────

  const handleDrop = useCallback(async (paths: string[]) => {
    const preferences = useStore.getState().preferences;

    for (const path of paths) {
      const sep = path.includes("/") ? "/" : "\\";
      const ext = path.split(".").pop()?.toLowerCase() ?? "";

      if (ext === "ldoc") {
        await handleExternalOpen(path);
      } else if (VIDEO_EXTS.has(ext)) {
        try {
          const meta = await invoke<VideoMeta>("get_video_meta", { filePath: path });
          const dir = path.substring(0, path.lastIndexOf(sep) + 1);
          const stem = meta.filename.replace(/\.[^/.]+$/, "");
          const ldocPath = `${dir}${stem}.ldoc`;
          await startExtraction(ldocPath, path, preferences.extractionIntervalS, meta.durationSecs);
          await invoke("upsert_manifest_entry", {
            entry: {
              path: ldocPath,
              videoFilename: meta.filename,
              status: "extracting",
              lastModifiedAt: Date.now(),
            },
          });
          await loadManifest();
          setActiveTab("library");
        } catch (e) {
          console.error("Failed to import dropped video:", e);
        }
      } else {
        // Try as a directory
        try {
          const videos = await invoke<VideoMeta[]>("list_videos_in_dir", { folderPath: path });
          for (const video of videos) {
            const dir = video.path.substring(0, video.path.lastIndexOf(sep) + 1);
            const stem = video.filename.replace(/\.[^/.]+$/, "");
            const ldocPath = `${dir}${stem}.ldoc`;
            try {
              await startExtraction(ldocPath, video.path, preferences.extractionIntervalS, video.durationSecs);
              await invoke("upsert_manifest_entry", {
                entry: {
                  path: ldocPath,
                  videoFilename: video.filename,
                  status: "extracting",
                  lastModifiedAt: Date.now(),
                },
              });
            } catch (e) {
              console.error("Failed to import directory video:", e);
            }
          }
          if (videos.length > 0) {
            await loadManifest();
            setActiveTab("library");
          }
        } catch {
          // not a directory or no videos found
        }
      }
    }
  }, [handleExternalOpen, setActiveTab]);

  // On startup: scan manifest, load library, then consume any pending file-association open
  useEffect(() => {
    invoke("scan_app_manifest")
      .catch(() => {})
      .then(() => loadManifest())
      .catch(() => {})
      .then(() => invoke<string | null>("consume_pending_open"))
      .then((path) => { if (path) handleExternalOpen(path); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag-and-drop via Tauri window events
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    getCurrentWindow().onDragDropEvent((event) => {
      const type = event.payload.type;
      if (type === "enter") {
        dragCounterRef.current += 1;
        setIsDragging(true);
      } else if (type === "leave") {
        dragCounterRef.current -= 1;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setIsDragging(false);
        }
      } else if (type === "drop") {
        dragCounterRef.current = 0;
        setIsDragging(false);
        const paths = (event.payload as { type: string; paths: string[] }).paths ?? [];
        if (paths.length > 0) handleDrop(paths);
      }
    }).then((u) => { unlisten = u; });

    return () => { unlisten?.(); };
  }, [handleDrop]);

  // Subscribe to extraction events
  useEffect(() => {
    const unlisten: Array<() => void> = [];

    listen<{
      ldocPath: string;
      videoFilename: string;
      progress: number;
      frameCount: number;
      totalFrames: number;
      phase: "extracting" | "hashing" | "packing";
    }>("extraction:progress", ({ payload }) => {
      const status: ExtractionStatus =
        payload.phase === "hashing" ? "hashing"
        : payload.phase === "packing" ? "extracting"
        : "extracting";
      updateExtractionStatus(payload.ldocPath, status, payload.progress, payload.phase, payload.totalFrames);
      upsertJob({
        ldocPath: payload.ldocPath,
        videoFilename: payload.videoFilename,
        videoPath: "",
        progress: payload.progress,
        frameCount: payload.frameCount,
        totalFrames: payload.totalFrames,
        status,
        phase: payload.phase,
        startedAt: Date.now(),
      });
    }).then((u) => unlisten.push(u));

    listen<{ ldocPath: string; videoFilename: string; totalFrames: number; cacheDir: string }>(
      "extraction:complete",
      ({ payload }) => {
        updateExtractionStatus(payload.ldocPath, "ready", 100, "extracting", payload.totalFrames);
        if (payload.cacheDir) setVideoFrameCacheDir(payload.ldocPath, payload.cacheDir);
        invoke("upsert_manifest_entry", {
          entry: {
            path: payload.ldocPath,
            videoFilename: payload.videoFilename,
            status: "extracted",
            lastModifiedAt: Date.now(),
          },
        }).catch(() => {});
        invoke<string | null>("get_ldoc_thumbnail", { ldocPath: payload.ldocPath })
          .then((p) => { if (p) setVideoThumbnail(payload.ldocPath, p); })
          .catch(() => {});
        setTimeout(() => removeJob(payload.ldocPath), 3000);
      }
    ).then((u) => unlisten.push(u));

    listen<{ ldocPath: string; videoFilename: string; error: string }>(
      "extraction:error",
      ({ payload }) => {
        updateExtractionStatus(payload.ldocPath, "error", 0, undefined, undefined, payload.error);
        removeJob(payload.ldocPath);
      }
    ).then((u) => unlisten.push(u));

    listen<string>("open-ldoc-file", ({ payload }) => {
      handleExternalOpen(payload);
    }).then((u) => unlisten.push(u));

    return () => unlisten.forEach((u) => u());
  }, [handleExternalOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "library",
      label: "Library",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      id: "editframes",
      label: "Edit",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M4 6h16M4 12h16M4 18h7" />
        </svg>
      ),
    },
    {
      id: "view",
      label: "View",
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100">
      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-700 bg-gray-900 px-4 pt-2 shrink-0">
        <span className="text-sm font-semibold text-indigo-400 mr-6 select-none">
          Lecture Doc
        </span>
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "flex items-center gap-1.5 px-4 py-2 text-sm rounded-t-md transition-colors",
                activeTab === tab.id
                  ? "bg-gray-800 text-white border-b-2 border-indigo-500"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800",
              ].join(" ")}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setPreferencesOpen(true)}
            className="text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded hover:bg-gray-800 transition-colors"
            title="Preferences"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        <div className={activeTab === "library" ? "h-full" : "hidden h-full"}>
          <Library />
        </div>
        <div className={activeTab === "editframes" ? "h-full" : "hidden h-full"}>
          <EditFrames />
        </div>
        <div className={activeTab === "view" ? "h-full" : "hidden h-full"}>
          <View />
        </div>
      </div>

      {preferencesOpen && <Preferences />}

      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          style={{ backgroundColor: "rgba(79, 70, 229, 0.18)", backdropFilter: "blur(2px)" }}
        >
          <div className="bg-gray-900 border-2 border-dashed border-indigo-400 rounded-2xl px-14 py-10 text-center shadow-2xl">
            <svg className="w-10 h-10 text-indigo-400 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-base font-semibold text-white">Drop to import</p>
            <p className="text-sm text-gray-400 mt-1">Videos, folders, or .ldoc files</p>
          </div>
        </div>
      )}
    </div>
  );
}
