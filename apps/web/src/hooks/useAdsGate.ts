'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { PublicAd } from '@/lib/types';

interface Me { sub: string; role: string; orgSlug?: string }

/**
 * Общий гейт для рекламных плейсхолдеров: список объявлений тянется только
 * после того, как известна роль зрителя. Без этого до ответа /v1/auth/me
 * организация могла бы на миг увидеть баннер, а в статистику улетел бы
 * фантомный impression с сессии, которая рекламу не должна видеть.
 */
export function useAdsGate() {
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/v1/auth/me'),
    retry: false,
  });
  const isOrgOrSuperadmin = me?.role === 'org_admin' || me?.role === 'superadmin';

  const { data: ads } = useQuery({
    queryKey: ['public-ads'],
    queryFn: () => api.get<PublicAd[]>('/v1/public/ads'),
    enabled: !meLoading && !isOrgOrSuperadmin,
    staleTime: 60_000,
  });

  return { isOrgOrSuperadmin, ads };
}
