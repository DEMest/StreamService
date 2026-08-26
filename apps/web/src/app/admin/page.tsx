'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';
import { Plus, Trash, Prohibit, Warning, Tray, ChatText } from '@phosphor-icons/react';

interface Org { id: string; slug: string; name: string; isActive: boolean; createdAt: string }

export default function AdminPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ slug: '', password: '' });
  const [showCreate, setShowCreate] = useState(false);

  const { data: orgs } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => api.get<Org[]>('/v1/admin/orgs'),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => api.post('/v1/admin/orgs', data),
    onSuccess: () => { setForm({ slug: '', password: '' }); setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-orgs'] }); },
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
      <div className="max-w-[920px] mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Управление организациями</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/requests"
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer no-underline"
            >
              <Tray size={16} weight="bold" />
              Заявки
            </Link>
            <Link
              href="/admin/feedback"
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer no-underline"
            >
              <ChatText size={16} weight="bold" />
              Обратная связь
            </Link>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer"
            >
              <Plus size={16} weight="bold" />
              Новая организация
            </button>
          </div>
        </div>

        {showCreate && (
          <form
            onSubmit={(e) => { e.preventDefault(); createMutation.mutate(form); }}
            className="bg-surface-elevated border border-zinc-800 rounded-xl p-5 mb-6 flex flex-col gap-4"
          >
            <div>
              <h2 className="text-base font-medium text-zinc-200">Новая организация</h2>
              <p className="text-xs text-zinc-500 mt-1">Название по умолчанию совпадает с логином — организация сможет поменять его в своём дашборде.</p>
            </div>
            {[
              { key: 'slug' as const, placeholder: 'Логин для входа', label: 'Логин' },
              { key: 'password' as const, placeholder: 'Пароль для входа', label: 'Пароль' },
            ].map(({ key, placeholder, label }) => (
              <div key={key} className="flex flex-col gap-1.5">
                <label className="text-xs text-zinc-500">{label}</label>
                <input
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  type={key === 'password' ? 'password' : 'text'}
                  className="px-3 py-2.5 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
                  required
                />
              </div>
            ))}
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {createMutation.isPending ? 'Создание...' : 'Создать'}
            </button>
            {createMutation.isError && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <Warning size={16} weight="fill" className="shrink-0" />
                {(createMutation.error as Error).message}
              </div>
            )}
          </form>
        )}

        <div className="bg-surface-elevated border border-zinc-800/50 rounded-xl divide-y divide-zinc-800/60">
          {orgs?.map((org) => (
            <div key={org.id} className="flex items-center justify-between px-5 py-4">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-semibold text-zinc-100 truncate">{org.name}</span>
                <span className="text-zinc-600 text-xs font-mono shrink-0">@{org.slug}</span>
                {!org.isActive && (
                  <span className="flex items-center gap-1 text-zinc-600 text-xs shrink-0">
                    <Prohibit size={12} />
                    Отключена
                  </span>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => toggleMutation.mutate({ slug: org.slug, isActive: !org.isActive })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                    org.isActive
                      ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                      : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                  }`}
                >
                  {org.isActive ? 'Отключить' : 'Включить'}
                </button>
                <button
                  onClick={() => { if (confirm(`Удалить организацию ${org.name}?`)) deleteMutation.mutate(org.slug); }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer"
                >
                  <Trash size={12} />
                  Удалить
                </button>
              </div>
            </div>
          ))}

          {orgs?.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-2 opacity-40">
              <span className="text-sm text-zinc-500">Организаций пока нет</span>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
