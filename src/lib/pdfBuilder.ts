import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { FrameEntry } from "../types";

export async function buildPdf(
  frames: FrameEntry[],
  savePath: string,
  ocrIndex?: Record<number, string>
): Promise<void> {
  const pdf = await PDFDocument.create();
  const font = ocrIndex && Object.keys(ocrIndex).length > 0
    ? await pdf.embedFont(StandardFonts.Helvetica)
    : null;

  for (const frame of frames) {
    const bytes = await readFile(frame.path);
    const img = await pdf.embedPng(bytes);
    const { width, height } = img;
    const page = pdf.addPage([width, height]);
    page.drawImage(img, { x: 0, y: 0, width, height });

    const text = ocrIndex?.[frame.index];
    if (text && font) {
      // Invisible text layer — makes the PDF searchable/selectable without
      // affecting the visual output (opacity: 0, 1pt font size).
      page.drawText(text.replace(/\s+/g, " ").trim(), {
        x: 0,
        y: 1,
        size: 1,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
        maxWidth: width,
      });
    }
  }

  const pdfBytes = await pdf.save();
  await writeFile(savePath, pdfBytes);
}
