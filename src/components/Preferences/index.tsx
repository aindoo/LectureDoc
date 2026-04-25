import { useStore } from "../../store";

const OCR_OPTIONS = [
  { value: "fast", label: "Fast", desc: "LSTM only, lower accuracy" },
  { value: "balanced", label: "Balanced", desc: "LSTM + legacy (recommended)" },
  { value: "accurate", label: "Accurate", desc: "Multi-pass, highest accuracy" },
] as const;

export default function Preferences() {
  const preferences = useStore((s) => s.preferences);
  const setPreferences = useStore((s) => s.setPreferences);
  const setPreferencesOpen = useStore((s) => s.setPreferencesOpen);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setPreferencesOpen(false)}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-[480px] max-w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-100 mb-5">
          Preferences
        </h2>

        <div className="space-y-5">
          {/* Extraction rate */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Max extraction rate
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Process frames every <strong>{preferences.extractionIntervalS}s</strong>{" "}
              (minimum 0.5 s = 2 fps). Videos already extracted at a higher rate
              will be re-queued if you lower this value.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={preferences.extractionIntervalS}
                onChange={(e) =>
                  setPreferences({
                    extractionIntervalS: parseFloat(e.target.value),
                  })
                }
                className="flex-1 accent-indigo-500"
              />
              <span className="text-sm text-gray-300 w-14 text-right">
                every {preferences.extractionIntervalS}s
              </span>
            </div>
          </div>

          {/* Diff threshold */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Default difference threshold
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Frames with less than <strong>{preferences.diffThreshold}%</strong> visual
              change from the previous frame are auto-excluded. Higher = keep more frames.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={preferences.diffThreshold}
                onChange={(e) =>
                  setPreferences({ diffThreshold: parseInt(e.target.value) })
                }
                className="flex-1 accent-indigo-500"
              />
              <span className="text-sm text-gray-300 w-10 text-right">
                {preferences.diffThreshold}%
              </span>
            </div>
          </div>

          {/* OCR fidelity */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              OCR fidelity
            </label>
            <div className="grid grid-cols-3 gap-2">
              {OCR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPreferences({ ocrFidelity: opt.value })}
                  className={[
                    "p-3 rounded-lg border text-left transition-colors",
                    preferences.ocrFidelity === opt.value
                      ? "border-indigo-500 bg-indigo-900/40 text-white"
                      : "border-gray-600 bg-gray-700 text-gray-300 hover:border-gray-500",
                  ].join(" ")}
                >
                  <div className="text-sm font-medium">{opt.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={() => setPreferencesOpen(false)}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
