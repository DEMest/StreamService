import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AdManagerBootstrap, generatePassword, ALPHABET } from './ad-manager.bootstrap';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

const mockMail = { send: jest.fn() };

describe('AdManagerBootstrap', () => {
  let bootstrap: AdManagerBootstrap;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'u1', ...data }),
    );
    mockMail.send.mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        AdManagerBootstrap,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    bootstrap = module.get(AdManagerBootstrap);
  });

  describe('generatePassword', () => {
    it('отдаёт 20 символов из алфавита без визуально спорных знаков', () => {
      const password = generatePassword();
      expect(password).toHaveLength(20);
      // Регэксп собран из самого алфавита, а не выписан диапазонами: любой
      // диапазон вроде [P-Za-k] заодно пропускает служебные символы между
      // Z и a, то есть проверяет не то, что обещает.
      expect(password).toMatch(new RegExp(`^[${ALPHABET}]+$`));
    });

    it('в алфавите нет визуально спорных знаков и нет повторов', () => {
      expect(ALPHABET).not.toMatch(/[ILO0 1lo]/);
      expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
    });

    it('два вызова дают разные пароли', () => {
      expect(generatePassword()).not.toBe(generatePassword());
    });
  });

  it('ничего не делает, если аккаунт менеджера уже есть', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u9', login: 'admanager' });
    await bootstrap.onModuleInit();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockMail.send).not.toHaveBeenCalled();
  });

  it('создаёт аккаунт с ролью ad_manager и рабочим bcrypt-хешем', async () => {
    await bootstrap.onModuleInit();
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    const { data } = mockPrisma.user.create.mock.calls[0][0];
    expect(data.role).toBe('ad_manager');
    expect(data.login).toBe('admanager');
    // Пароль в письме обязан подходить к сохранённому хешу — иначе аккаунт
    // создан, а войти по выданным кредам нельзя.
    const sent: string = mockMail.send.mock.calls[0][1];
    const password = /Пароль:\s*(\S+)/.exec(sent)?.[1] ?? '';
    expect(await bcrypt.compare(password, data.passwordHash)).toBe(true);
  });

  it('занятый логин не роняет старт — берётся имя с суффиксом', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u0', login: 'admanager' });
    await bootstrap.onModuleInit();
    const { data } = mockPrisma.user.create.mock.calls[0][0];
    expect(data.login).toMatch(/^admanager-[0-9a-f]{4}$/);
  });

  it('ненастроенный SMTP не мешает создать аккаунт', async () => {
    mockMail.send.mockResolvedValue(false);
    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
  });

  it('ошибка БД не роняет старт API — эфир важнее аккаунта', async () => {
    mockPrisma.user.findFirst.mockRejectedValue(new Error('connection refused'));
    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();
  });
});
