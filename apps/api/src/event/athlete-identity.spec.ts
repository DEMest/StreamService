import { athleteIdentityKey } from './athlete-identity';

const IVANOV = { lastName: 'Иванов', firstName: 'Иван', birthYear: 2012, school: 'Барс' };

describe('athleteIdentityKey', () => {
  it('один и тот же человек из разных списков даёт один ключ', () => {
    const key = athleteIdentityKey(IVANOV);
    expect(athleteIdentityKey({ ...IVANOV, lastName: '  ИВАНОВ ' })).toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, firstName: 'иван' })).toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, school: 'барс  ' })).toBe(key);
  });

  it('«ё» и «е» не различаются', () => {
    expect(athleteIdentityKey({ lastName: 'Фёдоров', firstName: 'Пётр' })).toBe(
      athleteIdentityKey({ lastName: 'Федоров', firstName: 'Петр' }),
    );
  });

  it('название школы: пробелы, кавычки и пробел после «№» не различаются', () => {
    const key = athleteIdentityKey({ ...IVANOV, school: 'СШОР №3 «Барс»' });
    expect(athleteIdentityKey({ ...IVANOV, school: 'сшор   № 3  "Барс"' })).toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, school: 'СШОР №3 Барс' })).toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, school: 'СШОР №3 “Барс”' })).toBe(key);
  });

  it('двойная фамилия: вид тире и пробелы вокруг дефиса не различаются', () => {
    const key = athleteIdentityKey({ lastName: 'Петров-Водкин', firstName: 'Кузьма' });
    expect(athleteIdentityKey({ lastName: 'Петров - Водкин', firstName: 'Кузьма' })).toBe(key);
    expect(athleteIdentityKey({ lastName: 'Петров\u2013Водкин', firstName: 'Кузьма' })).toBe(key);
    expect(athleteIdentityKey({ lastName: 'Петров \u2014 Водкин', firstName: 'Кузьма' })).toBe(key);
  });

  it('невидимые символы из таблиц не меняют ключ', () => {
    expect(athleteIdentityKey({ ...IVANOV, lastName: 'Ива\u200Bнов\uFEFF' })).toBe(athleteIdentityKey(IVANOV));
    expect(athleteIdentityKey({ ...IVANOV, firstName: 'И\u00ADван' })).toBe(athleteIdentityKey(IVANOV));
  });

  it('однофамильцы из разных школ и разных годов — разные люди', () => {
    const key = athleteIdentityKey(IVANOV);
    expect(athleteIdentityKey({ ...IVANOV, school: 'Динамо' })).not.toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, birthYear: 2013 })).not.toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, firstName: 'Илья' })).not.toBe(key);
  });

  it('латинская буква-двойник даёт другой ключ: склейка хуже дубля', () => {
    expect(athleteIdentityKey({ ...IVANOV, lastName: 'Иванoв' })).not.toBe(athleteIdentityKey(IVANOV));
  });

  it('неуказанные год и школа — часть ключа, а не «подходит любой»', () => {
    const bare = athleteIdentityKey({ lastName: 'Иванов', firstName: 'Иван' });
    expect(bare).not.toBe(athleteIdentityKey(IVANOV));
    expect(athleteIdentityKey({ lastName: 'Иванов', firstName: 'Иван', birthYear: null, school: null })).toBe(bare);
    expect(athleteIdentityKey({ lastName: 'Иванов', firstName: 'Иван', school: '   ' })).toBe(bare);
  });

  it('поля не перетекают друг в друга через разделитель', () => {
    expect(athleteIdentityKey({ lastName: 'а|б', firstName: 'в' })).not.toBe(
      athleteIdentityKey({ lastName: 'а', firstName: 'б|в' }),
    );
    expect(athleteIdentityKey({ lastName: 'Иванов', firstName: 'Иван', school: '2012' })).not.toBe(
      athleteIdentityKey({ lastName: 'Иванов', firstName: 'Иван', birthYear: 2012 }),
    );
  });

  it('без фамилии ключа нет: безымянные не должны схлопнуться в одного', () => {
    expect(() => athleteIdentityKey({ lastName: '', firstName: 'Иван' })).toThrow('нет фамилии');
    expect(() => athleteIdentityKey({ lastName: ' \u200B ', firstName: '' })).toThrow('нет фамилии');
    expect(() => athleteIdentityKey({ lastName: 'Иванов', firstName: '' })).not.toThrow();
  });
});
