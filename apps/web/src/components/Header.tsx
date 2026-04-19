'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Broadcast, SignIn, SignOut, Monitor } from '@phosphor-icons/react';

interface Me { sub: string; role: string; orgSlug?: string }

export function Header() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/v1/auth/me'),
    retry: false,
  });

  async function handleLogout() {
    await api.post('/v1/auth/logout', {});
    qc.clear();
    router.push('/login');
  }

  return (
    <header className="h-14 bg-surface-elevated border-b border-zinc-800/60 flex items-center justify-between px-6 shrink-0">
      <Link href="/" className="text-zinc-50 no-underline font-semibold text-lg tracking-tight hover:text-white transition-colors">
        StreamService
      </Link>

      <nav className="flex gap-2 items-center">
        <Link
          href="/streams"
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 no-underline text-sm transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800/50"
        >
          <Broadcast size={16} />
          Трансляции
        </Link>
        {me ? (
          <>
            {me.orgSlug && (
              <Link
                href={`/watch/${me.orgSlug}`}
                className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 no-underline text-sm transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-800/50"
              >
                <Monitor size={16} />
                Моя страница
              </Link>
            )}
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white no-underline text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-200 active:scale-[0.98]"
            >
              <Broadcast size={16} weight="fill" />
              Студия
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 bg-transparent border border-zinc-800 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-800/50 active:scale-[0.98] cursor-pointer"
            >
              <SignOut size={16} />
              Выйти
            </button>
          </>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-1.5 text-zinc-300 hover:text-white no-underline bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 active:scale-[0.98]"
          >
            <SignIn size={16} />
            Войти
          </Link>
        )}
      </nav>
    </header>
  );
}
