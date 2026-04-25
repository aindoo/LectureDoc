import { invoke } from "@tauri-apps/api/core";
import type { ManifestEntry, VideoEntry } from "../../types";
import { useStore } from "../../store";

/** Convert camelCase LdocMetadata (as returned by invoke) to a VideoEntry. */
export function ldocMetaToVideoEntry(ldocPath: string, raw: Record<string, unknown>): VideoEntry {
  const status = raw.status as string;
  return {
    ldocPath,
    frameCacheDir: "",
    filename: raw.videoFilename as string,
    path: raw.videoPath as string,
    durationSecs: (raw.durationSecs as number) ?? 0,
    fps: (raw.fps as number) ?? 0,
    width: (raw.width as number) ?? 0,
    height: (raw.height as number) ?? 0,
    extractionStatus: status === "extracting" ? "extracting"
      : status === "extracted" || status === "reviewed" ? "ready"
      : "idle",
    extractionProgress: status === "extracted" || status === "reviewed" ? 100 : 0,
    extractionPhase: "extracting",
    totalFrames: (raw.totalFrames as number) ?? 0,
    extractionIntervalS: (raw.extractionIntervalS as number) ?? 0.5,
    thumbnailPath: null,
    errorMsg: null,
  };
}

/** Load all recent ldoc entries from the app manifest into the store. */
export async function loadManifest() {
  const { setManifest, setVideos, setVideoThumbnail } = useStore.getState();

  const manifest = await invoke<{ version: number; recent: Array<Record<string, unknown>> }>(
    "get_app_manifest"
  );
  const entries: ManifestEntry[] = manifest.recent.map((e) => ({
    path: e.path as string,
    videoFilename: e.videoFilename as string,
    status: e.status as string,
    lastModifiedAt: e.lastModifiedAt as number,
  }));
  setManifest(entries);

  // Load full metadata for each entry
  const videos: VideoEntry[] = [];
  for (const entry of entries) {
    try {
      const raw = await invoke<Record<string, unknown>>("read_ldoc_metadata", {
        ldocPath: entry.path,
      });
      videos.push(ldocMetaToVideoEntry(entry.path, raw));
    } catch {
      // Broken entry — will be cleaned up by scan
    }
  }
  setVideos(videos);

  // Async thumbnail load (reads directly from zip, no full extraction needed)
  for (const video of videos) {
    if (video.extractionStatus === "ready") {
      invoke<string | null>("get_ldoc_thumbnail", { ldocPath: video.ldocPath })
        .then((p) => { if (p) setVideoThumbnail(video.ldocPath, p); })
        .catch(() => {});
    }
  }
}

/** Start extraction for a single video into a pre-chosen ldoc path. */
export async function startExtraction(
  ldocPath: string,
  videoPath: string,
  intervalS: number,
  durationSecs: number
) {
  const { upsertJob, upsertVideo, updateExtractionStatus } = useStore.getState();
  const videoFilename = videoPath.split("/").pop() ?? videoPath.split("\\").pop() ?? videoPath;

  // start_extraction returns the runtime cache dir
  const cacheDir = await invoke<string>("start_extraction", {
    ldocPath,
    videoPath,
    intervalS,
    durationSecs,
  });

  const entry: VideoEntry = {
    ldocPath,
    frameCacheDir: cacheDir,
    filename: videoFilename,
    path: videoPath,
    durationSecs,
    fps: 0, width: 0, height: 0,
    extractionStatus: "queued",
    extractionProgress: 0,
    extractionPhase: "extracting",
    totalFrames: Math.ceil(durationSecs / intervalS),
    extractionIntervalS: intervalS,
    thumbnailPath: null,
    errorMsg: null,
  };
  upsertVideo(entry);
  updateExtractionStatus(ldocPath, "queued", 0, "extracting");
  upsertJob({
    ldocPath,
    videoFilename,
    videoPath,
    progress: 0, frameCount: 0, totalFrames: Math.ceil(durationSecs / intervalS),
    status: "queued", phase: "extracting", startedAt: Date.now(),
  });
}
