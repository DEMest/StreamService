'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';

interface CatalogOrg {
  slug: string;
  name: string;
  isLive: boolean;
  streamTitle: string;
  previewMode: string;
  hasCustomPreview: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function OrgCard({ org, thumbKey }: { org: CatalogOrg; thumbKey: number }) {
  const [imgError, setImgError] = useState(false);
  const hasThumbnail = org.isLive || org.hasCustomPreview;
  const thumbUrl = hasThumbnail ? `${API_BASE}/v1/public/orgs/${org.slug}/thumbnail?t=${thumbKey}` : null;

  useEffect(() => {
    setImgError(false);
  }, [thumbKey]);

  const isLive = org.isLive;

  return (
    <Link href={`/watch/${org.slug}`} style={{ textDecoration: 'none' }}>
      <div style={{
        background: isLive ? '#1a1a1a' : '#141414',
        borderRadius: '8px',
        overflow: 'hidden',
        border: isLive ? '1px solid #e5330033' : '1px solid #2d2d2d',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}>
        <div style={{
          position: 'relative',
          width: '100%',
          paddingTop: '56.25%',
          background: '#0d0d0d',
        }}>
          {thumbUrl && !imgError ? (
            <img
              src={thumbUrl}
              alt={org.name}
              onError={() => setImgError(true)}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: '2rem',
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
          )}
          {isLive && (
            <span style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              background: '#e53',
              color: '#fff',
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Live
            </span>
          )}
        </div>
        <div style={{ padding: '0.75rem 1rem' }}>
          <p style={{ color: isLive ? '#fff' : '#ccc', fontWeight: 600, margin: '0 0 0.15rem', fontSize: '0.9rem' }}>{org.name}</p>
          {org.streamTitle && (
            <p style={{ color: '#888', fontSize: '0.8rem', margin: 0 }}>{org.streamTitle}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function CatalogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogOrg[]>('/v1/public/orgs'),
    refetchInterval: 30_000,
  });

  const [thumbKey, setThumbKey] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setThumbKey(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const live = data?.filter((o) => o.isLive) ?? [];
  const offline = data?.filter((o) => !o.isLive) ?? [];

  return (
    <PublicLayout>
      <div style={{ padding: '2rem' }}>
        {isLoading && <p style={{ color: '#888' }}>Загрузка...</p>}

        {live.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', color: '#e53', marginBottom: '1rem' }}>● Сейчас в эфире</h2>
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginBottom: '2rem' }}>
              {live.map((org) => (
                <OrgCard key={org.slug} org={org} thumbKey={thumbKey} />
              ))}
            </div>
          </>
        )}

        {offline.length > 0 && (
          <>
            <h2 style={{ fontSize: '1rem', color: '#666', marginBottom: '1rem' }}>Все организации</h2>
            <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {offline.map((org) => (
                <OrgCard key={org.slug} org={org} thumbKey={thumbKey} />
              ))}
            </div>
          </>
        )}
      </div>
    </PublicLayout>
  );
}
