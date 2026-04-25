import { createWorker } from "tesseract.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { OcrFidelity } from "../types";

let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
let workerFidelity: OcrFidelity | null = null;

async function getWorker(fidelity: OcrFidelity) {
  if (worker && workerFidelity === fidelity) return worker;
  if (worker) await worker.terminate();

  // OEM: 3 = default (LSTM + legacy), 1 = LSTM only (faster)
  const oem = fidelity === "fast" ? 1 : 3;
  // PSM: 3 = fully automatic (default)
  const psm = 3;

  worker = await createWorker("eng", oem, {
    logger: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: psm as any });
  workerFidelity = fidelity;
  return worker;
}

export async function ocrImage(
  imagePath: string,
  fidelity: OcrFidelity = "balanced"
): Promise<string> {
  const w = await getWorker(fidelity);
  const url = convertFileSrc(imagePath);
  const { data } = await w.recognize(url);
  return data.text;
}

export async function terminateOcr() {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerFidelity = null;
  }
}
