import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContactService } from './contact.service';
import { PrismaService } from '../prisma/prisma.service';

const mockPrisma = {
  contactRequest: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const VALID = {
  org: 'СШОР №1',
  name: 'Иван Петров',
  email: 'Ivan@Example.RU',
  consent: true,
  consentVersion: '2026-08-28',
};

describe('ContactService', () => {
  let service: ContactService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.contactRequest.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'cr1', createdAt: new Date(), ...data }),
    );

    const module = await Test.createTestingModule({
      providers: [ContactService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(ContactService);
  });

  it('принимает заявку и нормализует поля', async () => {
    const res = await service.create({ ...VALID, phone: '  +7 999  ', message: '   ' });

    expect(res).toMatchObject({ ok: true, id: 'cr1' });
    expect(mockPrisma.contactRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          org: 'СШОР №1',
          email: 'ivan@example.ru',
          phone: '+7 999',
          message: null,
        }),
      }),
    );
  });

  it('фиксирует момент согласия и редакцию политики', async () => {
    await service.create(VALID);

    const { data } = mockPrisma.contactRequest.create.mock.calls[0][0];
    expect(data.consentVersion).toBe('2026-08-28');
    expect(data.consentAt).toBeInstanceOf(Date);
  });

  it('не принимает заявку без согласия на обработку данных', async () => {
    const { consent, ...withoutConsent } = VALID;

    await expect(service.create(withoutConsent)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create({ ...VALID, consent: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockPrisma.contactRequest.create).not.toHaveBeenCalled();
  });

  it('не принимает согласие без редакции политики', async () => {
    await expect(service.create({ ...VALID, consentVersion: '' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
