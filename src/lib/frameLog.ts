import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { FrameEntry, FrameLog } from "../types";

export async function writeFrameLog(
  pdfBasePath: string, // path without extension
  frames: FrameEntry[],
  sourceVideoPath: string,
  sourceVideoFilename: string
): Promise<string> {
  const log: FrameLog = {
    version: 1,
    app: "Lecture Doc",
    sourceVideoPath: relativePath(pdfBasePath, sourceVideoPath),
    sourceVideoFilename,
    generatedAt: new Date().toISOString(),
    pages: frames.map((f, i) => ({
      page: i + 1,
      timestampMs: f.timestampMs,
      frameFile: f.filename,
    })),
  };

  const logPath = `${pdfBasePath}_frames.json`;
  await writeTextFile(logPath, JSON.stringify(log, null, 2));
  return logPath;
}

export async function readFrameLog(logPath: string): Promise<FrameLog | null> {
  try {
    const content = await readTextFile(logPath);
    return JSON.parse(content) as FrameLog;
  } catch {
    return null;
  }
}

export function frameLogPathForPdf(pdfPath: string): string {
  return pdfPath.replace(/\.pdf$/i, "_frames.json");
}

/** Compute a relative path from a base file to a target file. */
function relativePath(_basePath: string, targetPath: string): string {
  return targetPath;
}
