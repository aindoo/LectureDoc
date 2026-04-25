import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { FrameEntry } from "../types";

export async function buildPdf(
  frames: FrameEntry[],
  savePath: string
): Promise<void> {
  const pdf = await PDFDocument.create();

  for (const frame of frames) {
    const bytes = await readFile(frame.path);
    const img = await pdf.embedPng(bytes);
    const { width, height } = img;
    const page = pdf.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await pdf.save();
  await writeFile(savePath, pdfBytes);
}
