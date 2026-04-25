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
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-600">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-xs text-center px-4">Click a frame to preview</p>
      </div>
    );
  }

  const isIncluded =
    frame.manualOverride === "include" ||
    (frame.manualOverride === null && frame.autoIncluded);
  const isManual = frame.manualOverride !== null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400 font-medium shrink-0 flex items-center justify-between">
        <span>Preview</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors"
            title="Hide preview"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <img
          src={convertFileSrc(frame.path)}
          alt={`Frame at ${formatMs(frame.timestampMs)}`}
          className="w-full rounded shadow-lg"
        />
        <table className="w-full text-xs">
          <tbody className="divide-y divide-gray-800">
            <tr>
              <td className="py-1.5 text-gray-500 pr-3 w-1/2">Timestamp</td>
              <td className="py-1.5 text-gray-200 font-mono">{formatMs(frame.timestampMs)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-gray-500 pr-3">Diff score</td>
              <td className="py-1.5 text-gray-200">{frame.diffScore}%</td>
            </tr>
            <tr>
              <td className="py-1.5 text-gray-500 pr-3">Status</td>
              <td className="py-1.5">
                <span className={[
                  "px-1.5 py-0.5 rounded text-xs font-medium",
                  isIncluded ? "bg-green-900/60 text-green-300" : "bg-red-900/60 text-red-300",
                ].join(" ")}>
                  {isIncluded ? "Included" : "Excluded"}
                </span>
                {isManual && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-xs bg-blue-900/60 text-blue-300">
                    manual
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td className="py-1.5 text-gray-500 pr-3">Frame index</td>
              <td className="py-1.5 text-gray-400">#{frame.index}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
