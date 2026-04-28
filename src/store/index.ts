import { create } from "zustand";
import type {
  ActiveTab,
  ExtractionJob,
  ExtractionPhase,
  ExtractionStatus,
  FrameEntry,
  GlobalPreferences,
  ManifestEntry,
  VideoEntry,
} from "../types";

interface ViewSettings {
  intervalS: number;
  diffThreshold: number;
  ocrFidelity: "fast" | "balanced" | "accurate";
  diffMode: "rolling" | "continuous";
}

interface AppStore {
  // ── Navigation ──────────────────────────────────────────────────
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // ── Library ─────────────────────────────────────────────────────
  manifest: ManifestEntry[];
  videos: VideoEntry[];
  setManifest: (entries: ManifestEntry[]) => void;
  setVideos: (videos: VideoEntry[]) => void;
  upsertVideo: (video: VideoEntry) => void;
  updateExtractionStatus: (
    ldocPath: string,
    status: ExtractionStatus,
    progress?: number,
    phase?: ExtractionPhase,
    totalFrames?: number,
    errorMsg?: string
  ) => void;
  setVideoThumbnail: (ldocPath: string, thumbnailPath: string) => void;
  setVideoFrameCacheDir: (ldocPath: string, frameCacheDir: string) => void;

  // ── Queue ────────────────────────────────────────────────────────
  jobs: ExtractionJob[];
  upsertJob: (job: ExtractionJob) => void;
  removeJob: (ldocPath: string) => void;

  // ── View ─────────────────────────────────────────────────────────
  selectedVideo: VideoEntry | null;
  viewSettings: ViewSettings;
  frames: FrameEntry[];
  pdfPath: string | null;
  frameLogPath: string | null;
  isGeneratingPdf: boolean;

  selectVideo: (video: VideoEntry) => void;
  setViewSettings: (s: Partial<ViewSettings>) => void;
  setFrames: (frames: FrameEntry[]) => void;
  toggleFrameOverride: (index: number) => void;
  setPdfPath: (path: string | null, frameLogPath: string | null) => void;
  setIsGeneratingPdf: (v: boolean) => void;

  // ── OCR index ────────────────────────────────────────────────────
  ocrIndex: Record<number, string>;
  isOcrIndexing: boolean;
  ocrProgress: number;
  ocrTrigger: number;
  ocrAbortKey: number;
  setOcrIndex: (index: Record<number, string>) => void;
  setIsOcrIndexing: (v: boolean) => void;
  setOcrProgress: (n: number) => void;
  clearOcrIndex: () => void;
  triggerReocr: () => void;
  cancelOcr: () => void;

  // ── Preferences ──────────────────────────────────────────────────
  preferences: GlobalPreferences;
  preferencesOpen: boolean;
  setPreferences: (p: Partial<GlobalPreferences>) => void;
  setPreferencesOpen: (open: boolean) => void;
}

const DEFAULT_PREFS: GlobalPreferences = {
  extractionIntervalS: 0.5,
  diffThreshold: 15,
  ocrFidelity: "balanced",
};

