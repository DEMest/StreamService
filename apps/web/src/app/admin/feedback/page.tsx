'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';
import {
  ArrowLeft, ChatText, Trash, CheckCircle, ArrowCounterClockwise,
  Link as LinkIcon, Monitor, VideoCamera, At,
} from '@phosphor-icons/react';
import { ConsentBadge } from '@/components/ConsentBadge';

interface Feedback {
  id: string;
  topic: string;
  message: string;
  contact: string | null;
  pageUrl: string | null;
  orgSlug: string | null;
  streamSlug: string | null;
  userAgent: string | null;
  status: 'new' | 'processed' | string;
  consentAt: string | null;
  consentVersion: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новое',
  processed: 'Разобрано',
};

type Filter = 'new' | 'all';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Контакт кликабелен только если это похоже на почту — телеграм даём текстом. */
function contactHref(contact: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? `mailto:${contact}` : null;
}

export default function AdminFeedbackPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('new');

  const { data: items, isLoading } = useQuery({
    queryKey: ['admin-feedback', filter],
    queryFn: () =>
      api.get<Feedback[]>(`/v1/admin/feedback${filter === 'new' ? '?status=new' : ''}`),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['admin-feedback'] });
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/v1/admin/feedback/${id}`, { status }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/feedback/${id}`),
    onSuccess: invalidate,
  });

  return (
    <PublicLayout>
      <div className="max-w-[920px] mx-auto px-6 py-8">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 mb-4 no-underline transition-colors"
        >
          <ArrowLeft size={12} /> К организациям
        </Link>

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Обратная связь</h1>
          <div className="flex items-center gap-1 bg-surface-elevated border border-zinc-800/60 rounded-lg p-1">
            {(['new', 'all'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer border-none ${
                  filter === f
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'bg-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {f === 'new' ? 'Новые' : 'Все'}
              </button>
            ))}
          </div>
        </div>

        {isLoading && <div className="text-sm text-zinc-500 py-12 text-center">Загрузка...</div>}

        <div className="flex flex-col gap-3">
          {items?.map((f) => {
            const isNew = f.status === 'new';
            const stream = [f.orgSlug, f.streamSlug].filter(Boolean).join(' / ');
            const href = f.contact ? contactHref(f.contact) : null;

            return (
              <div
                key={f.id}
                className={`bg-surface-elevated border rounded-xl p-5 ${
                  isNew ? 'border-brand/30' : 'border-zinc-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <ChatText size={14} className="text-zinc-500 shrink-0" />
                    <span className="font-semibold text-zinc-100">{f.topic}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full shrink-0 ${
                        isNew ? 'bg-brand/15 text-brand' : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {STATUS_LABEL[f.status] ?? f.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <ConsentBadge consentAt={f.consentAt} consentVersion={f.consentVersion} />
                    <span className="text-xs text-zinc-600 font-mono">{formatDate(f.createdAt)}</span>
                  </div>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed bg-surface-primary border border-zinc-800/60 rounded-lg p-3 mb-3 whitespace-pre-wrap break-words">
                  {f.message}
                </p>

                <div className="flex flex-col gap-1.5 text-xs text-zinc-500 mb-3">
                  {f.contact && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <At size={12} className="shrink-0" />
                      {href ? (
                        <a href={href} className="text-zinc-400 hover:text-brand no-underline transition-colors truncate">
                          {f.contact}
                        </a>
                      ) : (
                        <span className="text-zinc-400 truncate">{f.contact}</span>
                      )}
                    </div>
                  )}
                  {stream && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <VideoCamera size={12} className="shrink-0" />
                      <span className="font-mono truncate">{stream}</span>
                    </div>
                  )}
                  {f.pageUrl && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <LinkIcon size={12} className="shrink-0" />
                      <a
                        href={f.pageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-500 hover:text-brand no-underline transition-colors truncate"
                      >
                        {f.pageUrl}
                      </a>
                    </div>
                  )}
                  {f.userAgent && (
                    <div className="flex items-start gap-1.5 min-w-0">
                      <Monitor size={12} className="shrink-0 mt-0.5" />
                      <span className="font-mono text-zinc-600 break-all">{f.userAgent}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() =>
                      statusMutation.mutate({ id: f.id, status: isNew ? 'processed' : 'new' })
                    }
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none ${
                      isNew
                        ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {isNew ? (
                      <>
                        <CheckCircle size={12} weight="fill" />
                        Отметить разобранным
                      </>
                    ) : (
                      <>
                        <ArrowCounterClockwise size={12} />
                        Вернуть в новые
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Удалить обращение?')) deleteMutation.mutate(f.id);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none"
                  >
                    <Trash size={12} />
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {!isLoading && items?.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 opacity-40">
              <span className="text-sm text-zinc-500">
                {filter === 'new' ? 'Новых обращений нет' : 'Обращений пока нет'}
              </span>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
