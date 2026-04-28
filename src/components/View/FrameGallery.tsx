import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useStore, includedFrames, buildLdocFrameSettings } from "../../store";
import type { FrameEntry } from "../../types";

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function FrameCard({
  frame,
  onToggle,
  onPreview,
  isSelected,
}: {
  frame: FrameEntry;
  onToggle: () => void;
  onPreview: () => void;
  isSelected?: boolean;
}) {
  const isIncluded =
    frame.manualOverride === "include" ||
    (frame.manualOverride === null && frame.autoIncluded);
  const isManual = frame.manualOverride !== null;

  return (
    <div
      className={[
        "relative rounded-lg overflow-hidden cursor-pointer group transition-all duration-150",
        isSelected
          ? "ring-2 ring-indigo-500 ring-offset-1 ring-offset-zinc-900"
          : "ring-1 ring-zinc-800 hover:ring-zinc-600",
      ].join(" ")}
      onClick={onPreview}
      title={`${isIncluded ? "Included" : "Excluded"} · ${formatMs(frame.timestampMs)} · diff ${frame.diffScore}%`}
    >
      {/* Thumbnail */}
      <img
        src={convertFileSrc(frame.path)}
        alt={`Frame at ${formatMs(frame.timestampMs)}`}
        className={[
          "w-full aspect-video object-cover block transition-opacity",
          !isIncluded ? "opacity-25" : "",
        ].join(" ")}
        loading="lazy"
      />

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1 flex items-center justify-between">
        <span className="text-xs text-zinc-300 font-mono tabular-nums">{formatMs(frame.timestampMs)}</span>
        {isManual && (
          <span className="text-xs text-blue-400 font-medium">manual</span>
        )}
      </div>

      {/* Toggle button */}
      <div
        className={[
          "absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center",
          "transition-all opacity-80 group-hover:opacity-100 hover:scale-110",
          isIncluded ? "bg-emerald-500" : "bg-red-500/80",
        ].join(" ")}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={isIncluded ? "Click to exclude" : "Click to include"}
      >
        {isIncluded ? (
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}
      </div>
    </div>
  );
}

interface FrameGalleryProps {
  onFrameSelect?: (frame: FrameEntry) => void;
  selectedFrameIndex?: number | null;
}

export default function FrameGallery({ onFrameSelect, selectedFrameIndex }: FrameGalleryProps) {
  const frames = useStore((s) => s.frames);
  const toggleFrameOverride = useStore((s) => s.toggleFrameOverride);
  const included = includedFrames(frames);

  function handleToggle(frame: FrameEntry) {
    toggleFrameOverride(frame.index);
    const { frames: currentFrames, viewSettings, selectedVideo } = useStore.getState();
    if (selectedVideo) {
      const settings = buildLdocFrameSettings(currentFrames, viewSettings);
      invoke("save_ldoc_settings", {
        ldocPath: selectedVideo.ldocPath,
        frameSettings: settings,
        status: "extracted",
      }).catch(() => {});
    }
  }

  if (frames.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-zinc-600">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm text-zinc-600">Adjust settings to load frames</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats bar */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-zinc-900/95 border-b border-zinc-800 flex items-center gap-3">
        <span className="text-xs text-zinc-500">{frames.length} frames</span>
        <span className="text-zinc-700">·</span>
        <span className="text-xs text-emerald-500 font-medium">{included.length} included</span>
        <span className="text-zinc-700">·</span>
        <span className="text-xs text-zinc-600">{frames.length - included.length} excluded</span>
        <span className="ml-auto text-xs text-zinc-600">Click ✓/✕ to toggle · click frame to preview</span>
      </div>

      {/* Grid */}
      <div
        className="grid gap-2 p-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}
      >
        {frames.map((f) => (
          <FrameCard
            key={f.index}
            frame={f}
            onToggle={() => handleToggle(f)}
            onPreview={() => onFrameSelect?.(f)}
            isSelected={selectedFrameIndex === f.index}
          />
        ))}
      </div>
    </div>
  );
}
