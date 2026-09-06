'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { PublicLayout } from '@/components/PublicLayout';
import { ImageCropModal } from '@/components/ImageCropModal';
import { readImageSize } from '@/lib/crop';
import { adGradient, adInitials } from '@/lib/ad-fallback';
import type { AdminAd, AdStats } from '@/lib/types';
import {
  ArrowLeft, Megaphone, Plus, Trash, PencilSimple, ChartBar, X, Image as ImageIcon,
  Pause, Play,
} from '@phosphor-icons/react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/**
 * Ожидаемый размер под плейсмент — стандартные IAB-форматы (рекламодатели
 * присылают готовые баннеры под них). Присланный баннер не всегда будет
 * ровно нужного соотношения, поэтому при загрузке админ сам выбирает область
 * через ImageCropModal — то же окно, что у превью организации/стрима, но со
 * своим соотношением сторон под плейсмент. После этого сервер только
 * вписывает результат без дальнейшей обрезки (fit: contain, см. AdsService),
 * а на публичных страницах баннер просто масштабируется с сохранением
 * пропорций внутри своего блока — одинаково на телефоне и на десктопе.
 * `outputWidth`/`outputHeight` должны совпадать с PLACEMENT_IMAGE_SIZE в
 * apps/api/src/ads/ads.service.ts.
 */
const AD_IMAGE_SPECS: Record<'watch' | 'catalog', {
  aspect: number; outputWidth: number; outputHeight: number; label: string; description: string;
}> = {
  watch: {
    aspect: 300 / 250,
    outputWidth: 300,
    outputHeight: 250,
    label: '300 × 250 px (Medium Rectangle)',
    description: 'Небольшой почти квадратный баннер для оверлея поверх видео — выберите область 300×250.',
  },
  catalog: {
    aspect: 728 / 90,
    outputWidth: 728,
    outputHeight: 90,
    label: '728 × 90 px (Leaderboard)',
    description: 'Широкая полоса над списком трансляций — выберите область 728×90.',
  },
};

interface AdFormValues {
  title: string;
  subtitle: string;
  targetUrl: string;
}

const EMPTY_FORM: AdFormValues = { title: '', subtitle: '', targetUrl: '' };

