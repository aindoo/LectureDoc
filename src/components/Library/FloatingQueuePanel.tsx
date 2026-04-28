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
    <div className="fixed bottom-5 right-5 z-40 w-80 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inset-0 rounded-full bg-indigo-400 opacity-75" />
            <span className="relative rounded-full h-2 w-2 bg-indigo-500" />
          </div>
          <span className="text-sm font-semibold text-zinc-100">Extraction Queue</span>
          {jobs.length > 0 && (
            <span className="bg-zinc-800 text-zinc-300 text-xs rounded-full px-1.5 py-0.5 leading-none font-medium tabular-nums">
              {jobs.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Job list */}
      <div className="max-h-72 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-600">No active jobs</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {jobs.map((job) => (
              <div key={job.ldocPath} className="px-4 py-3.5">
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-zinc-200 truncate" title={job.videoFilename}>
                      {job.videoFilename}
                    </p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      {formatElapsed(job.startedAt)} elapsed
                    </p>
                  </div>
                  {(job.status === "extracting" || job.status === "queued") && (
                    <button
                      onClick={() => cancel(job.ldocPath)}
                      className="text-xs text-zinc-500 hover:text-red-400 shrink-0 transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-300 rounded-full"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 w-8 text-right shrink-0 tabular-nums">
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
