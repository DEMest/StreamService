import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateContactDto {
  org: string;
  name: string;
  email: string;
  phone?: string;
  message?: string;
}

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateContactDto) {
    const created = await this.prisma.contactRequest.create({
      data: {
        org: data.org.trim(),
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        phone: data.phone?.trim() || null,
        message: data.message?.trim() || null,
      },
      select: { id: true, createdAt: true },
    });
    return { ok: true, id: created.id };
  }

  list(status?: string) {
    return this.prisma.contactRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: string) {
    try {
      return await this.prisma.contactRequest.update({
        where: { id },
        data: { status },
      });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Request '${id}' not found`);
      throw e;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.contactRequest.delete({ where: { id } });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Request '${id}' not found`);
      throw e;
    }
    return { ok: true };
  }
}
