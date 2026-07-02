'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Broadcast, SignIn, SignOut, Monitor, List, X, Buildings } from '@phosphor-icons/react';

interface Me { sub: string; role: string; orgSlug?: string }

const NAV_LINKS = [
  { href: '/', label: 'Главная' },
  { href: '/streams', label: 'Трансляции' },
  { href: '/archive', label: 'Архив' },
  { href: '/organizations', label: 'Организации' },
];

export function Header() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

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

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <header className="bg-surface-elevated border-b border-zinc-800/60 shrink-0 relative z-40" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center">
        {/* Logo — left */}
        <Link href="/" className="text-zinc-50 no-underline font-bold text-lg tracking-tight hover:text-white transition-colors shrink-0">
          Liga Live
        </Link>

        {/* Desktop nav — centered */}
        <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-lg text-sm no-underline transition-colors ${
                isActive(link.href)
                  ? 'text-zinc-50 bg-zinc-800/70 font-medium'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop auth — right */}
        <div className="hidden md:flex gap-2 items-center shrink-0">
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
              {me.role === 'superadmin' ? (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white no-underline text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-200 active:scale-[0.98]"
                >
                  <Buildings size={16} weight="fill" />
                  Организации
                </Link>
              ) : (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 bg-brand hover:bg-brand-hover text-white no-underline text-sm font-medium px-3 py-1.5 rounded-lg transition-all duration-200 active:scale-[0.98]"
                >
                  <Broadcast size={16} weight="fill" />
                  Студия
                </Link>
              )}
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
        </div>

        {/* Mobile burger — right */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden ml-auto flex items-center justify-center w-9 h-9 text-zinc-400 hover:text-zinc-200 bg-transparent border-none cursor-pointer rounded-lg hover:bg-zinc-800/50 transition-colors"
        >
          {menuOpen ? <X size={20} /> : <List size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-zinc-800/60 bg-surface-elevated absolute inset-x-0 z-50 shadow-xl shadow-black/30" style={{ top: 'calc(3.5rem + env(safe-area-inset-top))' }}>
          <nav className="flex flex-col p-3 gap-0.5">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`px-4 py-3 rounded-lg text-sm no-underline transition-colors ${
                  isActive(link.href)
                    ? 'text-zinc-50 bg-zinc-800/70 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                }`}
              >
                {link.label}
              </Link>
            ))}

            <div className="border-t border-zinc-800/40 mt-2 pt-2 flex flex-col gap-0.5">
              {me ? (
                <>
                  {me.orgSlug && (
                    <Link href={`/watch/${me.orgSlug}`} onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-3 text-zinc-400 hover:text-zinc-200 no-underline text-sm rounded-lg hover:bg-zinc-800/40 transition-colors">
                      <Monitor size={16} /> Моя страница
                    </Link>
                  )}
                  {me.role === 'superadmin' ? (
                    <Link href="/admin" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-3 text-brand no-underline text-sm font-medium rounded-lg hover:bg-brand/10 transition-colors">
                      <Buildings size={16} weight="fill" /> Организации
                    </Link>
                  ) : (
                    <Link href="/dashboard" onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-3 text-brand no-underline text-sm font-medium rounded-lg hover:bg-brand/10 transition-colors">
                      <Broadcast size={16} weight="fill" /> Студия
                    </Link>
                  )}
                  <button onClick={() => { handleLogout(); setMenuOpen(false); }}
                    className="flex items-center gap-2 px-4 py-3 text-zinc-500 hover:text-zinc-300 bg-transparent border-none text-sm rounded-lg hover:bg-zinc-800/40 transition-colors cursor-pointer text-left w-full">
                    <SignOut size={16} /> Выйти
                  </button>
                </>
              ) : (
                <Link href="/login" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-3 text-zinc-300 no-underline text-sm font-medium rounded-lg hover:bg-zinc-800/40 transition-colors">
                  <SignIn size={16} /> Войти
                </Link>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
