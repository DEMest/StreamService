import { Test } from '@nestjs/testing';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import {
  FeedbackService,
  RATE_GLOBAL,
  RATE_PER_IP,
  letter,
} from './feedback.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';

const mockPrisma = {
  feedback: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};
const mockMail = { send: jest.fn() };

const CONSENT = { consent: true, consentVersion: '2026-08-28' };
const VALID = {
  topic: 'Видео тормозит',
  message: 'Всё время буферизация на телефоне',
  ...CONSENT,
};

describe('FeedbackService', () => {
  let service: FeedbackService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.feedback.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'fb1', createdAt: new Date('2026-08-26T10:00:00.000Z'), ...data }),
    );
    mockMail.send.mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get(FeedbackService);
  });

  describe('honeypot', () => {
    it('молча глотает обращение с заполненным полем-ловушкой', async () => {
      const res = await service.create({ ...VALID, website: 'http://spam.example' });

      expect(res.ok).toBe(true);
      expect(res.id).toBeNull();
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled();
      expect(mockMail.send).not.toHaveBeenCalled();
    });

    it('пустая строка в ловушке — обычный человек, обращение принимается', async () => {
      await service.create({ ...VALID, website: '   ' });
      expect(mockPrisma.feedback.create).toHaveBeenCalled();
    });

    it('не тратит квоту на ботов', async () => {
      for (let i = 0; i < RATE_PER_IP * 3; i++) {
        await service.create({ ...VALID, website: 'bot' }, { ip: '1.1.1.1' });
      }
      // Живой человек с того же адреса всё ещё проходит
      await expect(service.create(VALID, { ip: '1.1.1.1' })).resolves.toMatchObject({ ok: true });
    });
  });

  describe('согласие на обработку данных', () => {
    it('отвергает обращение без согласия', async () => {
      const { consent, ...withoutConsent } = VALID;
      await expect(service.create(withoutConsent)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ ...VALID, consent: false })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.feedback.create).not.toHaveBeenCalled();
    });

    it('отвергает согласие без указания редакции политики', async () => {
      await expect(service.create({ ...VALID, consentVersion: '  ' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.create({ ...VALID, consentVersion: 'v'.repeat(33) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('сохраняет момент согласия и редакцию, которую видел человек', async () => {
      await service.create({ ...VALID, consentVersion: '2026-08-28' });

      const { data } = mockPrisma.feedback.create.mock.calls[0][0];
      expect(data.consentVersion).toBe('2026-08-28');
      expect(data.consentAt).toBeInstanceOf(Date);
    });

    it('отказ по согласию не сжигает квоту адреса', async () => {
      for (let i = 0; i < RATE_PER_IP * 2; i++) {
        await expect(
          service.create({ ...VALID, consent: false }, { ip: '1.1.1.1' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(service.create(VALID, { ip: '1.1.1.1' })).resolves.toMatchObject({ ok: true });
    });

    it('бот с ловушкой отсекается раньше проверки согласия', async () => {
      const res = await service.create({ ...VALID, consent: false, website: 'http://spam.example' });
      expect(res).toMatchObject({ ok: true, id: null });
    });
  });

  describe('валидация полей', () => {
    it('отвергает слишком короткую тему', async () => {
      await expect(service.create({ ...VALID, topic: 'ой' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('отвергает слишком короткий комментарий', async () => {
      await expect(service.create({ ...VALID, message: 'ааа' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('отвергает тему длиннее лимита', async () => {
      await expect(service.create({ ...VALID, topic: 'я'.repeat(121) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('отвергает комментарий длиннее лимита', async () => {
      await expect(service.create({ ...VALID, message: 'я'.repeat(4001) })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('отвергает пропущенные и нестроковые поля', async () => {
      await expect(service.create({} as any)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ topic: 42, message: 7 } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('обрезает пробелы, а пустой контакт кладёт как null', async () => {
      await service.create({
        topic: '  Нет звука  ',
        message: '  тишина совсем  ',
        contact: '   ',
        ...CONSENT,
      });

      expect(mockPrisma.feedback.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            topic: 'Нет звука',
            message: 'тишина совсем',
            contact: null,
          }),
        }),
      );
    });

    it('промах по валидации не сжигает квоту адреса', async () => {
      for (let i = 0; i < RATE_PER_IP * 2; i++) {
        await expect(
          service.create({ ...VALID, topic: 'ой' }, { ip: '1.1.1.1' }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(service.create(VALID, { ip: '1.1.1.1' })).resolves.toMatchObject({ ok: true });
    });
  });

  describe('технический контекст', () => {
    it('сохраняет страницу, эфир и браузер', async () => {
      await service.create(
        { ...VALID, pageUrl: 'https://liga-live.ru/watch/liga', orgSlug: 'liga', streamSlug: 'kort-2' },
        { ip: '1.1.1.1', userAgent: 'Mozilla/5.0 (iPhone)' },
      );

      expect(mockPrisma.feedback.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            pageUrl: 'https://liga-live.ru/watch/liga',
            orgSlug: 'liga',
            streamSlug: 'kort-2',
            userAgent: 'Mozilla/5.0 (iPhone)',
          }),
        }),
      );
    });

    it('обрезает переросший User-Agent вместо отказа в приёме', async () => {
      await service.create(VALID, { userAgent: 'U'.repeat(1000) });

      const { data } = mockPrisma.feedback.create.mock.calls[0][0];
      expect(data.userAgent).toHaveLength(400);
    });
  });

  describe('лимит по адресу', () => {
    it(`пропускает ${RATE_PER_IP} обращений в час и отсекает следующее`, async () => {
      for (let i = 0; i < RATE_PER_IP; i++) {
        await expect(service.create(VALID, { ip: '1.1.1.1' })).resolves.toMatchObject({ ok: true });
      }

      await expect(service.create(VALID, { ip: '1.1.1.1' })).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });

    it('не задевает других зрителей', async () => {
      for (let i = 0; i < RATE_PER_IP; i++) await service.create(VALID, { ip: '1.1.1.1' });

      await expect(service.create(VALID, { ip: '2.2.2.2' })).resolves.toMatchObject({ ok: true });
    });

    it('не схлопывает всех в один счётчик, когда адрес не определился', async () => {
      // За двумя прокси IP иногда не вычислить. Отказ здесь означал бы, что
      // шестой зритель с проблемой не может о ней сообщить.
      for (let i = 0; i < RATE_PER_IP * 2; i++) {
        await expect(service.create(VALID, { ip: null })).resolves.toMatchObject({ ok: true });
      }
    });
  });

  describe('общий потолок', () => {
    it(`отсекает ${RATE_GLOBAL}-е обращение за час даже с разных адресов`, async () => {
      for (let i = 0; i < RATE_GLOBAL; i++) {
        await service.create(VALID, { ip: `10.0.0.${i}` });
      }

      await expect(service.create(VALID, { ip: '10.9.9.9' })).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    });
  });

  describe('письмо', () => {
    it('уходит с темой обращения в заголовке', async () => {
      await service.create(VALID);

      expect(mockMail.send).toHaveBeenCalledWith(
        '[liga-live] Обратная связь: Видео тормозит',
        expect.stringContaining('Всё время буферизация на телефоне'),
      );
    });

    it('упавший SMTP не мешает принять обращение', async () => {
      mockMail.send.mockRejectedValue(new Error('smtp down'));

      await expect(service.create(VALID)).resolves.toMatchObject({ ok: true, id: 'fb1' });
    });
  });

  describe('letter', () => {
    const base = {
      topic: 'Нет звука',
      message: 'Картинка идёт, звука нет',
      contact: null,
      pageUrl: null,
      orgSlug: null,
      streamSlug: null,
      createdAt: new Date('2026-08-26T10:00:00.000Z'),
    };

    it('ставит тему и текст обращения выше технического контекста', () => {
      const text = letter(base);
      expect(text.indexOf('Картинка идёт')).toBeLessThan(text.indexOf('Страница:'));
    });

    it('честно пишет, чего не знает', () => {
      const text = letter(base);
      expect(text).toContain('Контакт: не указан');
      expect(text).toContain('Эфир: не со страницы трансляции');
      expect(text).toContain('Страница: неизвестна');
    });

    it('склеивает эфир из орги и стрима', () => {
      expect(letter({ ...base, orgSlug: 'liga', streamSlug: 'kort-2' })).toContain(
        'Эфир: liga / kort-2',
      );
    });

    it('не задваивает слеш в ссылке на разбор', () => {
      process.env.SITE_URL = 'https://liga-live.ru/';
      try {
        expect(letter(base)).toContain('Разбор: https://liga-live.ru/admin/feedback');
      } finally {
        delete process.env.SITE_URL;
      }
    });
  });

  describe('операции админки', () => {
    it('переводит обращение в другой статус', async () => {
      mockPrisma.feedback.update.mockResolvedValue({ id: 'fb1', status: 'processed' });

      await expect(service.updateStatus('fb1', 'processed')).resolves.toMatchObject({
        status: 'processed',
      });
    });

    it('превращает промах Prisma в 404', async () => {
      mockPrisma.feedback.update.mockRejectedValue({ code: 'P2025' });
      await expect(service.updateStatus('нет', 'processed')).rejects.toMatchObject({ status: 404 });

      mockPrisma.feedback.delete.mockRejectedValue({ code: 'P2025' });
      await expect(service.remove('нет')).rejects.toMatchObject({ status: 404 });
    });
  });
});
