import { useStore } from "../../store";

export default function SettingsPanel() {
  const viewSettings = useStore((s) => s.viewSettings);
  const setViewSettings = useStore((s) => s.setViewSettings);
  const selectedVideo = useStore((s) => s.selectedVideo);

  const extractionInterval = selectedVideo?.extractionIntervalS ?? 0.5;

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 space-y-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Frame Settings
      </h3>

      {/* Display interval */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">
          Show frames every
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={extractionInterval}
            max={30}
            step={extractionInterval}
            value={viewSettings.intervalS}
            onChange={(e) =>
              setViewSettings({ intervalS: parseFloat(e.target.value) })
            }
            className="flex-1 accent-indigo-500"
          />
          <span className="text-sm text-gray-300 w-14 text-right shrink-0">
            {viewSettings.intervalS}s
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Extracted at {extractionInterval}s interval
        </p>
      </div>

      {/* Diff threshold */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">
          Difference threshold
        </label>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={viewSettings.diffThreshold}
            onChange={(e) =>
              setViewSettings({ diffThreshold: parseInt(e.target.value) })
            }
            className="flex-1 accent-indigo-500"
          />
          <span className="text-sm text-gray-300 w-10 text-right shrink-0">
            {viewSettings.diffThreshold}%
          </span>
        </div>
      </div>

      {/* Diff mode */}
      <div>
        <label className="block text-xs text-gray-400 mb-1.5">Diff mode</label>
        <div className="flex rounded-md overflow-hidden border border-gray-600 text-xs">
          <button
            onClick={() => setViewSettings({ diffMode: "rolling" })}
            className={[
              "flex-1 py-1.5 transition-colors",
              viewSettings.diffMode === "rolling"
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:bg-gray-700",
            ].join(" ")}
            title="Compare each frame against the previous displayed frame"
          >
            Rolling
          </button>
          <button
            onClick={() => setViewSettings({ diffMode: "continuous" })}
            className={[
              "flex-1 py-1.5 border-l border-gray-600 transition-colors",
              viewSettings.diffMode === "continuous"
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:bg-gray-700",
            ].join(" ")}
            title="Compare each frame against the immediately preceding extracted frame"
          >
            Continuous
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          {viewSettings.diffMode === "rolling"
            ? "vs. previous shown frame"
            : "vs. previous extracted frame"}
        </p>
      </div>
    </div>
  );
}
