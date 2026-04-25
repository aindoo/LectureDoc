export type ExtractionStatus =
  | "idle"
  | "queued"
  | "extracting"
  | "hashing"
  | "ready"
  | "error";

export type ExtractionPhase = "extracting" | "hashing" | "packing";

export interface VideoMeta {
  filename: string;
  path: string;
  durationSecs: number;
  fps: number;
  width: number;
  height: number;
}

/** A video as it appears in the Library — backed by an ldoc zip file on disk. */
export interface VideoEntry extends VideoMeta {
  ldocPath: string;               // absolute path to the .ldoc zip file
  frameCacheDir: string;          // runtime cache dir; empty until open_ldoc is called
  extractionStatus: ExtractionStatus;
  extractionProgress: number;
  extractionPhase: ExtractionPhase;
  totalFrames: number;
  extractionIntervalS: number;
  thumbnailPath: string | null;
  errorMsg: string | null;
}

// ─── Ldoc types ──────────────────────────────────────────────────────────────

export type LdocStatus = "extracting" | "extracted" | "reviewed";

export interface LdocFrameSettings {
  intervalS: number;
  diffThreshold: number;
  manualOverrides: Record<string, "include" | "exclude">;
  diffMode?: "rolling" | "continuous";
}

export interface LdocMetadata {
  version: number;
  videoFilename: string;
  videoPath: string;
  durationSecs: number;
  width: number;
  height: number;
  fps: number;
  extractionIntervalS: number;
  totalFrames: number;
  status: LdocStatus;
  createdAt: number;       // unix ms
  lastModifiedAt: number;  // unix ms
  frameSettings: LdocFrameSettings;
}

export interface ManifestEntry {
  path: string;
  videoFilename: string;
  status: string;
  lastModifiedAt: number;
}

export interface AppManifest {
  version: number;
  recent: ManifestEntry[];
}

// ─── Frame types ─────────────────────────────────────────────────────────────

export interface FrameInfo {
  index: number;
  filename: string;
  path: string;
  timestamp_ms: number;
}

export type ManualOverride = "include" | "exclude" | null;

export interface FrameEntry {
  index: number;
  filename: string;
  path: string;
  timestampMs: number;
  diffScore: number;
  autoIncluded: boolean;
  manualOverride: ManualOverride;
}

// ─── Misc types ──────────────────────────────────────────────────────────────

export type OcrFidelity = "fast" | "balanced" | "accurate";

export interface GlobalPreferences {
  extractionIntervalS: number;
  diffThreshold: number;
  ocrFidelity: OcrFidelity;
}

export interface ExtractionJob {
  ldocPath: string;
  videoFilename: string;
  videoPath: string;
  progress: number;
  frameCount: number;
  totalFrames: number;
  status: ExtractionStatus;
  phase: ExtractionPhase;
  startedAt: number;
}

export interface FrameLogPage {
  page: number;
  timestampMs: number;
  frameFile: string;
}

export interface FrameLog {
  version: number;
  app: string;
  sourceVideoPath: string;
  sourceVideoFilename: string;
  generatedAt: string;
  pages: FrameLogPage[];
}

export type ActiveTab = "library" | "editframes" | "view";
