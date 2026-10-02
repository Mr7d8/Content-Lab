'use client';

import { craftOf, frameRows } from '@/lib/frame-view';
import type { BoardAd } from '@/lib/board-view';
import { CraftPanel, FrameByFrame } from './frames';
import { useAdDetail } from './use-ad-detail';

// The selected ad's frame by frame and its timing and craft, as wide rows
// under the map while the inspector stays beside them.
export function DeepDive({ ad, video, onSeek }: { ad: BoardAd | null; video: React.RefObject<HTMLVideoElement | null>; onSeek: (s: number) => void }) {
  const { detail, loading, capture } = useAdDetail(ad);
  if (!ad || ad.decode.status !== 'done') return null;
  if (loading) {
    return (
      <div className="panel space-y-3 p-4" role="status" aria-label="Loading the frames">
        <div className="shimmer h-3 w-40" />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="w-[148px] shrink-0 space-y-2 p-1.5">
              <div className="shimmer aspect-[9/16] w-full" />
              <div className="shimmer h-3 w-11/12" />
              <div className="shimmer h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!detail) return null;
  const rows = frameRows(detail.frames, { segments: detail.segments, beats: ad.breakdown?.beats, durationS: ad.durationS, images: detail.images });
  const craft = detail.record ? craftOf(detail.record) : null;
  return (
    <>
      {rows.length > 0 && (
        <div className="panel p-4">
          <FrameByFrame rows={rows} video={video} capture={capture} capturable={detail.capturable} onSeek={onSeek} />
        </div>
      )}
      {craft && (
        <div className="panel p-4">
          <CraftPanel craft={craft} onSeek={onSeek} />
        </div>
      )}
    </>
  );
}
