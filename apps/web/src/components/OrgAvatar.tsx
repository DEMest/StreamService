'use client';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/types';

/**
 * Палитра фолбэк-монограммы. Цвет выбирается детерминированно по `orgSlug`,
 * чтобы у одной и той же орги он был одинаковым на всех страницах и не
 * «прыгал» между рендерами. Оттенки подобраны под тёмный фон и намеренно
 * уводят от брендового красного (#E54433) — иначе монограмма читается как
 * live-индикатор.
 */
const MONOGRAM_COLORS: Array<[string, string]> = [
  ['#2E6F7E', '#1B3F4C'],
  ['#4A5B8C', '#28324F'],
  ['#6B5B95', '#3A3154'],
  ['#3F7A5E', '#234436'],
  ['#8A6A3D', '#4C3A21'],
  ['#7A4E6B', '#45293C'],
  ['#456C8A', '#26404F'],
  ['#5E7343', '#353F26'],
];

function paletteIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % MONOGRAM_COLORS.length;
}

interface OrgAvatarProps {
  orgSlug: string;
  orgName?: string;
  /** Есть ли у орги загруженная картинка (`/v1/public/orgs/:slug/image`). */
  hasImage?: boolean;
  /** Диаметр в пикселях. */
  size?: number;
  /** Обвести брендовым кольцом — орга сейчас в эфире. */
  live?: boolean;
  className?: string;
}

/**
 * Круглый аватар организации: загруженная картинка орги, кадрированная по
 * центру, либо монограмма-фолбэк.
 *
 * Картинка орги (`imagePath`) заведена как широкое превью 16:9 для карточек
 * каталога, поэтому здесь она принудительно кадрируется `object-cover` —
 * отдельного квадратного логотипа у организации пока нет.
 *
 * Элемент декоративный (`aria-hidden`): название организации во всех местах
 * использования стоит рядом текстом, дублировать его для скринридера незачем.
 */
export function OrgAvatar({
  orgSlug,
  orgName,
  hasImage = false,
  size = 32,
  live = false,
  className = '',
}: OrgAvatarProps) {
  const [failed, setFailed] = useState(false);

  // Орга сменилась (или картинку загрузили) — даём <img> ещё одну попытку.
  useEffect(() => { setFailed(false); }, [orgSlug, hasImage]);

  const showImage = hasImage && !failed;
  const [from, to] = MONOGRAM_COLORS[paletteIndex(orgSlug)];
  const letter = (orgName?.trim() || orgSlug).charAt(0).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={`shrink-0 inline-flex items-center justify-center rounded-full overflow-hidden select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: showImage ? '#18181B' : `linear-gradient(140deg, ${from} 0%, ${to} 100%)`,
        boxShadow: live ? '0 0 0 1.5px #E54433' : '0 0 0 1px rgba(255,255,255,0.14)',
      }}
    >
      {showImage ? (
        <img
          src={`${API_BASE}/v1/public/orgs/${orgSlug}/image`}
          alt=""
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span
          className="font-semibold text-white leading-none"
          style={{ fontSize: Math.round(size * 0.42) }}
        >
          {letter}
        </span>
      )}
    </span>
  );
}
