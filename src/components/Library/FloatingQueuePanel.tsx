import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function FloatingQueuePanel({ open, onClose }: Props) {
  const jobs = useStore((s) => s.jobs);

  if (!open) return null;

  async function cancel(ldocPath: string) {
    await invoke("cancel_extraction", { ldocPath }).catch(() => {});
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-200">Extraction Queue</span>
          {jobs.length > 0 && (
            <span className="bg-indigo-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
              {jobs.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300 transition-colors text-lg leading-none"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Job list */}
      <div className="max-h-72 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-500">No active jobs</div>
        ) : (
          <div className="divide-y divide-gray-700/50">
            {jobs.map((job) => (
              <div key={job.ldocPath} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate" title={job.videoFilename}>
                      {job.videoFilename}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatElapsed(job.startedAt)} elapsed
                    </p>
                  </div>
                  {(job.status === "extracting" || job.status === "queued") && (
                    <button
                      onClick={() => cancel(job.ldocPath)}
                      className="text-xs text-red-400 hover:text-red-300 shrink-0 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-8 text-right shrink-0">
                    {job.progress}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
