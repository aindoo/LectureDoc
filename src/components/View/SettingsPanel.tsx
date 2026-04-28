import { useStore } from "../../store";

export default function SettingsPanel() {
  const viewSettings = useStore((s) => s.viewSettings);
  const setViewSettings = useStore((s) => s.setViewSettings);
  const selectedVideo = useStore((s) => s.selectedVideo);

  const extractionInterval = selectedVideo?.extractionIntervalS ?? 0.5;

  return (
    <div className="space-y-5">
      {/* Section label */}
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Frame Settings</p>

      {/* Display interval */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-zinc-300">Show frames every</label>
          <span className="text-xs font-medium text-indigo-400 tabular-nums">{viewSettings.intervalS}s</span>
        </div>
        <input
          type="range"
          min={extractionInterval}
          max={30}
          step={extractionInterval}
          value={viewSettings.intervalS}
          onChange={(e) => setViewSettings({ intervalS: parseFloat(e.target.value) })}
          className="w-full accent-indigo-500"
        />
        <p className="text-xs text-zinc-600 mt-1">Extracted at {extractionInterval}s</p>
      </div>

      {/* Diff threshold */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-zinc-300">Diff threshold</label>
          <span className="text-xs font-medium text-indigo-400 tabular-nums">{viewSettings.diffThreshold}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={viewSettings.diffThreshold}
          onChange={(e) => setViewSettings({ diffThreshold: parseInt(e.target.value) })}
          className="w-full accent-indigo-500"
        />
      </div>

      {/* Diff mode */}
      <div>
        <label className="block text-xs font-medium text-zinc-300 mb-2">Diff mode</label>
        <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-800 rounded-lg">
          <button
            onClick={() => setViewSettings({ diffMode: "rolling" })}
            className={[
              "py-1.5 text-xs font-medium rounded-md transition-all",
              viewSettings.diffMode === "rolling"
                ? "bg-zinc-700 text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
            title="Compare each frame against the previous displayed frame"
          >
            Rolling
          </button>
          <button
            onClick={() => setViewSettings({ diffMode: "continuous" })}
            className={[
              "py-1.5 text-xs font-medium rounded-md transition-all",
              viewSettings.diffMode === "continuous"
                ? "bg-zinc-700 text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-300",
            ].join(" ")}
            title="Compare each frame against the immediately preceding extracted frame"
          >
            Continuous
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-1.5">
          {viewSettings.diffMode === "rolling" ? "vs. previous shown frame" : "vs. previous extracted frame"}
        </p>
      </div>
    </div>
  );
}
