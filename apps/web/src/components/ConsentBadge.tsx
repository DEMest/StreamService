'use client';
import { ShieldCheck, ShieldWarning } from '@phosphor-icons/react';

interface Props {
  consentAt: string | null;
  consentVersion: string | null;
}

/**
 * Отметка о согласии на обработку персональных данных в админских списках.
 * Хранить согласие и нигде его не показывать бессмысленно: смысл записи в том,
 * чтобы на запрос субъекта или проверяющего можно было ответить конкретной
 * датой и редакцией политики.
 */
export function ConsentBadge({ consentAt, consentVersion }: Props) {
  if (!consentAt) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] text-zinc-600"
        title="Обращение принято до того, как в форме появилась отметка о согласии"
      >
        <ShieldWarning size={12} />
        согласие не зафиксировано
      </span>
    );
  }

  const date = new Date(consentAt).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600">
      <ShieldCheck size={12} className="text-emerald-600/70" />
      согласие от {date}
      {consentVersion && <span className="font-mono text-zinc-700">ред. {consentVersion}</span>}
    </span>
  );
}
