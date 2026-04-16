'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

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
    <header style={{ height: '56px', background: '#111', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.5rem', flexShrink: 0 }}>
      <Link href="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '1.1rem' }}>
        StreamService
      </Link>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        {me ? (
          <>
            {me.orgSlug && (
              <Link href={`/watch/${me.orgSlug}`} style={{ color: '#888', textDecoration: 'none', fontSize: '0.875rem' }}>
                Моя страница
              </Link>
            )}
            <Link href="/dashboard" style={{ color: '#fff', textDecoration: 'none', background: '#2563eb', padding: '0.375rem 0.875rem', borderRadius: '4px', fontSize: '0.875rem' }}>
              Студия
            </Link>
            <button
              onClick={handleLogout}
              style={{ color: '#888', background: 'none', border: '1px solid #333', padding: '0.375rem 0.875rem', borderRadius: '4px', fontSize: '0.875rem', cursor: 'pointer' }}
            >
              Выйти
            </button>
          </>
        ) : (
          <Link href="/login" style={{ color: '#fff', textDecoration: 'none', background: '#2d2d2d', padding: '0.375rem 0.875rem', borderRadius: '4px', fontSize: '0.875rem' }}>
            Войти
          </Link>
        )}
      </div>
    </header>
  );
}
