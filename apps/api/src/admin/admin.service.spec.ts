import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  organization: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  stream: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockMediamtx = {
  addPath: jest.fn(),
  deletePath: jest.fn(),
  addStreamPaths: jest.fn(),
  deleteStreamPaths: jest.fn(),
};

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MediamtxService, useValue: mockMediamtx },
      ],
    }).compile();
    service = module.get(AdminService);
  });

  it('creates org with name defaulted to slug (login)', async () => {
    mockPrisma.organization.create.mockResolvedValue({
      id: '1', slug: 'club', name: 'club', isActive: true, createdAt: new Date(),
    });
    const result = await service.createOrg({ slug: 'club', password: 'pass' });
    expect(result.slug).toBe('club');
    expect(mockPrisma.organization.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ slug: 'club', name: 'club' }),
    }));
    // Stream'ы больше не создаются автоматически при создании орги (Task 2).
    expect(mockPrisma.stream.create).not.toHaveBeenCalled();
  });

  it('throws ConflictException when slug already taken', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    mockPrisma.organization.create.mockRejectedValue(p2002);
    await expect(service.createOrg({ slug: 'club', password: 'pass' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws ConflictException when renaming org to an already-taken name', async () => {
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    mockPrisma.organization.update.mockRejectedValue(p2002);
    await expect(service.updateOrg('club', { name: 'taken' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFoundException when deleting non-existent org', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);
    const p2025 = Object.assign(new Error('Not found'), { code: 'P2025' });
    mockPrisma.organization.delete.mockRejectedValue(p2025);
    await expect(service.deleteOrg('ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes all stream paths of org when deleting org', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      streams: [
        { slug: '' },
        { slug: 'tournament' },
      ],
    });
    mockPrisma.organization.delete.mockResolvedValue({});
    await service.deleteOrg('club');
    expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalledWith('club', '');
    expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalledWith('club', 'tournament');
  });
});
