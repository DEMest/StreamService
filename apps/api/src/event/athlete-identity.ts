/**
 * Как одного спортсмена узнают в разных турнирах организации.
 *
 * Пока у участников нет своих аккаунтов, спортсмен — строка `Athlete` уровня
 * организации, и схватки разных турниров сходятся на одну страницу спортсмена
 * только если каждый раз находится та же строка. Находит её
 * `@@unique([orgId, identityKey])`, а ключ считает эта функция — и только она:
 * второй способ собрать ключ (в SQL, в сиде, в импорте из таблицы) рано или
 * поздно разойдётся с этим и заведёт человеку вторую страницу.
 *
 * Правило: фамилия, имя, год рождения и школа должны совпасть. Регистр,
 * лишние пробелы и «ё»/«е» не различаются — в списках, которые организаторы
 * грузят из таблиц, один и тот же человек записан то «Фёдоров», то «ФЕДОРОВ ».
 *
 * Год и школа участвуют в ключе, даже когда не указаны: «Иванов Иван» без
 * школы и «Иванов Иван» из «Барса» — два разных спортсмена. Склеить
 * однофамильцев хуже, чем завести одному человеку две страницы: чужие схватки
 * на странице ребёнка заметят сразу, а дубль объединяется руками.
 *
 * Менять правило можно только вместе с пересчётом `identityKey` у уже
 * заведённых строк (data-скрипт в `prisma/data/`).
 */
export interface AthleteIdentity {
  lastName: string;
  firstName: string;
  birthYear?: number | null;
  school?: string | null;
}

const SEPARATOR = '|';

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    // Разделитель внутри значения склеил бы «a|b» + «c» с «a» + «b|c».
    .split(SEPARATOR)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function athleteIdentityKey(athlete: AthleteIdentity): string {
  return [
    normalize(athlete.lastName),
    normalize(athlete.firstName),
    athlete.birthYear == null ? '' : String(athlete.birthYear),
    normalize(athlete.school),
  ].join(SEPARATOR);
}
