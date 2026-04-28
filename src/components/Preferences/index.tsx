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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={() => setPreferencesOpen(false)}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-[500px] max-w-[calc(100vw-2rem)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-100">Preferences</h2>
          <button
            onClick={() => setPreferencesOpen(false)}
            className="w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-6">
          {/* Extraction rate */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-zinc-200">Max extraction rate</label>
              <span className="text-sm font-medium text-indigo-400 tabular-nums">
                every {preferences.extractionIntervalS}s
              </span>
            </div>
            <p className="text-xs text-zinc-500 mb-3">
              Frames captured per second during extraction. Lower values produce more frames.
            </p>
            <input
              type="range"
              min={0.5}
              max={10}
              step={0.5}
              value={preferences.extractionIntervalS}
              onChange={(e) => setPreferences({ extractionIntervalS: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>0.5s (faster)</span>
              <span>10s (slower)</span>
            </div>
          </div>

          {/* Diff threshold */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-zinc-200">Default diff threshold</label>
              <span className="text-sm font-medium text-indigo-400 tabular-nums">
                {preferences.diffThreshold}%
              </span>
            </div>
            <p className="text-xs text-zinc-500 mb-3">
              Frames with less visual change than this threshold are auto-excluded.
            </p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={preferences.diffThreshold}
              onChange={(e) => setPreferences({ diffThreshold: parseInt(e.target.value) })}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-1">
              <span>0% (keep all)</span>
              <span>100% (keep unique)</span>
            </div>
          </div>

          {/* OCR fidelity */}
          <div>
            <label className="block text-sm font-medium text-zinc-200 mb-3">OCR fidelity</label>
            <div className="grid grid-cols-3 gap-2">
              {OCR_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPreferences({ ocrFidelity: opt.value })}
                  className={[
                    "p-3 rounded-xl border text-left transition-all",
                    preferences.ocrFidelity === opt.value
                      ? "border-indigo-500 bg-indigo-600/10"
                      : "border-zinc-800 bg-zinc-800/50 hover:border-zinc-700",
                  ].join(" ")}
                >
                  <div className={[
                    "text-sm font-medium mb-0.5",
                    preferences.ocrFidelity === opt.value ? "text-zinc-100" : "text-zinc-300",
                  ].join(" ")}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-zinc-500">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex justify-end">
          <button
            onClick={() => setPreferencesOpen(false)}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
