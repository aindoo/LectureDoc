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

  const border = isManual
    ? isIncluded
      ? "border-blue-500"
      : "border-red-500"
    : isIncluded
    ? "border-green-600"
    : "border-transparent";

  return (
    <div
      className={[
        "relative rounded-md overflow-hidden border-2 cursor-pointer group",
        border,
        isSelected ? "ring-2 ring-indigo-400 ring-offset-1 ring-offset-gray-900" : "",
      ].join(" ")}
      onClick={onPreview}
      title={`${isIncluded ? "Included" : "Excluded"} · ${formatMs(frame.timestampMs)} · diff ${frame.diffScore}%`}
    >
      <img
        src={convertFileSrc(frame.path)}
        alt={`Frame at ${formatMs(frame.timestampMs)}`}
        className={`w-full aspect-video object-cover ${!isIncluded ? "opacity-30" : ""}`}
        loading="lazy"
      />

      {/* Timestamp */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-0.5 flex items-center justify-between">
        <span className="text-xs text-gray-300">{formatMs(frame.timestampMs)}</span>
        {isManual && (
          <span className="text-xs text-blue-300">manual</span>
        )}
      </div>

      {/* Include/exclude toggle icon — click only toggles, does not preview */}
      <div
        className={[
          "absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-xs",
          "transition-transform hover:scale-110",
          isIncluded
            ? "bg-green-600 text-white"
            : "bg-red-700 text-white",
        ].join(" ")}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        title={isIncluded ? "Click to exclude" : "Click to include"}
      >
        {isIncluded ? "✓" : "✕"}
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
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Adjust settings to load frames.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-2 shrink-0 flex items-center gap-3 text-xs text-gray-400 border-b border-gray-700 bg-gray-900 sticky top-0 z-10">
        <span>{frames.length} frames shown</span>
        <span>·</span>
        <span className="text-green-400">{included.length} included in PDF</span>
        <span className="text-gray-500 ml-auto">Click ✓/✕ to toggle · Click frame to preview</span>
      </div>
      <div className="grid gap-2 p-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))" }}>
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
