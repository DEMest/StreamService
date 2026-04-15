'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';

interface CatalogOrg {
  slug: string;
  name: string;
  isLive: boolean;
  streamTitle: string;
}

export default function CatalogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  const live = data?.filter((o) => o.isLive) ?? [];
  const offline = data?.filter((o) => !o.isLive) ?? [];

  return (
    <PublicLayout>
      <div style={{ padding: '2rem' }}>
        {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}

        {live.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', color: '#e53', marginBottom: '1rem' }}>● Сейчас в эфире</h2>
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginBottom: '2rem' }}>
              {live.map((org) => (
                <Link key={org.slug} href={`/watch/${org.slug}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.25rem', border: '1px solid #e5330033', cursor: 'pointer' }}>
                    <p style={{ color: '#fff', fontWeight: 600, margin: '0 0 0.25rem' }}>{org.name}</p>
                    <p style={{ color: '#888', fontSize: '0.875rem', margin: 0 }}>{org.streamTitle}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {offline.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', color: '#666', marginBottom: '1rem' }}>Все организации</h2>
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {offline.map((org) => (
                <Link key={org.slug} href={`/watch/${org.slug}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: '#141414', borderRadius: '8px', padding: '1.25rem', border: '1px solid #2d2d2d', cursor: 'pointer' }}>
                    <p style={{ color: '#ccc', fontWeight: 600, margin: 0 }}>{org.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
