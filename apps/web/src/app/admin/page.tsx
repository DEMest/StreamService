'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';

interface Org { id: string; slug: string; name: string; isActive: boolean; createdAt: string }

export default function AdminPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '', password: '' });
  const [showCreate, setShowCreate] = useState(false);

  const { data: orgs } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get<Org[]>('/v1/admin/orgs'),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/v1/admin/orgs', data),
    onSuccess: () => { setForm({ slug: '', name: '', password: '' }); setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-orgs'] }); },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ slug, isActive }: { slug: string; isActive: boolean }) =>
      api.patch(`/v1/admin/orgs/${slug}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (slug: string) => api.delete(`/v1/admin/orgs/${slug}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
  });

  return (
    <PublicLayout>
    <div style={{ padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Управление организациями</h1>
        <button onClick={() => setShowCreate((v) => !v)}
          style={{ padding: '0.5rem 1.25rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
          + Новая организация
        </button>
      </div>

      {showCreate && (
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
          style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Новая организация</h2>
          {[
            { key: 'slug' as const, placeholder: 'Slug (логин, URL)' },
            { key: 'name' as const, placeholder: 'Название организации' },
            { key: 'password' as const, placeholder: 'Пароль для входа' },
          ].map(({ key, placeholder }) => (
            <input key={key} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
              type={key === 'password' ? 'password' : 'text'}
              style={{ padding: '0.75rem', background: '#0a0a0a', border: '1px solid #333', color: '#fff', borderRadius: '4px' }}
              required />
          ))}
          <button type="submit" disabled={createMutation.isPending}
            style={{ padding: '0.75rem', background: '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>
            {createMutation.isPending ? 'Создание...' : 'Создать'}
          </button>
          {createMutation.isError && (
            <p style={{ color: '#ff4444', margin: 0, fontSize: '0.875rem' }}>{(createMutation.error as Error).message}</p>
          )}
        </form>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {orgs?.map((org) => (
          <div key={org.id} style={{ background: '#1a1a1a', borderRadius: '8px', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 600 }}>{org.name}</span>
              <span style={{ color: '#666', marginLeft: '0.5rem', fontSize: '0.875rem', fontFamily: 'monospace' }}>@{org.slug}</span>
              {!org.isActive && <span style={{ marginLeft: '0.75rem', color: '#888', fontSize: '0.75rem' }}>ОТКЛЮЧЕНА</span>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => toggleMutation.mutate({ slug: org.slug, isActive: !org.isActive })}
                style={{ padding: '0.25rem 0.75rem', background: org.isActive ? '#374151' : '#059669', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                {org.isActive ? 'Отключить' : 'Включить'}
              </button>
              <button onClick={() => { if (confirm(`Удалить организацию ${org.name}?`)) deleteMutation.mutate(org.slug); }}
                style={{ padding: '0.25rem 0.75rem', background: '#7f1d1d', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
    </PublicLayout>
  );
}
