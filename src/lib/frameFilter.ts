import { invoke } from "@tauri-apps/api/core";
import type { FrameEntry, FrameInfo } from "../types";

export async function buildFrameEntries(
  frameDir: string,
  allFrames: FrameInfo[],
  displayIntervalS: number,
  extractionIntervalS: number,
  diffThreshold: number,
  diffMode: "rolling" | "continuous" = "rolling"
): Promise<FrameEntry[]> {
  if (allFrames.length === 0) return [];

  const step = Math.max(1, Math.round(displayIntervalS / extractionIntervalS));
  const filtered = allFrames.filter((_, i) => i % step === 0);

  if (filtered.length === 0) return [];

  const indices = filtered.map((f) => f.index - 1); // 0-based for Rust
  const scores: number[] = await invoke("compute_diffs", {
    frameDir,
    frameIndices: indices,
    mode: diffMode,
  });

  return filtered.map((f, i) => {
    const score = scores[i] ?? 100;
    return {
      index: f.index,
      filename: f.filename,
      path: f.path,
      timestampMs: f.timestamp_ms,
      diffScore: score,
      autoIncluded: score >= diffThreshold,
      manualOverride: null,
    };
  });
}
