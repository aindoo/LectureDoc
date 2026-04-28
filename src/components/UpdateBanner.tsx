import { invoke } from "@tauri-apps/api/core";

interface Props {
  version: string;
  onDismiss: () => void;
}

export default function UpdateBanner({ version, onDismiss }: Props) {
  function openDownload() {
    invoke("open_external_url", { url: "https://radstacks.org/lecturedoc/#download" }).catch(() => {});
  }

  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-indigo-950 border-b border-indigo-800 text-sm">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
      <span className="text-indigo-200 flex-1">
        Lecture Doc <strong className="font-semibold">{version}</strong> is available.
      </span>
      <button
        onClick={openDownload}
        className="px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
      >
        Download
      </button>
      <button
        onClick={onDismiss}
        className="p-1 text-indigo-400 hover:text-indigo-200 transition-colors rounded"
        aria-label="Dismiss"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
