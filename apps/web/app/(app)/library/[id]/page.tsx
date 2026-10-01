import {
  COMMERCIAL_LEVER,
  type Evidence,
  FILTER_DIMENSIONS,
  labelText,
  REGION_NAMES,
  SOCIAL_PROOF,
  sourceLabel,
} from '@content-lab/core';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/status-badge';
import { Thumb } from '@/components/item-card';
import { ROLE_COLORS } from '@/lib/colors';
import { loadItem } from '@/lib/library';
import { createClient } from '@/lib/supabase/server';
import { CorrectionForm } from './correction-form';

const yes = (v: boolean | null) => (v === null ? 'Unknown' : v ? 'Yes' : 'No');
const secs = (v: number | null) => (v === null ? 'Not shown' : `${v} s`);

function EvidenceNote({ evidence, field }: { evidence: Evidence; field: string }) {
  const e = evidence[field];
  if (!e) return null;
  const parts = [
    e.origin === 'jev' ? 'Jev' : e.origin === 'ffmpeg' ? 'FFmpeg' : labelText(e.origin),
    e.confidence !== null ? `${Math.round(e.confidence * 100)}%` : null,
    e.frames?.length ? `frames ${e.frames.map((s) => `${s}s`).join(', ')}` : null,
  ].filter(Boolean);
  return <span className="text-[10px] text-faint">{parts.join(' · ')}{e.note ? ` · ${e.note}` : ''}</span>;
}

function Row({ label, value, evidence, field }: { label: string; value: string; evidence: Evidence; field: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs text-sub">{label}</span>
      <span className="text-right text-sm font-medium">
        {value}
        <br />
        <EvidenceNote evidence={evidence} field={field} />
      </span>
    </div>
  );
}

