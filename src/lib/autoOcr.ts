import { useEffect, useRef } from "react";
import { useStore, includedFrames } from "../store";
import { ocrImage } from "./ocr";

/**
 * Mounts once in App. Watches included frames and automatically runs OCR
 * in the background whenever the set changes (2.5 s debounce). Results
 * are stored in the Zustand store so all components can read them.
 */
export function useAutoOcr() {
  const frames = useStore((s) => s.frames);
  const selectedVideo = useStore((s) => s.selectedVideo);
  const ocrTrigger = useStore((s) => s.ocrTrigger);

  const included = includedFrames(frames);
  const includedKey = included.map((f) => f.index).join(",");

  const abortRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    abortRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!selectedVideo || included.length === 0) {
      useStore.getState().clearOcrIndex();
      return;
    }

    debounceRef.current = setTimeout(async () => {
      abortRef.current = false;
      const startAbortKey = useStore.getState().ocrAbortKey;

      useStore.getState().setIsOcrIndexing(true);
      useStore.getState().setOcrIndex({});
      useStore.getState().setOcrProgress(0);

      const snap = [...included];
      const newIndex: Record<number, string> = {};

      for (let i = 0; i < snap.length; i++) {
        if (abortRef.current || useStore.getState().ocrAbortKey !== startAbortKey) break;
        const frame = snap[i];
        try {
          const text = await ocrImage(frame.path, useStore.getState().preferences.ocrFidelity);
          newIndex[frame.index] = text;
        } catch {
          newIndex[frame.index] = "";
        }
        useStore.getState().setOcrIndex({ ...newIndex });
        useStore.getState().setOcrProgress(i + 1);
      }

      if (!abortRef.current && useStore.getState().ocrAbortKey === startAbortKey) {
        useStore.getState().setIsOcrIndexing(false);
      }
    }, 2500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [includedKey, selectedVideo?.ldocPath, ocrTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
}
