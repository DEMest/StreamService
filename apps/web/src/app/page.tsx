'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';

interface CatalogOrg {
  slug: string;
  name: string;
  events: { id: string; title: string; startedAt: string }[];
}

export default function CatalogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', padding: '2rem', color: '#fff' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '2rem' }}>Прямые трансляции</h1>
      {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}
      {data?.length === 0 && <p style={{ color: '#888' }}>Нет активных трансляций</p>}
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {data?.map((org) => (
          <Link key={org.slug} href={`/watch/${org.slug}`} style={{ textDecoration: 'none' }}>
            <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.25rem', cursor: 'pointer', border: '1px solid #2d2d2d' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e53', display: 'inline-block' }} />
                <span style={{ color: '#e53', fontSize: '0.75rem', fontWeight: 600 }}>LIVE</span>
              </div>
              <p style={{ color: '#fff', fontWeight: 600, margin: '0 0 0.25rem' }}>{org.name}</p>
              <p style={{ color: '#888', fontSize: '0.875rem', margin: 0 }}>{org.events[0]?.title}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
