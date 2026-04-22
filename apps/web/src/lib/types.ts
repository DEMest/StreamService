export interface CatalogOrg {
  slug: string;
  name: string;
  isLive: boolean;
  streamTitle: string;
  previewMode: string;
  hasCustomPreview: boolean;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
