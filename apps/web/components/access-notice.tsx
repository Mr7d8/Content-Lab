import { accessText } from '@/lib/access';

const ICONS = {
  pending: (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden className="text-accent">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M4.8 8.2 7 10.3l4.2-4.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  declined: (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden className="text-red">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  waiting: (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden className="text-orange">
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 4.6V8l2.2 1.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// Signed in, but not on the team: where their access request stands. Laid
// out like the login card.
export function AccessNotice({ email, status }: { email: string; status: 'pending' | 'declined' | null }) {
  const kind = status ?? 'waiting';
  const text = accessText(email)[kind];
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-sm rounded-[20px] p-7">
        <p className="eyebrow">Content Lab</p>
        <div className="mt-4">{ICONS[kind]}</div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{text.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-sub">{text.body}</p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button type="submit" className="btn-secondary w-full">Sign out</button>
        </form>
      </div>
    </main>
  );
}