export default async function ItemPage({ params }: PageProps<'/library/[id]'>) {
  const { id } = await params;
  const supabase = await createClient();
  const detail = await loadItem(supabase, id);
  if (!detail) notFound();
  const { item, media, labels, modelLabels, evidence, keyframes, metrics, classification } = detail;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/library" className="text-xs text-accent">Library</Link>
          <h1 className="text-2xl font-semibold tracking-tight">{item.advertiser ?? item.account_handle ?? 'Unknown advertiser'}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-sub">
            <span className="chip">{sourceLabel(item.source)}</span>
            {item.region && <span className="chip">{REGION_NAMES[item.region] ?? item.region}</span>}
            {item.duration_s && <span>{item.duration_s} s</span>}
            {media?.audio_type && <span>Audio: {labelText(media.audio_type)}</span>}
            {classification?.needs_review && <StatusBadge status="needs_review" />}
          </div>
        </div>
        <a href={item.source_url} target="_blank" rel="noreferrer" className="btn-secondary">Open original</a>
      </header>

      <section className="space-y-2">
        <p className="eyebrow">Keyframes</p>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {keyframes.map((k) => (
            <figure key={k.second} className="w-40 shrink-0 space-y-1.5">
              <div className="card relative aspect-[9/16] overflow-hidden">
                <Thumb src={k.url} alt={`Keyframe at ${k.second} seconds`} />
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 text-[10px] font-semibold text-white">{k.second}s</span>
              </div>
              {k.vision && (
                <figcaption className="space-y-1 text-[11px] leading-snug text-sub">
                  <p>{k.vision.description}</p>
                  {k.vision.on_screen_text.length > 0 && <p className="font-medium text-ink">“{k.vision.on_screen_text.join(' | ')}”</p>}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <section className="card p-4">
            <p className="eyebrow">Transcript</p>
            {labels && labels.script.length > 0 ? (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2 text-[10px] text-sub">
                  {Object.entries(ROLE_COLORS).map(([role, color]) => (
                    <span key={role} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{labelText(role)}</span>
                  ))}
                </div>
                {labels.script.map((p, i) => (
                  <p key={i} className="rounded-[10px] py-1.5 pl-3 pr-2 text-sm" style={{ borderLeft: `3px solid ${p.role ? ROLE_COLORS[p.role] : 'var(--line)'}`, background: 'rgba(120,120,128,.06)' }}>
                    <span className="mr-2 text-[10px] text-faint">{p.start !== null ? `${p.start.toFixed(1)}s` : ''} {p.role ? labelText(p.role) : 'Unclear'}</span>
                    {p.text}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-sub">{media?.transcript?.trim() || `No speech (${labelText(media?.audio_type ?? 'unknown')}). Labels come from the frames and on-screen text.`}</p>
            )}
          </section>

          {labels && (
            <section className="card grid gap-x-6 p-4 sm:grid-cols-2">
              <div>
                <p className="eyebrow mb-1">Creative</p>
                {Object.entries(FILTER_DIMENSIONS).map(([field, dim]) => (
                  <Row key={field} label={dim.title} field={field} evidence={evidence}
                    value={labelText(labels[field as keyof typeof FILTER_DIMENSIONS])} />
                ))}
              </div>
              <div>
                <p className="eyebrow mb-1">Reveal timing</p>
                <Row label="App UI" field="reveal.app_ui_s" evidence={evidence} value={secs(labels.reveal.app_ui_s)} />
                <Row label="Product" field="reveal.product_s" evidence={evidence} value={secs(labels.reveal.product_s)} />
                <Row label="Price" field="reveal.price_s" evidence={evidence} value={secs(labels.reveal.price_s)} />
                <Row label="Offer" field="reveal.offer_s" evidence={evidence} value={secs(labels.reveal.offer_s)} />
                <Row label="Logo" field="reveal.logo_s" evidence={evidence} value={secs(labels.reveal.logo_s)} />
              </div>
              <div>
                <p className="eyebrow mb-1 mt-3">Call to action</p>
                <Row label="Channel" field="cta.channel" evidence={evidence} value={labelText(labels.cta.channel)} />
                <Row label="Wording" field="cta.wording" evidence={evidence} value={labels.cta.wording ?? 'None seen'} />
                <Row label="First seen" field="cta.first_s" evidence={evidence} value={secs(labels.cta.first_s)} />
                <Row label="Repeated" field="cta.repeated" evidence={evidence} value={yes(labels.cta.repeated)} />
              </div>
              <div>
                <p className="eyebrow mb-1 mt-3">Execution</p>
                <Row label="Cuts" field="execution.cut_count" evidence={evidence} value={labels.execution.cut_count === null ? 'Unknown' : `${labels.execution.cut_count} (${labels.execution.cuts_per_10s ?? '?'} per 10 s)`} />
                <Row label="Subtitles" field="execution.subtitles" evidence={evidence} value={yes(labels.execution.subtitles)} />
                <Row label="Voiceover" field="execution.voiceover" evidence={evidence} value={yes(labels.execution.voiceover)} />
                <Row label="Music only" field="execution.music" evidence={evidence} value={yes(labels.execution.music)} />
                <Row label="Existing sound" field="execution.trend_sound" evidence={evidence} value={yes(labels.execution.trend_sound)} />
                <Row label="Aspect ratio" field="execution.aspect_ratio" evidence={evidence} value={labels.execution.aspect_ratio ?? 'Unknown'} />
              </div>
              <div className="sm:col-span-2">
                <p className="eyebrow mb-2 mt-3">Levers and social proof</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(COMMERCIAL_LEVER).map((k) => (
                    <span key={k} className={`chip !text-[11px] ${labels.levers.includes(k as never) ? 'active' : 'opacity-50'}`}>{labelText(k)}</span>
                  ))}
                  {Object.keys(SOCIAL_PROOF).map((k) => (
                    <span key={k} className={`chip !text-[11px] ${labels.social_proof.includes(k as never) ? 'active' : 'opacity-50'}`}>{labelText(k)}</span>
                  ))}
                </div>
                <p className="mt-3 text-xs text-sub">
                  Talent: {labelText(labels.talent.gender)}, {labelText(labels.talent.age_bracket)}, up to {labels.talent.people_count ?? '?'} people, face in first frame: {yes(labels.talent.face_first_frame)}
                </p>
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          {classification && labels && modelLabels ? (
            <CorrectionForm classificationId={classification.id} itemId={item.id} labels={labels} modelLabels={modelLabels} />
          ) : (
            <div className="card p-4 text-sm text-sub">Not classified with the current taxonomy yet.</div>
          )}
          <div className="card p-4">
            <p className="eyebrow">Source metrics</p>
            <p className="text-[11px] text-faint">Joined after labeling. Never blended across sources.</p>
            {metrics.length ? (
              <dl className="mt-2 space-y-1">
                {metrics.map((m) => (
                  <div key={m.metric_name} className="flex justify-between text-sm">
                    <dt className="text-sub">{labelText(m.metric_name)}</dt>
                    <dd className="font-medium">{m.value_text ?? (m.metric_name === 'ctr' && m.value !== null ? `${(m.value * 100).toFixed(2)}%` : m.value?.toLocaleString())}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-sm text-sub">No metrics from this source.</p>
            )}
          </div>
          {classification && (
            <p className="px-1 text-[11px] text-faint">
              {classification.model} · {classification.prompt_version} · {classification.vision_version}
              {classification.confidence !== null && ` · lowest confidence ${Math.round(classification.confidence * 100)}%`}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
