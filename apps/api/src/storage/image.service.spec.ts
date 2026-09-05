// Мокаем sharp целиком: цепочка resize().jpeg().toBuffer().
jest.mock('sharp', () => {
  const chain = {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-jpeg')),
  };
  const factory = jest.fn(() => chain);
  (factory as any).__chain = chain;
  return factory;
});

import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as sharp from 'sharp';
import { ImageService } from './image.service';
import { S3Service } from './s3.service';

const sharpChain = (sharp as unknown as { __chain: any }).__chain;

const mockS3 = {
  putObject: jest.fn(),
  getObjectBuffer: jest.fn(),
  deleteObject: jest.fn(),
};

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(async () => {
    jest.clearAllMocks();
    sharpChain.resize.mockReturnThis();
    sharpChain.jpeg.mockReturnThis();
    sharpChain.toBuffer.mockResolvedValue(Buffer.from('processed-jpeg'));
    const module = await Test.createTestingModule({
      providers: [ImageService, { provide: S3Service, useValue: mockS3 }],
    }).compile();
    service = module.get(ImageService);
  });

  describe('processToJpeg', () => {
    it('resizes to 1280x720 cover and encodes jpeg q82', async () => {
      const out = await service.processToJpeg(Buffer.from('raw'));
      expect(sharp).toHaveBeenCalledWith(Buffer.from('raw'));
      expect(sharpChain.resize).toHaveBeenCalledWith(1280, 720, { fit: 'cover' });
      expect(sharpChain.jpeg).toHaveBeenCalledWith({ quality: 82 });
      expect(out).toEqual(Buffer.from('processed-jpeg'));
    });

    it('принимает нестандартный размер — реклама режет не 16:9, а под свой плейсмент', async () => {
      await service.processToJpeg(Buffer.from('raw'), 320, 320);
      expect(sharpChain.resize).toHaveBeenCalledWith(320, 320, { fit: 'cover' });
    });

    it('fit=contain не обрезает готовый баннер, а вписывает целиком с фоном-подложкой', async () => {
      await service.processToJpeg(Buffer.from('raw'), 728, 90, 'contain');
      expect(sharpChain.resize).toHaveBeenCalledWith(728, 90, {
        fit: 'contain',
        background: { r: 12, g: 12, b: 14, alpha: 1 },
      });
    });

    it('throws BadRequestException when sharp cannot decode', async () => {
      sharpChain.toBuffer.mockRejectedValue(new Error('unsupported format'));
      await expect(service.processToJpeg(Buffer.from('not-an-image')))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('upload', () => {
    it('processes and puts jpeg under the given key', async () => {
      await service.upload('images/stream/st-1.jpg', Buffer.from('raw'));
      expect(mockS3.putObject).toHaveBeenCalledWith(
        'images/stream/st-1.jpg', Buffer.from('processed-jpeg'), 'image/jpeg',
      );
    });
  });

  describe('serve', () => {
    it('returns buffer from S3', async () => {
      mockS3.getObjectBuffer.mockResolvedValue(Buffer.from('img'));
      await expect(service.serve('k')).resolves.toEqual(Buffer.from('img'));
    });

    it('returns null on any S3 error (controller maps to 404)', async () => {
      mockS3.getObjectBuffer.mockRejectedValue(new Error('NoSuchKey'));
      await expect(service.serve('missing')).resolves.toBeNull();
    });
  });

  describe('delete', () => {
    it('swallows S3 errors (deletion must not fail the main operation)', async () => {
      mockS3.deleteObject.mockRejectedValue(new Error('boom'));
      await expect(service.delete('k')).resolves.toBeUndefined();
    });
  });
});
