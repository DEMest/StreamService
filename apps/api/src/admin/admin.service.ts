import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  async onModuleInit() {
    const login = process.env.SUPERADMIN_LOGIN || 'admin';
    const password = process.env.SUPERADMIN_PASSWORD || 'adminpass';

    try {
      const existingAdmin = await this.prisma.user.findUnique({
        where: { login },
      });

      if (!existingAdmin) {
        const passwordHash = await bcrypt.hash(password, 10);
        await this.prisma.user.create({
          data: {
            login,
            passwordHash,
            role: 'superadmin',
          },
        });
        console.log(`✅ Суперпользователь '${login}' успешно создан!`);
      } else {
        console.log(`Суперпользователь '${login}' уже существует.`);
      }
    } catch (error) {
      console.error('❌ Ошибка при создании суперпользователя', error);
    }

    // Восстановить пути в MediaMTX для всех Stream'ов.
    // Для composite Stream — один путь; для multistream — N путей по slotCount.
    try {
      const streams = await this.prisma.stream.findMany({
        select: {
          slug: true, mode: true, slotCount: true, ingestKey: true,
          org: { select: { slug: true } },
        },
      });
      await Promise.all(streams.map((s) =>
        this.mediamtx.addStreamPaths(
          s.org.slug,
          s.slug,
          s.mode as 'composite' | 'multistream',
          s.slotCount,
          s.ingestKey,
        ),
      ));
      if (streams.length > 0) {
        console.log(`✅ Восстановлено путей для ${streams.length} Stream'ов в MediaMTX`);
      }
    } catch (error) {
      console.error('❌ Ошибка при восстановлении путей MediaMTX', error);
    }
  }

  private generateIngestKey(): string {
    return randomBytes(18).toString('base64url');
  }

  async createOrg(data: { slug: string; name: string; password: string }) {
    const ingestKey = this.generateIngestKey();
    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const org = await this.prisma.organization.create({
        data: { slug: data.slug, name: data.name, passwordHash },
        select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      });

      // Создать default Stream сразу
      await this.prisma.stream.create({
        data: {
          orgId: org.id,
          slug: '',
          mode: 'composite',
          slotCount: 1,
          slots: [{ index: 1, name: '' }],
          slotOrder: [1],
          layoutPreset: 'solo',
          name: '',
          ingestKey,
          isPublic: true,
          previewMode: 'multicam',
          autoStartMode: 'public',
        },
      });

      // Default Stream — composite, slotCount=1 → один путь 'live/<orgSlug>'
      await this.mediamtx.addStreamPaths(data.slug, '', 'composite', 1, ingestKey);
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
    // Сначала прочитать конфиг всех Stream'ов орги, чтобы знать какие пути удалять в MediaMTX.
    // (После delete каскадом Stream'ы исчезнут — будет поздно.)
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: {
        streams: { select: { slug: true, mode: true, slotCount: true } },
      },
    });

    try {
      await this.prisma.organization.delete({ where: { slug } });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Org '${slug}' not found`);
      throw e;
    }

    if (org?.streams) {
      await Promise.all(org.streams.map((s) =>
        this.mediamtx.deleteStreamPaths(
          slug,
          s.slug,
          s.mode as 'composite' | 'multistream',
          s.slotCount,
        ),
      ));
    }
    return { ok: true };
  }
}
