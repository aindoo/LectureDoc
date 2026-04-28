import { useMemo } from "react";
import { useStore, includedFrames } from "../../store";

interface Props {
  query: string;
  onNavigate: (pageIndex: number) => void;
}

function formatMs(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/25 text-yellow-200 not-italic rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function SearchPanel({ query, onNavigate }: Props) {
  const frames = useStore((s) => s.frames);
  const ocrIndex = useStore((s) => s.ocrIndex);
  const isIndexing = useStore((s) => s.isOcrIndexing);
  const indexProgress = useStore((s) => s.ocrProgress);
  const triggerReocr = useStore((s) => s.triggerReocr);
  const cancelOcr = useStore((s) => s.cancelOcr);

  const included = includedFrames(frames);
  const indexed = Object.keys(ocrIndex).length > 0;
  const indexedCount = Object.keys(ocrIndex).length;
  const pct = included.length > 0 ? (indexProgress / included.length) * 100 : 0;

  const matches = useMemo(() => {
    if (!query.trim() || !indexed) return [];
    const q = query.toLowerCase();

    return Object.entries(ocrIndex)
      .filter(([, text]) => text.toLowerCase().includes(q))
      .flatMap(([frameIndexStr, text]) => {
        const frameIndex = parseInt(frameIndexStr, 10);
        const pageIndex = included.findIndex((f) => f.index === frameIndex);
        if (pageIndex === -1) return [];
        const frame = included[pageIndex];

        const lower = text.toLowerCase();
        const matchIdx = lower.indexOf(q);
        const start = Math.max(0, matchIdx - 60);
        const end = Math.min(text.length, matchIdx + q.length + 60);
        let excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
        if (start > 0) excerpt = "…" + excerpt;
        if (end < text.length) excerpt += "…";

        return [{ pageIndex, frame, excerpt }];
      })
      .sort((a, b) => a.pageIndex - b.pageIndex);
  }, [query, ocrIndex, included]);

  return (
    <div className="h-full flex flex-col bg-zinc-900">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 border-b border-zinc-800 shrink-0">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Search</p>
      </div>

      {/* Index status / progress */}
      {isIndexing ? (
        <div className="px-3 py-3 border-b border-zinc-800 shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Indexing slides…</span>
            <span className="text-xs text-zinc-500 tabular-nums">{indexProgress} / {included.length}</span>
          </div>
          <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            onClick={cancelOcr}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : !indexed ? (
        <div className="px-3 py-3.5 border-b border-zinc-800 shrink-0 space-y-2">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Slides are indexed automatically. Click below to re-index manually.
          </p>
          <button
            onClick={triggerReocr}
            disabled={included.length === 0}
            className="w-full py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            Index {included.length} Slide{included.length !== 1 ? "s" : ""}
          </button>
        </div>
      ) : null}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {indexed && query.trim() && matches.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-zinc-600">No matches for</p>
            <p className="text-xs text-zinc-500 mt-0.5 font-medium">"{query}"</p>
          </div>
        )}

        {matches.length > 0 && (
          <>
            <div className="px-3 py-2 border-b border-zinc-800 sticky top-0 bg-zinc-900/95 z-10">
              <span className="text-xs text-zinc-500">
                {matches.length} match{matches.length !== 1 ? "es" : ""}
              </span>
            </div>
            <div className="divide-y divide-zinc-800/60">
              {matches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => onNavigate(m.pageIndex)}
                  className="w-full text-left px-3 py-3 hover:bg-zinc-800/50 transition-colors group"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-indigo-400">
                      Slide {m.pageIndex + 1}
                    </span>
                    <span className="text-xs text-zinc-600 font-mono tabular-nums">
                      {formatMs(m.frame.timestampMs)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3 selectable">
                    {highlight(m.excerpt, query)}
                  </p>
                </button>
              ))}
            </div>
          </>
        )}

        {indexed && !query.trim() && (
          <div className="px-3 py-6 text-center space-y-1">
            <p className="text-xs text-zinc-500">{indexedCount} slide{indexedCount !== 1 ? "s" : ""} indexed</p>
            <p className="text-xs text-zinc-700">Type in the search bar to find slides</p>
          </div>
        )}
      </div>

      {/* Footer: re-index */}
      {indexed && !isIndexing && (
        <div className="px-3 py-2.5 border-t border-zinc-800 shrink-0">
          <button
            onClick={triggerReocr}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            Re-index slides
          </button>
        </div>
      )}
    </div>
  );
}
