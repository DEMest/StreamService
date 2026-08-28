import Link from 'next/link';
import { FOOTER_NAV_LINKS, LEGAL, LEGAL_LINKS } from '@/lib/legal';

/**
 * Футер с правовым блоком. На страницу просмотра он намеренно не ставится:
 * там раскладка ровно в высоту экрана (h-screen / 100dvh), и любая строка внизу
 * отъедала бы высоту у видео, а в полноэкранном режиме была бы просто лишней.
 */
export function Footer({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const year = new Date().getFullYear();

  if (variant === 'compact') {
    return (
      <footer className="border-t border-zinc-800/40 py-4 shrink-0">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[11px] text-zinc-600">
            © {year} {LEGAL.siteName}
          </span>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[11px] text-zinc-600 hover:text-zinc-400 no-underline transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </footer>
    );
  }

  return (
    <footer className="border-t border-zinc-800/40 mt-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] gap-8">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-zinc-300 tracking-tight">{LEGAL.siteName}</span>
          <p className="text-xs leading-relaxed text-zinc-600 max-w-xs">
            Права на трансляции и записи принадлежат организациям, которые их проводят.
            Копирование и ретрансляция без их разрешения запрещены.
          </p>
          <span className="text-xs text-zinc-700 mt-1">
            © {year} {LEGAL.siteName}. Все права защищены.
          </span>
        </div>

        <nav aria-label="Разделы сайта" className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Разделы</span>
          {FOOTER_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-zinc-500 hover:text-zinc-300 no-underline transition-colors w-fit"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <nav aria-label="Правовая информация" className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-wider text-zinc-600 mb-1">Документы</span>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs text-zinc-500 hover:text-zinc-300 no-underline transition-colors w-fit"
            >
              {link.label}
            </Link>
          ))}
          <a
            href={`mailto:${LEGAL.email}`}
            className="text-xs text-zinc-500 hover:text-zinc-300 no-underline transition-colors w-fit mt-1"
          >
            {LEGAL.email}
          </a>
        </nav>
      </div>
    </footer>
  );
}