export const useStore = create<AppStore>((set, get) => ({
  // ── Navigation ──────────────────────────────────────────────────
  activeTab: "library",
  setActiveTab: (tab) => set({ activeTab: tab }),

  // ── Library ─────────────────────────────────────────────────────
  manifest: [],
  videos: [],
  setManifest: (entries) => set({ manifest: entries }),
  setVideos: (videos) => set({ videos }),
  upsertVideo: (video) =>
    set((state) => {
      const idx = state.videos.findIndex((v) => v.ldocPath === video.ldocPath);
      if (idx >= 0) {
        const next = [...state.videos];
        next[idx] = video;
        return { videos: next };
      }
      return { videos: [...state.videos, video] };
    }),
  updateExtractionStatus: (ldocPath, status, progress, phase, totalFrames, errorMsg) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.ldocPath === ldocPath
          ? {
              ...v,
              extractionStatus: status,
              ...(progress !== undefined && { extractionProgress: progress }),
              ...(phase !== undefined && { extractionPhase: phase }),
              ...(totalFrames !== undefined && { totalFrames }),
              ...(errorMsg !== undefined && { errorMsg }),
            }
          : v
      ),
      jobs: state.jobs.map((j) =>
        j.ldocPath === ldocPath
          ? {
              ...j,
              status,
              ...(progress !== undefined && { progress }),
              ...(phase !== undefined && { phase }),
              ...(totalFrames !== undefined && { totalFrames }),
            }
          : j
      ),
    })),
  setVideoThumbnail: (ldocPath, thumbnailPath) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.ldocPath === ldocPath ? { ...v, thumbnailPath } : v
      ),
    })),
  setVideoFrameCacheDir: (ldocPath, frameCacheDir) =>
    set((state) => ({
      videos: state.videos.map((v) =>
        v.ldocPath === ldocPath ? { ...v, frameCacheDir } : v
      ),
    })),

  // ── Queue ────────────────────────────────────────────────────────
  jobs: [],
  upsertJob: (job) =>
    set((state) => {
      const idx = state.jobs.findIndex((j) => j.ldocPath === job.ldocPath);
      if (idx >= 0) {
        const next = [...state.jobs];
        next[idx] = job;
        return { jobs: next };
      }
      return { jobs: [...state.jobs, job] };
    }),
  removeJob: (ldocPath) =>
    set((state) => ({ jobs: state.jobs.filter((j) => j.ldocPath !== ldocPath) })),

  // ── View ─────────────────────────────────────────────────────────
  selectedVideo: null,
  viewSettings: {
    intervalS: DEFAULT_PREFS.extractionIntervalS,
    diffThreshold: DEFAULT_PREFS.diffThreshold,
    ocrFidelity: DEFAULT_PREFS.ocrFidelity,
    diffMode: "rolling" as const,
  },
  frames: [],
  pdfPath: null,
  frameLogPath: null,
  isGeneratingPdf: false,

  selectVideo: (video) => {
    const prefs = get().preferences;
    set({
      selectedVideo: video,
      activeTab: "editframes",
      frames: [],
      pdfPath: null,
      frameLogPath: null,
      ocrIndex: {},
      ocrProgress: 0,
      isOcrIndexing: false,
      viewSettings: {
        intervalS: video.extractionIntervalS,
        diffThreshold: prefs.diffThreshold,
        ocrFidelity: prefs.ocrFidelity,
        diffMode: get().viewSettings.diffMode,
      },
    });
  },
  setViewSettings: (s) =>
    set((state) => ({ viewSettings: { ...state.viewSettings, ...s } })),
  setFrames: (frames) => set({ frames }),
  toggleFrameOverride: (index) =>
    set((state) => ({
      frames: state.frames.map((f) => {
        if (f.index !== index) return f;
        const next =
          f.manualOverride === "exclude"
            ? null
            : f.manualOverride === "include"
            ? "exclude"
            : f.autoIncluded
            ? "exclude"
            : "include";
        return { ...f, manualOverride: next };
      }),
    })),
  setPdfPath: (path, frameLogPath) => set({ pdfPath: path, frameLogPath }),
  setIsGeneratingPdf: (v) => set({ isGeneratingPdf: v }),

  // ── OCR index ────────────────────────────────────────────────────
  ocrIndex: {},
  isOcrIndexing: false,
  ocrProgress: 0,
  ocrTrigger: 0,
  ocrAbortKey: 0,
  setOcrIndex: (index) => set({ ocrIndex: index }),
  setIsOcrIndexing: (v) => set({ isOcrIndexing: v }),
  setOcrProgress: (n) => set({ ocrProgress: n }),
  clearOcrIndex: () => set({ ocrIndex: {}, ocrProgress: 0, isOcrIndexing: false }),
  triggerReocr: () => set((s) => ({ ocrTrigger: s.ocrTrigger + 1 })),
  cancelOcr: () => set((s) => ({ ocrAbortKey: s.ocrAbortKey + 1, isOcrIndexing: false })),

  // ── Preferences ──────────────────────────────────────────────────
  preferences: DEFAULT_PREFS,
  preferencesOpen: false,
  setPreferences: (p) =>
    set((state) => ({ preferences: { ...state.preferences, ...p } })),
  setPreferencesOpen: (open) => set({ preferencesOpen: open }),
}));

// Computed helper — which frames are "included" in the PDF output
export function includedFrames(frames: FrameEntry[]): FrameEntry[] {
  return frames.filter((f) => {
    if (f.manualOverride === "include") return true;
    if (f.manualOverride === "exclude") return false;
    return f.autoIncluded;
  });
}

/** Build an LdocFrameSettings snapshot from the current store state. */
export function buildLdocFrameSettings(frames: FrameEntry[], viewSettings: { intervalS: number; diffThreshold: number }): import("../types").LdocFrameSettings {
  const overrides: Record<string, "include" | "exclude"> = {};
  for (const f of frames) {
    if (f.manualOverride === "include") overrides[String(f.index)] = "include";
    else if (f.manualOverride === "exclude") overrides[String(f.index)] = "exclude";
  }
  return {
    intervalS: viewSettings.intervalS,
    diffThreshold: viewSettings.diffThreshold,
    manualOverrides: overrides,
  };
}
