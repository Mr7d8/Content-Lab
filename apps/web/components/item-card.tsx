import { labelText, sourceLabel } from '@content-lab/core';
import Link from 'next/link';
import type { LibraryItem } from '@/lib/library';

export function Thumb({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  return src ? (
    // Signed Storage URLs expire, so they skip the Next image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className={`h-full w-full object-cover ${className}`} />
  ) : (
    <div className={`flex h-full w-full items-center justify-center bg-fill text-xs text-faint ${className}`}>No frame</div>
  );
}

export function ItemCard({ item }: { item: LibraryItem }) {
  return (
    <Link href={`/library/${item.id}`} className="card group block overflow-hidden transition-transform hover:-translate-y-0.5">
      <div className="relative aspect-[9/16] bg-fill">
        <Thumb src={item.thumb} alt={item.advertiser ?? 'Ad keyframe'} />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          {sourceLabel(item.source)}
        </span>
        {item.needsReview && (
          <span className="absolute right-2 top-2 rounded-full bg-[var(--orange)] px-2 py-0.5 text-[10px] font-semibold text-white">Review</span>
        )}
        {item.metric && (
          <span className="absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
            {item.metric.value} {item.metric.name}
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-2.5">
        <p className="truncate text-xs font-semibold">{item.advertiser ?? 'Unknown advertiser'}</p>
        <div className="flex flex-wrap gap-1">
          {[item.labels.hook_type, item.labels.format, item.labels.objective].map((label, i) => (
            <span key={i} className="chip !px-2 !py-0.5 !text-[10px]">{labelText(label)}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
