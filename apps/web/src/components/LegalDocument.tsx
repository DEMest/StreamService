import { LEGAL } from '@/lib/legal';
import type { LegalBlock, LegalDoc } from '@/lib/legal-content/types';

/** Абзацы и списки правового текста. Общие для документов и для FAQ. */
export function LegalBlocks({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (typeof block === 'string') {
          return (
            <p key={i} className="text-sm leading-relaxed text-zinc-400">
              {block}
            </p>
          );
        }
        if ('ordered' in block) {
          return (
            <ol key={i} className="flex flex-col gap-2 pl-5 list-decimal marker:text-zinc-600">
              {block.ordered.map((item, j) => (
                <li key={j} className="text-sm leading-relaxed text-zinc-400 pl-1">
                  {item}
                </li>
              ))}
            </ol>
          );
        }
        return (
          <ul key={i} className="flex flex-col gap-2 pl-5 list-disc marker:text-zinc-600">
            {block.list.map((item, j) => (
              <li key={j} className="text-sm leading-relaxed text-zinc-400 pl-1">
                {item}
              </li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

/**
 * Общий вид для всех трёх правовых документов: заголовок, редакция, оглавление
 * и разделы с якорями. Оглавление собирается из тех же данных, что и текст, —
 * разъехаться с ним оно не может.
 */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <div className="max-w-[1000px] mx-auto px-6 py-12 md:py-16">
      <header className="mb-10">
        <h1 className="text-2xl md:text-3xl font-bold text-zinc-50 tracking-tight leading-tight mb-3">
          {doc.title}
        </h1>
        <p className="text-xs text-zinc-600">Редакция от {LEGAL.versionLabel}</p>
        {doc.intro && (
          <p className="mt-5 text-sm leading-relaxed text-zinc-400 max-w-[65ch]">{doc.intro}</p>
        )}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] lg:gap-12 items-start">
        <article className="flex flex-col gap-10 order-2 lg:order-1 max-w-[70ch]">
          {doc.sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20 flex flex-col gap-3">
              <h2 className="text-base font-semibold text-zinc-100">{section.title}</h2>
              <LegalBlocks blocks={section.blocks} />
            </section>
          ))}
        </article>

        <nav
          aria-label="Содержание документа"
          className="order-1 lg:order-2 mb-10 lg:mb-0 lg:sticky lg:top-20 bg-surface-elevated border border-zinc-800/60 rounded-xl p-4"
        >
          <p className="text-[11px] uppercase tracking-wider text-zinc-600 mb-3">Содержание</p>
          <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="text-xs leading-snug text-zinc-500 hover:text-zinc-300 no-underline transition-colors"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
