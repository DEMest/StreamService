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

  it('лишние пробелы внутри названия школы схлопываются', () => {
    expect(athleteIdentityKey({ ...IVANOV, school: 'Школа   №3' })).toBe(
      athleteIdentityKey({ ...IVANOV, school: 'школа №3' }),
    );
  });

  it('однофамильцы из разных школ и разных годов — разные люди', () => {
    const key = athleteIdentityKey(IVANOV);
    expect(athleteIdentityKey({ ...IVANOV, school: 'Динамо' })).not.toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, birthYear: 2013 })).not.toBe(key);
    expect(athleteIdentityKey({ ...IVANOV, firstName: 'Илья' })).not.toBe(key);
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
});
