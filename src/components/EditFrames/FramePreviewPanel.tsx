import { convertFileSrc } from "@tauri-apps/api/core";
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

export default function FramePreviewPanel({ frame, onClose }: { frame: FrameEntry | null; onClose?: () => void }) {
  if (!frame) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-zinc-700">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-xs text-zinc-600 text-center px-4">Click a frame to preview</p>
      </div>
    );
  }

  const isIncluded =
    frame.manualOverride === "include" ||
    (frame.manualOverride === null && frame.autoIncluded);
  const isManual = frame.manualOverride !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Preview</span>
        {onClose && (
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
            title="Hide preview"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        <div className="p-3">
          <img
            src={convertFileSrc(frame.path)}
            alt={`Frame at ${formatMs(frame.timestampMs)}`}
            className="w-full rounded-lg shadow-lg"
          />
        </div>

        {/* Metadata */}
        <div className="px-4 pb-4 space-y-0">
          {[
            {
              label: "Status",
              value: (
                <div className="flex items-center gap-1.5">
                  <span className={[
                    "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md",
                    isIncluded
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400",
                  ].join(" ")}>
                    <span className={[
                      "w-1.5 h-1.5 rounded-full",
                      isIncluded ? "bg-emerald-400" : "bg-red-400",
                    ].join(" ")} />
                    {isIncluded ? "Included" : "Excluded"}
                  </span>
                  {isManual && (
                    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400">
                      manual
                    </span>
                  )}
                </div>
              ),
            },
            {
              label: "Timestamp",
              value: <span className="text-xs font-mono text-zinc-200">{formatMs(frame.timestampMs)}</span>,
            },
            {
              label: "Diff score",
              value: <span className="text-xs text-zinc-200">{frame.diffScore}%</span>,
            },
            {
              label: "Frame",
              value: <span className="text-xs text-zinc-400">#{frame.index}</span>,
            },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2.5 border-b border-zinc-800/50 last:border-0">
              <span className="text-xs text-zinc-500">{label}</span>
              {value}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
