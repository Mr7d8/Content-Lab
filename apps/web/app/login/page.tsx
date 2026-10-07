import { SetupNotice } from '@/components/setup-notice';
import { supabaseEnv } from '@/lib/env';
import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { error } = await searchParams;
  if (!supabaseEnv()) return <SetupNotice />;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass w-full max-w-sm rounded-[20px] p-7">
        <p className="eyebrow">Content Lab</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-sub">We email you a one-time link. No password.</p>
        <LoginForm linkError={!!error} />
      </div>
    </main>
  );
}
