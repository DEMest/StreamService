import { Test } from '@nestjs/testing';
import { AdminService } from './admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { RecordingService } from '../recording/recording.service';
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
const mockRecording = { deleteRecordingsForStreams: jest.fn().mockResolvedValue(undefined) };
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
        { provide: RecordingService, useValue: mockRecording },
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
        { id: 's0', slug: '' },
        { id: 's1', slug: 'tournament' },
      ],
    });
    mockPrisma.organization.delete.mockResolvedValue({});
    await service.deleteOrg('club');
    expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalledWith('club', '');
    expect(mockMediamtx.deleteStreamPaths).toHaveBeenCalledWith('club', 'tournament');
  });

  it('удаляет архив записей всех Stream\'ов орги из S3 до каскадного удаления', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      streams: [{ id: 's0', slug: '' }, { id: 's1', slug: 'tournament' }],
    });
    const order: string[] = [];
    mockRecording.deleteRecordingsForStreams.mockImplementation(async () => { order.push('s3'); });
    mockPrisma.organization.delete.mockImplementation(async () => { order.push('db'); });

    await service.deleteOrg('club');

    expect(mockRecording.deleteRecordingsForStreams).toHaveBeenCalledWith(['s0', 's1']);
    expect(order).toEqual(['s3', 'db']);
  });

  it('restore (onModuleInit) передаёт recordingEnabled из БД в addStreamPaths', async () => {
    mockPrisma.stream.findMany.mockResolvedValue([
      { slug: 'a', ingestKey: 'k', recordingEnabled: false, org: { slug: 'club' } },
    ]);
    await service.onModuleInit();
    expect(mockMediamtx.addStreamPaths).toHaveBeenCalledWith('club', 'a', 'k', false);
  });
});
