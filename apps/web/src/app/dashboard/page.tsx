'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Gear, Trash, VideoCamera, ArrowRight, Stack, Plus, DotsThreeVertical, PencilSimple, X, Warning } from '@phosphor-icons/react';

interface OrgStreamSummary {
  id: string;
  slug: string;
  name: string;
  isLive: boolean;
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface OrgProfile {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  chatTtlMinutes: number;
  chatEnabled: boolean;
}

const CHAT_TTL_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 5,   label: '5 мин' },
  { minutes: 30,  label: '30 мин' },
  { minutes: 60,  label: '1 час' },
  { minutes: 180, label: '3 часа' },
  { minutes: 300, label: '5 часов' },
];

const inputClasses = 'w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

export default function DashboardPage() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<OrgStreamSummary | null>(null);
  const [renameTarget, setRenameTarget] = useState<OrgStreamSummary | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ['org-profile'],
    queryFn: () => api.get<OrgProfile>('/v1/org/me'),
    refetchInterval: 30_000,
  });

  const [nameInput, setNameInput] = useState('');
  const [nameSynced, setNameSynced] = useState(false);
  useEffect(() => {
    if (profile && !nameSynced) {
      setNameInput(profile.name);
      setNameSynced(true);
    }
  }, [profile, nameSynced]);

  const { data: streamsList } = useQuery({
    queryKey: ['org-streams-list'],
    queryFn: () => api.get<OrgStreamSummary[]>('/v1/org/streams'),
    refetchInterval: 30_000,
  });

  const sortedStreams = [...(streamsList ?? [])].sort((a, b) =>
    (a.name || a.slug).localeCompare(b.name || b.slug, 'ru'),
  );

  const createStreamMutation = useMutation({
    mutationFn: (data: { slug: string; name?: string }) =>
      api.post<OrgStreamSummary>('/v1/org/streams', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setCreateOpen(false);
    },
  });

  const deleteStreamMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/org/streams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setDeleteTarget(null);
    },
  });

  const renameStreamMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch(`/v1/org/streams/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-streams-list'] });
      setRenameTarget(null);
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<Pick<OrgProfile, 'name' | 'chatTtlMinutes' | 'chatEnabled'>>) =>
      api.patch('/v1/org/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-profile'] }),
  });

  const nameConflict = updateSettingsMutation.error?.message?.toLowerCase().includes('already taken');
  const nameErrorMessage = nameConflict ? 'Это название уже занято другой организацией' : updateSettingsMutation.error?.message;

  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = () => setMenuFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuFor]);

  return (
    <DashboardLayout>
      <div className="max-w-[920px] mx-auto px-6 py-8 space-y-5">
        <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">{profile?.name} — Панель управления</h1>

        {/* Streams list */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
              <Stack size={18} weight="fill" className="text-brand" />
              Мои стримы
              <span className="ml-1 text-xs text-zinc-600 font-mono tabular-nums">
                {sortedStreams.length}
              </span>
            </h2>
            <button
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer"
            >
              <Plus size={14} weight="bold" />
              Новый стрим
            </button>
          </div>

          {sortedStreams.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 opacity-40">
              <VideoCamera size={32} weight="thin" className="text-zinc-600" />
              <p className="text-zinc-500 text-sm">Стримы не настроены</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sortedStreams.map((s) => (
                <div
                  key={s.id}
                  className="relative flex flex-col gap-2.5 p-4 rounded-xl bg-surface-primary border border-zinc-800/60 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-100 truncate">
                        {s.name?.trim() || s.slug}
                      </div>
                      <div className="text-[11px] text-zinc-500 font-mono truncate">/{s.slug}</div>
                    </div>
                    <div className="relative shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === s.id ? null : s.id); }}
                        aria-label="Меню стрима"
                        className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                      >
                        <DotsThreeVertical size={16} weight="bold" />
                      </button>
                      {menuFor === s.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 bg-surface-elevated border border-zinc-700 rounded-lg shadow-xl"
                        >
                          <button
                            onClick={() => { setRenameTarget(s); setMenuFor(null); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                          >
                            <PencilSimple size={12} /> Переименовать
                          </button>
                          <button
                            onClick={() => { setDeleteTarget(s); setMenuFor(null); }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                          >
                            <Trash size={12} /> Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    {s.isLive ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-medium">
                        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" /> LIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-zinc-500 text-[10px] font-medium">
                        <span className="w-1 h-1 rounded-full bg-zinc-600" /> OFF
                      </span>
                    )}
                  </div>

                  <Link
                    href={`/dashboard/streams/${s.id}`}
                    className="mt-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-brand/20 hover:bg-brand/30 text-brand text-xs font-medium rounded-md transition-all active:scale-[0.98] no-underline"
                  >
                    Открыть <ArrowRight size={12} weight="bold" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Org-level settings (chat policy) */}
        <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
          <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300 mb-4">
            <Gear size={18} className="text-zinc-400" />
            Настройки организации
          </h2>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-zinc-500">Название организации</label>
              <div className="flex items-center gap-2">
                <input
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className={inputClasses}
                  placeholder="Название"
                />
                <button
                  onClick={() => updateSettingsMutation.mutate({ name: nameInput.trim() })}
                  disabled={updateSettingsMutation.isPending || !nameInput.trim() || nameInput.trim() === profile?.name}
                  className="shrink-0 px-3 py-2 bg-brand hover:bg-brand-hover text-white text-xs font-semibold rounded-lg transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
              {updateSettingsMutation.isError && nameErrorMessage && (
                <p className="text-xs text-red-400">{nameErrorMessage}</p>
              )}
              <p className="text-xs text-zinc-600">Отображается зрителям; должно быть уникальным. Логин для входа не меняется.</p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-zinc-200 font-medium">Чат на трансляциях</span>
                <span className="text-xs text-zinc-500">
                  {profile?.chatEnabled === false ? 'Зрители не могут писать сообщения' : 'Открыт для зрителей'}
                </span>
              </div>
              <button
                onClick={() => updateSettingsMutation.mutate({ chatEnabled: !(profile?.chatEnabled ?? true) })}
                disabled={updateSettingsMutation.isPending}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer disabled:opacity-50 ${
                  profile?.chatEnabled === false
                    ? 'bg-brand text-white hover:bg-brand-hover'
                    : 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                }`}
              >
                {profile?.chatEnabled === false ? 'Включить чат' : 'Заблокировать'}
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-xs text-zinc-500">Автоудаление сообщений чата</label>
                <span className="text-xs text-zinc-400 tabular-nums">
                  {CHAT_TTL_PRESETS.find((p) => p.minutes === (profile?.chatTtlMinutes ?? 180))?.label ?? '3 часа'}
                </span>
              </div>
              <div className="flex gap-1 bg-surface-primary rounded-lg p-1">
                {CHAT_TTL_PRESETS.map((p) => {
                  const active = (profile?.chatTtlMinutes ?? 180) === p.minutes;
                  return (
                    <button
                      key={p.minutes}
                      onClick={() => updateSettingsMutation.mutate({ chatTtlMinutes: p.minutes })}
                      disabled={updateSettingsMutation.isPending}
                      className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                        active ? 'bg-brand text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                      } disabled:opacity-50`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-zinc-600">Применяется ко всем стримам организации.</p>
            </div>
          </div>
        </section>
      </div>

      {createOpen && (
        <CreateStreamModal
          onClose={() => setCreateOpen(false)}
          existingSlugs={sortedStreams.map((s) => s.slug)}
          onSubmit={(payload) => createStreamMutation.mutate(payload)}
          isSubmitting={createStreamMutation.isPending}
          errorMessage={createStreamMutation.error?.message ?? null}
        />
      )}

      {deleteTarget && (
        <DeleteStreamModal
          stream={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteStreamMutation.mutate(deleteTarget.id)}
          isSubmitting={deleteStreamMutation.isPending}
          errorMessage={deleteStreamMutation.error?.message ?? null}
        />
      )}

      {renameTarget && (
        <RenameStreamModal
          stream={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSubmit={(name) => renameStreamMutation.mutate({ id: renameTarget.id, name })}
          isSubmitting={renameStreamMutation.isPending}
          errorMessage={renameStreamMutation.error?.message ?? null}
        />
      )}
    </DashboardLayout>
  );
}

// ─── Modals ────────────────────────────────────────────────────────────────

interface ModalShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}

function ModalShell({ title, onClose, children, widthClass = 'max-w-md' }: ModalShellProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthClass} bg-surface-elevated border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800/60">
          <h3 className="text-base font-semibold text-zinc-100 tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

interface CreateStreamModalProps {
  onClose: () => void;
  existingSlugs: string[];
  onSubmit: (payload: { slug: string; name?: string }) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function CreateStreamModal({ onClose, existingSlugs, onSubmit, isSubmitting, errorMessage }: CreateStreamModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');

  const trimmedSlug = slug.trim().toLowerCase();
  const slugFormatValid = SLUG_REGEX.test(trimmedSlug);
  const slugDuplicate = existingSlugs.includes(trimmedSlug);
  const slugError = !trimmedSlug
    ? null
    : !slugFormatValid
      ? 'Только латинские буквы, цифры и дефисы (например: court-b)'
      : slugDuplicate
        ? 'Такой slug уже занят'
        : null;

  const canSubmit = trimmedSlug.length > 0 && !slugError && !isSubmitting;

  // Серверная ошибка по сообщению — распознаём 409 от других.
  const conflict = errorMessage?.toLowerCase().includes('already taken');
  const visibleError = conflict ? 'Slug уже занят в этой организации' : errorMessage;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      slug: trimmedSlug,
      name: name.trim() || undefined,
    });
  }

  return (
    <ModalShell title="Новый стрим" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Slug (часть URL)</label>
          <input
            autoFocus
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="court-b"
            className={inputClasses}
            disabled={isSubmitting}
          />
          {slugError ? (
            <p className="text-xs text-red-400">{slugError}</p>
          ) : (
            <p className="text-xs text-zinc-600">
              URL стрима будет: <span className="font-mono text-zinc-500">/{trimmedSlug || 'slug'}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Название (необязательно)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Корт B"
            className={inputClasses}
            disabled={isSubmitting}
          />
        </div>

        {visibleError && !conflict && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <Warning size={14} className="shrink-0 mt-0.5" weight="fill" />
            <span>{visibleError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Создание…' : 'Создать'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

interface DeleteStreamModalProps {
  stream: OrgStreamSummary;
  onClose: () => void;
  onConfirm: () => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function DeleteStreamModal({ stream, onClose, onConfirm, isSubmitting, errorMessage }: DeleteStreamModalProps) {
  return (
    <ModalShell title="Удалить стрим?" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <Warning size={18} weight="fill" className="shrink-0 text-red-400 mt-0.5" />
          <div className="text-sm text-zinc-200">
            Стрим{' '}
            <span className="font-semibold">«{stream.name?.trim() || stream.slug}»</span>{' '}
            и все его записи будут удалены без возможности восстановления.
          </div>
        </div>

        {errorMessage && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? 'Удаление…' : 'Удалить'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

interface RenameStreamModalProps {
  stream: OrgStreamSummary;
  onClose: () => void;
  onSubmit: (name: string) => void;
  isSubmitting: boolean;
  errorMessage: string | null;
}

function RenameStreamModal({ stream, onClose, onSubmit, isSubmitting, errorMessage }: RenameStreamModalProps) {
  const [name, setName] = useState(stream.name ?? '');
  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== stream.name && !isSubmitting;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <ModalShell title="Переименовать стрим" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Название</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClasses}
            placeholder={stream.slug}
            disabled={isSubmitting}
          />
          <p className="text-xs text-zinc-600">
            Slug <span className="font-mono text-zinc-500">/{stream.slug}</span> не меняется.
          </p>
        </div>

        {errorMessage && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
