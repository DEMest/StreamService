'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';
import {
  ArrowLeft, Buildings, Envelope, Phone, Trash, CheckCircle, ArrowCounterClockwise,
} from '@phosphor-icons/react';

interface ContactRequest {
  id: string;
  org: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  status: 'new' | 'processed' | string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  processed: 'Обработана',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminRequestsPage() {
  const qc = useQueryClient();

  const { data: requests, isLoading } = useQuery({
    queryKey: ['admin-contact-requests'],
    queryFn: () => api.get<ContactRequest[]>('/v1/admin/contact-requests'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/v1/admin/contact-requests/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-contact-requests'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/contact-requests/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-contact-requests'] }),
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

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Заявки на подключение</h1>
          <span className="text-xs text-zinc-500">
            Всего: {requests?.length ?? 0}
          </span>
        </div>

        {isLoading && (
          <div className="text-sm text-zinc-500 py-12 text-center">Загрузка...</div>
        )}

        <div className="flex flex-col gap-3">
          {requests?.map((r) => {
            const isNew = r.status === 'new';
            return (
              <div
                key={r.id}
                className={`bg-surface-elevated border rounded-xl p-5 ${
                  isNew ? 'border-brand/30' : 'border-zinc-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <Buildings size={14} className="text-zinc-500 shrink-0" />
                    <span className="font-semibold text-zinc-100 truncate">{r.org}</span>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full shrink-0 ${
                        isNew
                          ? 'bg-brand/15 text-brand'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-600 font-mono shrink-0">{formatDate(r.createdAt)}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm mb-3">
                  <div className="text-zinc-300">{r.name}</div>
                  <a
                    href={`mailto:${r.email}`}
                    className="flex items-center gap-1.5 text-zinc-400 hover:text-brand no-underline transition-colors"
                  >
                    <Envelope size={12} /> {r.email}
                  </a>
                  {r.phone && (
                    <a
                      href={`tel:${r.phone}`}
                      className="flex items-center gap-1.5 text-zinc-400 hover:text-brand no-underline transition-colors"
                    >
                      <Phone size={12} /> {r.phone}
                    </a>
                  )}
                </div>

                {r.message && (
                  <p className="text-sm text-zinc-400 leading-relaxed bg-surface-primary border border-zinc-800/60 rounded-lg p-3 mb-3 whitespace-pre-wrap">
                    {r.message}
                  </p>
                )}

                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() =>
                      statusMutation.mutate({
                        id: r.id,
                        status: isNew ? 'processed' : 'new',
                      })
                    }
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer ${
                      isNew
                        ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    {isNew ? (
                      <>
                        <CheckCircle size={12} weight="fill" />
                        Отметить обработанной
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
                      if (confirm('Удалить заявку?')) deleteMutation.mutate(r.id);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer"
                  >
                    <Trash size={12} />
                    Удалить
                  </button>
                </div>
              </div>
            );
          })}

          {!isLoading && requests?.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 opacity-40">
              <span className="text-sm text-zinc-500">Заявок пока нет</span>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