export default function AdminAdsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [statsId, setStatsId] = useState<string | null>(null);

  const { data: ads, isLoading } = useQuery({
    queryKey: ['admin-ads'],
    queryFn: () => api.get<AdminAd[]>('/v1/admin/ads'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-ads'] });

  const createMutation = useMutation({
    mutationFn: (data: AdFormValues) =>
      api.post<AdminAd>('/v1/admin/ads', { ...data, subtitle: data.subtitle || undefined }),
    onSuccess: () => { setShowCreate(false); invalidate(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AdFormValues> & { isActive?: boolean } }) =>
      api.patch(`/v1/admin/ads/${id}`, data),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/admin/ads/${id}`),
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
          <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">Реклама</h1>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none"
          >
            <Plus size={16} weight="bold" /> Новое объявление
          </button>
        </div>

        {showCreate && (
          <AdForm
            initial={EMPTY_FORM}
            pending={createMutation.isPending}
            error={createMutation.error?.message}
            onCancel={() => setShowCreate(false)}
            onSubmit={(data) => createMutation.mutate(data)}
            submitLabel="Создать"
          />
        )}

        {isLoading && <div className="text-sm text-zinc-500 py-12 text-center">Загрузка...</div>}

        <div className="flex flex-col gap-3">
          {ads?.map((ad) => (
            <AdRow
              key={ad.id}
              ad={ad}
              editing={editingId === ad.id}
              statsOpen={statsId === ad.id}
              onToggleEdit={() => setEditingId(editingId === ad.id ? null : ad.id)}
              onToggleStats={() => setStatsId(statsId === ad.id ? null : ad.id)}
              onSaveEdit={(data) => { updateMutation.mutate({ id: ad.id, data }); setEditingId(null); }}
              onToggleActive={() => updateMutation.mutate({ id: ad.id, data: { isActive: !ad.isActive } })}
              onDelete={() => {
                if (confirm(`Удалить «${ad.title}» вместе с картинками безвозвратно?\n\nЕсли рекламодатель может вернуться позже — используйте «Приостановить» вместо удаления.`)) {
                  deleteMutation.mutate(ad.id);
                }
              }}
              onImagesChanged={invalidate}
            />
          ))}

          {!isLoading && ads?.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2 opacity-40">
              <Megaphone size={32} className="text-zinc-700" weight="thin" />
              <span className="text-sm text-zinc-500">Объявлений пока нет</span>
            </div>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

// ─── Строка объявления ──────────────────────────────────────────────────────

function AdRow({
  ad,
  editing,
  statsOpen,
  onToggleEdit,
  onToggleStats,
  onSaveEdit,
  onToggleActive,
  onDelete,
  onImagesChanged,
}: {
  ad: AdminAd;
  editing: boolean;
  statsOpen: boolean;
  onToggleEdit: () => void;
  onToggleStats: () => void;
  onSaveEdit: (data: AdFormValues) => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onImagesChanged: () => void;
}) {
  return (
    <div className={`bg-surface-elevated border rounded-xl p-5 ${ad.isActive ? 'border-zinc-800/50' : 'border-zinc-800/30 opacity-60'}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-14 h-10 rounded-lg shrink-0 flex items-center justify-center text-white font-bold text-sm overflow-hidden bg-surface-primary"
            style={ad.imagePathWatch ? undefined : { background: adGradient(ad.id) }}
          >
            {ad.imagePathWatch ? (
              <img src={`${API_BASE}/v1/public/ads/${ad.id}/image/watch`} alt="" className="w-full h-full object-contain" />
            ) : (
              adInitials(ad.title)
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-zinc-100 truncate">{ad.title}</div>
            <a href={ad.targetUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-brand no-underline truncate block">
              {ad.targetUrl}
            </a>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] uppercase tracking-wider font-mono px-2 py-0.5 rounded-full ${
              ad.isActive ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            {ad.isActive ? 'Показывается' : 'На паузе'}
          </span>
        </div>
      </div>

      {ad.subtitle && <p className="text-sm text-zinc-400 mb-4">{ad.subtitle}</p>}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <AdImageSlot ad={ad} placement="watch" label="Баннер для плеера" onChanged={onImagesChanged} />
        <AdImageSlot ad={ad} placement="catalog" label="Баннер для каталога" onChanged={onImagesChanged} />
      </div>

      {editing && (
        <AdForm
          initial={{ title: ad.title, subtitle: ad.subtitle ?? '', targetUrl: ad.targetUrl }}
          onCancel={onToggleEdit}
          onSubmit={onSaveEdit}
          submitLabel="Сохранить"
        />
      )}

      {statsOpen && <AdStatsPanel adId={ad.id} />}

      <div className="flex gap-2 justify-end mt-2 flex-wrap">
        <button
          onClick={onToggleActive}
          title={ad.isActive ? 'Скрыть от зрителей, не удаляя — можно будет включить снова в любой момент' : 'Показывать зрителям снова'}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none ${
            ad.isActive
              ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400'
          }`}
        >
          {ad.isActive ? <Pause size={12} /> : <Play size={12} />}
          {ad.isActive ? 'Приостановить' : 'Возобновить показ'}
        </button>
        <button
          onClick={onToggleStats}
          className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none"
        >
          <ChartBar size={12} /> Статистика
        </button>
        <button
          onClick={onToggleEdit}
          className="flex items-center gap-1 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none"
        >
          <PencilSimple size={12} /> {editing ? 'Отменить' : 'Изменить'}
        </button>
        <button
          onClick={onDelete}
          title="Удаляет объявление и обе картинки безвозвратно — для временной остановки используйте «Приостановить»"
          className="flex items-center gap-1 px-3 py-1.5 bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 text-xs font-medium rounded-lg transition-all duration-200 active:scale-[0.98] cursor-pointer border-none"
        >
          <Trash size={12} /> Удалить навсегда
        </button>
      </div>
    </div>
  );
}

// ─── Картинка под конкретный плейсмент ──────────────────────────────────────

function AdImageSlot({
  ad,
  placement,
  label,
  onChanged,
}: {
  ad: AdminAd;
  placement: 'watch' | 'catalog';
  label: string;
  onChanged: () => void;
}) {
  const hasImage = placement === 'watch' ? !!ad.imagePathWatch : !!ad.imagePathCatalog;
  const [bump, setBump] = useState(0);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const spec = AD_IMAGE_SPECS[placement];

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/v1/admin/ads/${ad.id}/image/${placement}`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Не удалось загрузить' }));
        throw new Error(err.message ?? 'Не удалось загрузить');
      }
      return res.json();
    },
    onSuccess: () => { setBump(Date.now()); onChanged(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/v1/admin/ads/${ad.id}/image/${placement}`),
    onSuccess: onChanged,
  });

  return (
    <div className="border border-zinc-800/60 rounded-lg p-2.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-zinc-500">{label} — {spec.label}</span>
        {hasImage && (
          <button
            onClick={() => deleteMutation.mutate()}
            className="text-zinc-600 hover:text-red-400 border-none bg-transparent cursor-pointer"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {hasImage ? (
        <img
          src={`${API_BASE}/v1/public/ads/${ad.id}/image/${placement}?t=${bump}`}
          alt=""
          // object-contain, не cover: это готовый баннер рекламодателя, обрезать
          // его в превью нельзя — иначе админ не увидит, что реально уйдёт зрителю.
          className="w-full rounded-md object-contain bg-surface-primary"
          style={{ aspectRatio: spec.aspect }}
        />
      ) : (
        <div
          className="w-full rounded-md bg-surface-primary border border-dashed border-zinc-800 flex items-center justify-center"
          style={{ aspectRatio: spec.aspect }}
        >
          <ImageIcon size={20} className="text-zinc-700" weight="thin" />
        </div>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;

          if (file.type === 'image/gif') {
            // GIF — сразу на сервер: canvas-кроппер умеет только один кадр,
            // а обрезать анимацию по кадрам мы не беремся (см. AdsService).
            uploadMutation.mutate(file);
            return;
          }

          try {
            const { width, height } = await readImageSize(file);
            if (width / height >= spec.aspect) {
              // Баннер уже не уже целевого соотношения — кроп не нужен,
              // сервер только слегка подожмёт высоту (fit: contain), без
              // пустых полей по бокам, как было бы с квадратным/портретным.
              uploadMutation.mutate(file);
            } else {
              setCropFile(file);
            }
          } catch {
            // Не смогли прочитать размеры (битый файл и т.п.) — пусть кроп
            // сам покажет ошибку, хуже он в этом случае не сделает.
            setCropFile(file);
          }
        }}
        className="mt-2 text-[10px] text-zinc-500 file:mr-2 file:px-2 file:py-1 file:bg-zinc-800 file:hover:bg-zinc-700 file:text-zinc-200 file:text-[10px] file:font-medium file:rounded file:border-0 file:cursor-pointer cursor-pointer w-full"
      />
      {uploadMutation.isPending && <p className="text-[10px] text-zinc-500 mt-1">Загрузка...</p>}
      {uploadMutation.isError && <p className="text-[10px] text-red-400 mt-1">{uploadMutation.error?.message}</p>}
      <p className="text-[10px] text-zinc-600 mt-1">
        {hasImage ? spec.label : `Готовый баннер ${spec.label}. Без картинки — градиент с инициалами.`}
        {' '}Достаточно широкий баннер загрузится сразу, более квадратный или вертикальный — попросим выбрать область.
        GIF — всегда сразу, без кропа: подготовьте нужный размер заранее.
      </p>

      {cropFile && (
        <ImageCropModal
          file={cropFile}
          title={label}
          aspect={spec.aspect}
          outputWidth={spec.outputWidth}
          outputHeight={spec.outputHeight}
          description={spec.description}
          onCancel={() => setCropFile(null)}
          onApply={(cropped) => { setCropFile(null); uploadMutation.mutate(cropped); }}
        />
      )}
    </div>
  );
}

// ─── Форма создания/редактирования ──────────────────────────────────────────

function AdForm({
  initial,
  pending,
  error,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  initial: AdFormValues;
  pending?: boolean;
  error?: string;
  submitLabel: string;
  onCancel: () => void;
  onSubmit: (data: AdFormValues) => void;
}) {
  const [values, setValues] = useState(initial);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
      className="bg-surface-elevated border border-zinc-800 rounded-xl p-5 mb-6 flex flex-col gap-3"
    >
      <input
        value={values.title}
        onChange={(e) => setValues((v) => ({ ...v, title: e.target.value }))}
        placeholder="Заголовок"
        required
        className="bg-surface-primary border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
      />
      <input
        value={values.subtitle}
        onChange={(e) => setValues((v) => ({ ...v, subtitle: e.target.value }))}
        placeholder="Заметка для себя (необязательно, зрителям не показывается — весь текст уже в баннере)"
        className="bg-surface-primary border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
      />
      <input
        value={values.targetUrl}
        onChange={(e) => setValues((v) => ({ ...v, targetUrl: e.target.value }))}
        placeholder="https://ссылка-рекламодателя.ru"
        required
        type="url"
        className="bg-surface-primary border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg cursor-pointer border-none"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg cursor-pointer border-none disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// ─── Статистика назойливости ────────────────────────────────────────────────

function AdStatsPanel({ adId }: { adId: string }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin-ads-stats', adId],
    queryFn: () => api.get<AdStats>(`/v1/admin/ads/${adId}/stats`),
  });

  if (isLoading) return <div className="text-xs text-zinc-500 py-3">Загрузка статистики...</div>;
  if (!stats) return null;

  const reasonEntries = Object.entries(stats.reasons);

  return (
    <div className="bg-surface-primary border border-zinc-800/60 rounded-lg p-4 mb-2 flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Показов" value={stats.impressions} />
        <Stat label="Закрыто" value={stats.dismissed} />
        <Stat label="Навязчивость" value={`${Math.round(stats.dismissRate * 100)}%`} />
      </div>
      {(reasonEntries.length > 0 || stats.dismissTimeout > 0 || stats.dismissNoReason > 0) && (
        <div className="flex flex-wrap gap-1.5 pt-2 border-t border-zinc-800/60">
          {reasonEntries.map(([reason, count]) => (
            <span key={reason} className="text-[11px] text-zinc-300 bg-zinc-800 px-2 py-1 rounded-full">
              {reason} · {count}
            </span>
          ))}
          {stats.dismissNoReason > 0 && (
            <span className="text-[11px] text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded-full">
              Без причины · {stats.dismissNoReason}
            </span>
          )}
          {stats.dismissTimeout > 0 && (
            <span className="text-[11px] text-zinc-500 bg-zinc-800/40 px-2 py-1 rounded-full">
              Досмотрели до конца · {stats.dismissTimeout}
            </span>
          )}
        </div>
      )}
      {stats.impressions === 0 && (
        <p className="text-xs text-zinc-600">Показов ещё не было — данные появятся после первого выхода в ротацию.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-lg font-semibold text-zinc-100 tabular-nums">{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}
