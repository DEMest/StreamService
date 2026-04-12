'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';

interface Me { orgSlug?: string; role: string }

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/v1/auth/me'),
    retry: false,
  });

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0a0a0a', color: '#fff' }}>
      <nav style={{ width: '220px', background: '#111', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column', padding: '1rem 0', flexShrink: 0 }}>
        <div style={{ padding: '0 1rem 1rem', borderBottom: '1px solid #222', marginBottom: '0.5rem' }}>
          <Link href="/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.8rem' }}>← На сайт</Link>
        </div>
        {me?.orgSlug && (
          <Link href={`/watch/${me.orgSlug}`} style={{ padding: '0.5rem 1rem', color: '#ccc', textDecoration: 'none', fontSize: '0.875rem' }}>
            Моя страница
          </Link>
        )}
        <div style={{ padding: '0.75rem 1rem 0.25rem', color: '#555', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Управление</div>
        <Link href="/dashboard" style={{ padding: '0.5rem 1rem', color: '#fff', textDecoration: 'none', fontSize: '0.875rem' }}>
          Трансляция и события
        </Link>
      </nav>
      <main style={{ flex: 1, overflowY: 'auto' }}>{children}</main>
    </div>
  );
}
