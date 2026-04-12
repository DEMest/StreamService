import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  private generateIngestKey(): string {
    return randomBytes(18).toString('base64url');
  }

  async createOrg(data: { slug: string; name: string; password: string }) {
    const ingestKey = this.generateIngestKey();
    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const org = await this.prisma.organization.create({
        data: { slug: data.slug, name: data.name, passwordHash, ingestKey },
        select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      });
      await this.mediamtx.addPath(data.slug, ingestKey);
      return org;
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(`Slug '${data.slug}' already taken`);
      throw e;
    }
  }

  async listOrgs() {
    return this.prisma.organization.findMany({
      select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateOrg(slug: string, data: { name?: string; isActive?: boolean }) {
    try {
      return await this.prisma.organization.update({
        where: { slug },
        data,
        select: { id: true, slug: true, name: true, isActive: true },
      });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Org '${slug}' not found`);
      throw e;
    }
  }

  async deleteOrg(slug: string) {
    try {
      await this.prisma.organization.delete({ where: { slug } });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Org '${slug}' not found`);
      throw e;
    }
    await this.mediamtx.deletePath(slug);
    return { ok: true };
  }
}
