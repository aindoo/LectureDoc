import { invoke } from "@tauri-apps/api/core";
import { useStore } from "../../store";

function formatElapsed(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function Queue() {
  const jobs = useStore((s) => s.jobs);

  async function cancel(ldocPath: string) {
    await invoke("cancel_extraction", { ldocPath });
  }

  if (jobs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        No active extraction jobs.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      <h2 className="text-sm font-semibold text-gray-300 mb-3 shrink-0">Extraction Queue</h2>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-700">
              <th className="pb-2 pr-4 font-medium">Video</th>
              <th className="pb-2 pr-4 font-medium">Status</th>
              <th className="pb-2 pr-4 font-medium">Progress</th>
              <th className="pb-2 pr-4 font-medium">Frames</th>
              <th className="pb-2 pr-4 font-medium">Elapsed</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.ldocPath} className="border-b border-gray-800">
                <td className="py-3 pr-4 text-gray-200 max-w-xs">
                  <span className="truncate block" title={job.videoFilename}>{job.videoFilename}</span>
                  <span className="text-xs text-gray-600 truncate block" title={job.ldocPath}>
                    {job.ldocPath.split("/").pop()}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <StatusPill status={job.status} />
                </td>
                <td className="py-3 pr-4 w-40">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all duration-300"
                        style={{ width: `${job.progress}%` }} />
                    </div>
                    <span className="text-xs text-gray-400 w-8 text-right">{job.progress}%</span>
                  </div>
                </td>
                <td className="py-3 pr-4 text-gray-400 text-xs">
                  {job.frameCount.toLocaleString()} / {job.totalFrames.toLocaleString()}
                </td>
                <td className="py-3 pr-4 text-gray-400 text-xs">{formatElapsed(job.startedAt)}</td>
                <td className="py-3">
                  {(job.status === "extracting" || job.status === "queued") && (
                    <button onClick={() => cancel(job.ldocPath)}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors">
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const [label, color] =
    status === "queued" ? ["Queued", "bg-yellow-900 text-yellow-300"] :
    status === "hashing" ? ["Indexing", "bg-purple-900 text-purple-300"] :
    status === "extracting" ? ["Extracting", "bg-blue-900 text-blue-300"] :
    status === "ready" ? ["Done", "bg-green-900 text-green-300"] :
    ["Error", "bg-red-900 text-red-300"];
  return <span className={`px-2 py-0.5 text-xs rounded-full ${color}`}>{label}</span>;
}
