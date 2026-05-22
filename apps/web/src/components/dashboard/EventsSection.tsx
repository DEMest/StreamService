'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  CalendarStar, Plus, DotsThreeVertical, PencilSimple, Trash, ArrowRight,
  Warning, X, VideoCamera, PlayCircle, StopCircle, Check, ClockCounterClockwise,
} from '@phosphor-icons/react';

/**
 * Dashboard «События» (Step 5, spec §11 dashboard + C1 фронт-задача).
 *
 * REST:
 *   GET    /v1/org/events                       — список (refetch 30s)
 *   GET    /v1/org/events/:id                   — детали + streams[]
 *   POST   /v1/org/events                       — создать
 *   PATCH  /v1/org/events/:id                   — обновить (title/desc/scheduledAt)
 *   DELETE /v1/org/events/:id                   — удалить
 *   POST   /v1/org/events/:id/start             — перевести в active
 *   POST   /v1/org/events/:id/end               — завершить
 *   POST   /v1/org/events/:id/streams { streamId } — привязать Stream
 *   DELETE /v1/org/events/:id/streams/:streamId — отвязать
 *
 * Карточка показывает 3 состояния (derived):
 *   - запланирован: !startedAt
 *   - активен: startedAt && !endedAt
 *   - завершён: endedAt
 */

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface EventDto {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

interface EventDetailStream {
  id: string;
  slug: string;
  name: string;
  isLive: boolean;
  isPublic: boolean;
  previewMode: string;
  addedAt: string;
}

interface EventDetailDto extends EventDto {
  streams: EventDetailStream[];
}

interface OrgStreamSummary {
  id: string;
  slug: string;
  name: string;
  mode: 'composite' | 'multistream';
  slotCount: number;
  isLive: boolean;
}

type EventStatus = 'scheduled' | 'active' | 'ended';

function getStatus(ev: EventDto): EventStatus {
  if (ev.endedAt) return 'ended';
  if (ev.startedAt) return 'active';
  return 'scheduled';
}

function formatScheduled(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const inputClasses =
  'w-full px-3 py-2 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors';

export function EventsSection() {
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EventDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventDto | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const { data: events } = useQuery({
    queryKey: ['org-events'],
    queryFn: () => api.get<EventDto[]>('/v1/org/events'),
    refetchInterval: 30_000,
  });

  // Для каждого Event'а — отдельный счётчик привязанных Stream'ов. Базовый
  // list endpoint не отдаёт streams[]; чтобы не делать N+1 запросов на детали,
  // используем lazy подход: на карточке показываем «—» пока detail не загружен,
  // и инициируем загрузку detail только при наведении / открытии меню. Однако
  // для v1 здесь хватает простого `streamCounts` Map которая дозаполняется по
  // мере открытия modals → invalidate.
  const { data: streamCounts } = useQuery({
    queryKey: ['org-event-stream-counts', events?.map((e) => e.id).join(',')],
    queryFn: async () => {
      if (!events?.length) return {} as Record<string, number>;
      const entries = await Promise.all(
        events.map(async (ev) => {
          try {
            const detail = await api.get<EventDetailDto>(`/v1/org/events/${ev.id}`);
            return [ev.id, detail.streams.length] as const;
          } catch {
            return [ev.id, 0] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: !!events?.length,
    refetchInterval: 60_000,
  });

  // Клик вне меню — закрыть. Делаем единый listener на section (не document),
  // чтобы не мешать другим dropdown'ам страницы.
  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = () => setMenuFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuFor]);

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/v1/org/events/${id}/start`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-events'] }),
  });

  const endMutation = useMutation({
    mutationFn: (id: string) => api.post(`/v1/org/events/${id}/end`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-events'] }),
  });

  const sortedEvents = [...(events ?? [])].sort((a, b) => {
    // Активные сверху, затем запланированные, затем завершённые. Внутри —
    // createdAt DESC (свежие первые).
    const order: Record<EventStatus, number> = { active: 0, scheduled: 1, ended: 2 };
    const diff = order[getStatus(a)] - order[getStatus(b)];
    if (diff !== 0) return diff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const existingSlugs = events?.map((e) => e.slug) ?? [];

  return (
    <section className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2 text-base font-medium text-zinc-300">
          <CalendarStar size={18} weight="fill" className="text-brand" />
          События
          <span className="ml-1 text-xs text-zinc-600 font-mono tabular-nums">
            {sortedEvents.length}
          </span>
        </h2>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand hover:bg-brand-hover text-white text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer"
        >
          <Plus size={14} weight="bold" />
          Создать
        </button>
      </div>

      {sortedEvents.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2 opacity-40">
          <CalendarStar size={32} weight="thin" className="text-zinc-600" />
          <p className="text-zinc-500 text-sm">Событий пока нет</p>
          <p className="text-zinc-600 text-xs max-w-xs text-center">
            Объедините несколько стримов в одно мероприятие — турнир, концерт, конференцию
            — с общим лендингом и чатом.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedEvents.map((ev) => {
            const status = getStatus(ev);
            const streamCount = streamCounts?.[ev.id] ?? 0;
            const scheduledText = formatScheduled(ev.scheduledAt);
            const isOpen = menuFor === ev.id;
            return (
              <div
                key={ev.id}
                className="relative flex flex-col gap-2.5 p-4 rounded-xl bg-surface-primary border border-zinc-800/60 hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-100 truncate">
                      {ev.title}
                    </div>
                    <div className="text-[11px] text-zinc-500 font-mono truncate">
                      /{ev.slug}
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(isOpen ? null : ev.id);
                      }}
                      aria-label="Меню события"
                      className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <DotsThreeVertical size={16} weight="bold" />
                    </button>
                    {isOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-full mt-1 z-20 min-w-[180px] py-1 bg-surface-elevated border border-zinc-700 rounded-lg shadow-xl"
                      >
                        <button
                          onClick={() => {
                            setEditTarget(ev);
                            setMenuFor(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer text-left"
                        >
                          <PencilSimple size={12} />
                          Редактировать
                        </button>
                        <button
                          onClick={() => {
                            setDeleteTarget(ev);
                            setMenuFor(null);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer text-left"
                        >
                          <Trash size={12} />
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Статус + расписание */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <StatusBadge status={status} />
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 text-[10px] font-medium">
                    <VideoCamera size={10} weight="fill" />
                    <span className="font-mono tabular-nums">{streamCount}</span>
                  </span>
                  {scheduledText && status !== 'ended' && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 text-[10px] font-medium">
                      <ClockCounterClockwise size={10} weight="bold" />
                      {scheduledText}
                    </span>
                  )}
                </div>

                {/* Описание (если есть) */}
                {ev.description && (
                  <p className="text-xs text-zinc-500 line-clamp-2 leading-snug">
                    {ev.description}
                  </p>
                )}

                {/* Действия */}
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {status === 'scheduled' && (
                    <button
                      onClick={() => startMutation.mutate(ev.id)}
                      disabled={startMutation.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand hover:bg-brand-hover text-white text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                    >
                      <PlayCircle size={12} weight="fill" />
                      Старт
                    </button>
                  )}
                  {status === 'active' && (
                    <button
                      onClick={() => {
                        if (confirm(`Завершить событие «${ev.title}»?`)) {
                          endMutation.mutate(ev.id);
                        }
                      }}
                      disabled={endMutation.isPending}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                    >
                      <StopCircle size={12} weight="fill" />
                      Завершить
                    </button>
                  )}
                  <button
                    onClick={() => setEditTarget(ev)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <ArrowRight size={12} weight="bold" />
                    Открыть
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <CreateEventModal
          existingSlugs={existingSlugs}
          onClose={() => setCreateOpen(false)}
        />
      )}

      {editTarget && (
        <EditEventModal
          event={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteEventModal
          event={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand/15 border border-brand/30 text-brand text-[10px] font-medium uppercase tracking-wider">
        <span className="w-1 h-1 rounded-full bg-brand animate-pulse" />
        Активно
      </span>
    );
  }
  if (status === 'ended') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700/50 text-zinc-500 text-[10px] font-medium uppercase tracking-wider">
        <Check size={9} weight="bold" />
        Завершено
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 text-[10px] font-medium uppercase tracking-wider">
      <ClockCounterClockwise size={10} weight="bold" />
      Запланировано
    </span>
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
        className={`w-full ${widthClass} bg-surface-elevated border border-zinc-800 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden max-h-[90vh] flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800/60 shrink-0">
          <h3 className="text-base font-semibold text-zinc-100 tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Закрыть"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function CreateEventModal({
  existingSlugs,
  onClose,
}: {
  existingSlugs: string[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');

  const trimmedSlug = slug.trim().toLowerCase();
  const slugFormatValid = SLUG_REGEX.test(trimmedSlug);
  const slugDuplicate = existingSlugs.includes(trimmedSlug);
  const slugError = !trimmedSlug
    ? null
    : !slugFormatValid
      ? 'Только латинские буквы, цифры и дефисы (например: spring-cup)'
      : slugDuplicate
        ? 'Такой slug уже занят'
        : null;

  const titleError = title.trim() === '' ? 'Название обязательно' : null;

  const mutation = useMutation({
    mutationFn: (payload: {
      slug: string;
      title: string;
      description?: string;
      scheduledAt?: string;
    }) => api.post<EventDto>('/v1/org/events', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-events'] });
      onClose();
    },
  });

  const canSubmit =
    trimmedSlug.length > 0 &&
    !slugError &&
    !titleError &&
    !mutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({
      slug: trimmedSlug,
      title: title.trim(),
      description: description.trim() || undefined,
      scheduledAt: scheduledAt
        ? new Date(scheduledAt).toISOString()
        : undefined,
    });
  }

  const errorMessage = mutation.error?.message ?? null;
  const conflict = errorMessage?.toLowerCase().includes('already taken');

  return (
    <ModalShell title="Новое событие" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Slug (часть URL)</label>
          <input
            autoFocus
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="spring-cup-2026"
            className={inputClasses}
            disabled={mutation.isPending}
          />
          {slugError ? (
            <p className="text-xs text-red-400">{slugError}</p>
          ) : (
            <p className="text-xs text-zinc-600">
              URL события:{' '}
              <span className="font-mono text-zinc-500">/event/&lt;org&gt;/{trimmedSlug || 'slug'}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Название</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Весенний турнир 2026"
            className={inputClasses}
            disabled={mutation.isPending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Описание (необязательно)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Краткое описание мероприятия для зрителей"
            className={`${inputClasses} resize-y min-h-[72px]`}
            disabled={mutation.isPending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-zinc-500">Старт (необязательно)</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className={inputClasses}
            disabled={mutation.isPending}
          />
          <p className="text-xs text-zinc-600">
            Запланированное время старта. Реальный старт — кнопкой «Старт» на карточке.
          </p>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <Warning size={14} className="shrink-0 mt-0.5" weight="fill" />
            <span>{conflict ? 'Slug уже занят в этой организации' : errorMessage}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Создание…' : 'Создать'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditEventModal({
  event: ev,
  onClose,
}: {
  event: EventDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Подгружаем детали (streams[]) — list endpoint их не отдаёт.
  const { data: detail } = useQuery({
    queryKey: ['org-event-detail', ev.id],
    queryFn: () => api.get<EventDetailDto>(`/v1/org/events/${ev.id}`),
  });

  // Все Stream'ы орги для multi-select. Фильтруем default Stream (slug='')?
  // Нет — default Stream тоже можно привязать к Event'у (это валидно по схеме).
  const { data: orgStreams } = useQuery({
    queryKey: ['org-streams-list'],
    queryFn: () => api.get<OrgStreamSummary[]>('/v1/org/streams'),
  });

  const [title, setTitle] = useState(ev.title);
  const [description, setDescription] = useState(ev.description ?? '');
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!ev.scheduledAt) return '';
    // datetime-local ожидает формат YYYY-MM-DDTHH:mm — преобразуем из ISO.
    const d = new Date(ev.scheduledAt);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const updateMutation = useMutation({
    mutationFn: (payload: {
      title?: string;
      description?: string | null;
      scheduledAt?: string | null;
    }) => api.patch<EventDto>(`/v1/org/events/${ev.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-events'] });
      qc.invalidateQueries({ queryKey: ['org-event-detail', ev.id] });
    },
  });

  const addStreamMutation = useMutation({
    mutationFn: (streamId: string) =>
      api.post<EventDetailDto>(`/v1/org/events/${ev.id}/streams`, { streamId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-event-detail', ev.id] });
      qc.invalidateQueries({ queryKey: ['org-event-stream-counts'] });
    },
  });

  const removeStreamMutation = useMutation({
    mutationFn: (streamId: string) =>
      api.delete<EventDetailDto>(`/v1/org/events/${ev.id}/streams/${streamId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-event-detail', ev.id] });
      qc.invalidateQueries({ queryKey: ['org-event-stream-counts'] });
    },
  });

  const titleDirty = title.trim() !== ev.title;
  const descDirty = (description.trim() || null) !== (ev.description ?? null);
  const dateDirty = (() => {
    if (!scheduledAt) return !!ev.scheduledAt;
    const next = new Date(scheduledAt).toISOString();
    return !ev.scheduledAt || next !== new Date(ev.scheduledAt).toISOString();
  })();
  const hasChanges = titleDirty || descDirty || dateDirty;
  const titleError = title.trim() === '' ? 'Название обязательно' : null;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!hasChanges || titleError || updateMutation.isPending) return;
    const payload: Record<string, unknown> = {};
    if (titleDirty) payload.title = title.trim();
    if (descDirty) payload.description = description.trim() || null;
    if (dateDirty) {
      payload.scheduledAt = scheduledAt
        ? new Date(scheduledAt).toISOString()
        : null;
    }
    updateMutation.mutate(payload);
  }

  const attachedIds = new Set(detail?.streams.map((s) => s.id) ?? []);
  const availableStreams = (orgStreams ?? []).filter(
    (s) => !attachedIds.has(s.id),
  );

  return (
    <ModalShell title={`Событие · ${ev.title}`} onClose={onClose} widthClass="max-w-xl">
      <div className="flex flex-col gap-6">
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-500">Название</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClasses}
              disabled={updateMutation.isPending}
            />
            {titleError && <p className="text-xs text-red-400">{titleError}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-500">Описание</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={`${inputClasses} resize-y min-h-[72px]`}
              disabled={updateMutation.isPending}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-zinc-500">Старт</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className={inputClasses}
              disabled={updateMutation.isPending}
            />
            <p className="text-xs text-zinc-600">
              Slug{' '}
              <span className="font-mono text-zinc-500">/{ev.slug}</span>{' '}
              изменить нельзя — это публичный URL.
            </p>
          </div>

          {updateMutation.error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              {updateMutation.error.message}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={!hasChanges || !!titleError || updateMutation.isPending}
              className="px-4 py-2 bg-brand hover:bg-brand-hover text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>

        {/* ── Streams ───────────────────────────────────────────────────── */}
        <div className="pt-4 border-t border-zinc-800/60 flex flex-col gap-3">
          <h4 className="flex items-center gap-2 text-sm font-medium text-zinc-300">
            <VideoCamera size={14} weight="fill" className="text-zinc-500" />
            Стримы события
            <span className="ml-auto text-xs text-zinc-600 font-mono tabular-nums">
              {detail?.streams.length ?? 0}
            </span>
          </h4>

          {/* Attached list */}
          {detail?.streams.length === 0 && (
            <p className="text-xs text-zinc-600">Стримы пока не привязаны.</p>
          )}
          <div className="flex flex-col gap-1.5">
            {detail?.streams.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-primary border border-zinc-800/40"
              >
                <span className="text-sm text-zinc-200 truncate flex-1">
                  {s.name?.trim() || (s.slug === '' ? 'Default' : s.slug)}
                </span>
                <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                  /{s.slug || 'default'}
                </span>
                {s.isLive && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand/15 border border-brand/30 text-brand text-[10px] font-medium shrink-0">
                    <span className="w-1 h-1 rounded-full bg-brand animate-pulse" />
                    LIVE
                  </span>
                )}
                <button
                  onClick={() => {
                    if (confirm(`Отвязать стрим «${s.name?.trim() || s.slug}» от события?`)) {
                      removeStreamMutation.mutate(s.id);
                    }
                  }}
                  disabled={removeStreamMutation.isPending}
                  aria-label="Отвязать стрим"
                  className="p-1 rounded-md text-zinc-500 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <X size={14} weight="bold" />
                </button>
              </div>
            ))}
          </div>

          {/* Add picker */}
          {availableStreams.length > 0 ? (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-zinc-800/40">
              <label className="text-xs text-zinc-500">Добавить стрим</label>
              <div className="flex gap-2 items-center">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) {
                      addStreamMutation.mutate(id);
                      e.target.value = '';
                    }
                  }}
                  disabled={addStreamMutation.isPending}
                  className={`${inputClasses} cursor-pointer`}
                >
                  <option value="" disabled>
                    Выберите стрим…
                  </option>
                  {availableStreams.map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.name?.trim() || (s.slug === '' ? 'Default' : s.slug)) +
                        (s.slug ? ` (/${s.slug})` : ' (default)')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-600 pt-2 border-t border-zinc-800/40">
              Все стримы орги уже привязаны.
            </p>
          )}

          {(addStreamMutation.error || removeStreamMutation.error) && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
              {(addStreamMutation.error ?? removeStreamMutation.error)?.message}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function DeleteEventModal({
  event: ev,
  onClose,
}: {
  event: EventDto;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.delete(`/v1/org/events/${ev.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-events'] });
      onClose();
    },
  });

  return (
    <ModalShell title="Удалить событие?" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <Warning size={18} weight="fill" className="shrink-0 text-red-400 mt-0.5" />
          <div className="text-sm text-zinc-200">
            Событие <span className="font-semibold">«{ev.title}»</span> будет удалено.
            Стримы и записи останутся, но потеряют связь с этим событием, а сообщения
            event-чата будут удалены без возможности восстановления.
          </div>
        </div>

        {mutation.error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            {mutation.error.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
          >
            {mutation.isPending ? 'Удаление…' : 'Удалить'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
