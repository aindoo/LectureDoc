import { convertFileSrc } from "@tauri-apps/api/core";
import type { VideoEntry } from "../../types";

interface Props {
  video: VideoEntry;
  onOpen: (video: VideoEntry) => void;
  onExtract: (video: VideoEntry) => void;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function StatusBadge({ video }: { video: VideoEntry }) {
  const { extractionStatus, extractionProgress } = video;

  if (extractionStatus === "ready") {
    return (
      <span className="px-2 py-0.5 text-xs bg-green-900 text-green-300 rounded-full">
        Ready
      </span>
    );
  }
  if (extractionStatus === "extracting") {
    return (
      <span className="px-2 py-0.5 text-xs bg-blue-900 text-blue-300 rounded-full">
        Extracting {extractionProgress}%
      </span>
    );
  }
  if (extractionStatus === "hashing") {
    return (
      <span className="px-2 py-0.5 text-xs bg-purple-900 text-purple-300 rounded-full">
        Indexing…
      </span>
    );
  }
  if (extractionStatus === "queued") {
    return (
      <span className="px-2 py-0.5 text-xs bg-yellow-900 text-yellow-300 rounded-full">
        Queued
      </span>
    );
  }
  if (extractionStatus === "error") {
    return (
      <span className="px-2 py-0.5 text-xs bg-red-900 text-red-300 rounded-full" title={video.errorMsg ?? ""}>
        Error
      </span>
    );
  }
  return null;
}

export default function VideoCard({ video, onOpen, onExtract }: Props) {
  const isProcessing =
    video.extractionStatus === "extracting" ||
    video.extractionStatus === "hashing" ||
    video.extractionStatus === "queued";

  const thumbnailSrc = video.thumbnailPath
    ? convertFileSrc(video.thumbnailPath)
    : null;

  return (
    <div
      className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700 hover:border-gray-500 transition-colors cursor-pointer group"
      onClick={() => video.extractionStatus === "ready" && onOpen(video)}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-gray-900 relative overflow-hidden">
        {thumbnailSrc ? (
          <img
            src={thumbnailSrc}
            alt={video.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}

        {/* Progress bar overlay */}
        {isProcessing && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${video.extractionProgress}%` }}
            />
          </div>
        )}

        {/* Open overlay on hover */}
        {video.extractionStatus === "ready" && (
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <span className="text-white text-sm font-medium">Open in View</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-medium text-gray-100 truncate" title={video.filename}>
          {video.filename}
        </p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-gray-400">
            {formatDuration(video.durationSecs)}
            {video.width > 0 && ` · ${video.width}×${video.height}`}
          </span>
          <StatusBadge video={video} />
        </div>

        {video.extractionStatus === "idle" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExtract(video);
            }}
            className="mt-2 w-full text-xs py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white rounded transition-colors"
          >
            Extract Frames
          </button>
        )}
        {video.extractionStatus === "error" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExtract(video);
            }}
            className="mt-2 w-full text-xs py-1.5 bg-red-800 hover:bg-red-700 text-white rounded transition-colors"
          >
            Retry Extraction
          </button>
        )}
      </div>
    </div>
  );
}
