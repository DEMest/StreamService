import { BadRequestException } from '@nestjs/common';

/** Длина метки редакции: '2026-08-28' плюс запас на другой формат в будущем. */
export const CONSENT_VERSION_MAX = 32;

export interface ConsentInput {
  consent?: boolean;
  consentVersion?: string;
}

export interface ConsentRecord {
  consentAt: Date;
  consentVersion: string;
}

/**
 * Проверяет согласие на обработку персональных данных и возвращает то, что
 * ложится в базу рядом с обращением.
 *
 * Проверка именно на сервере: галочка в браузере доказывает только то, что
 * форма отрисовалась. Согласие по 152-ФЗ должно быть подтверждаемым, а
 * подтвердить его можно лишь записью на нашей стороне.
 *
 * Редакцию присылает клиент, а не подставляет сервер из своей константы. Это
 * не мелочь: человек соглашается с тем текстом, который видел у себя на экране,
 * а закешированная страница вполне может отставать от свежего деплоя. Сервер
 * зафиксирует расхождение, подмена его скрыла бы.
 */
export function requireConsent(input: ConsentInput | undefined): ConsentRecord {
  // Текст с подсказкой про перезагрузку не про формальность: сразу после
  // выкатки вкладка, открытая до неё, крутит старый бандл без галочки и шлёт
  // запрос без согласия. Человек в этот момент видит форму, где соглашаться
  // было негде, и «требуется согласие» без объяснения выглядит поломкой.
  if (input?.consent !== true) {
    throw new BadRequestException(
      'Требуется согласие на обработку персональных данных. Если отметки в форме нет — обновите страницу.',
    );
  }

  const version = input.consentVersion?.trim();
  if (!version) {
    throw new BadRequestException('Не указана редакция политики конфиденциальности');
  }
  if (version.length > CONSENT_VERSION_MAX) {
    throw new BadRequestException('Некорректная редакция политики конфиденциальности');
  }

  return { consentAt: new Date(), consentVersion: version };
}
