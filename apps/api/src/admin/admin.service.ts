import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from '../mediamtx/mediamtx.service';
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

    // Восстановить путь в MediaMTX для каждого Stream'а.
    try {
      const streams = await this.prisma.stream.findMany({
        select: {
          slug: true, ingestKey: true,
          org: { select: { slug: true } },
        },
      });
      await Promise.all(streams.map((s) =>
        this.mediamtx.addStreamPaths(s.org.slug, s.slug, s.ingestKey),
      ));
      if (streams.length > 0) {
        console.log(`✅ Восстановлено путей для ${streams.length} Stream'ов в MediaMTX`);
      }
    } catch (error) {
      console.error('❌ Ошибка при восстановлении путей MediaMTX', error);
    }
  }

  /**
   * Название организации по умолчанию равно логину (slug) — орга сможет
   * поменять его на человекочитаемое из дашборда (PATCH /v1/org/settings),
   * с проверкой на уникальность.
   */
  async createOrg(data: { slug: string; password: string }) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    try {
      const org = await this.prisma.organization.create({
        data: { slug: data.slug, name: data.slug, passwordHash },
        select: { id: true, slug: true, name: true, isActive: true, createdAt: true },
      });
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
      if (e.code === 'P2002') throw new ConflictException(`Name '${data.name}' already taken`);
      throw e;
    }
  }

  async deleteOrg(slug: string) {
    // Сначала прочитать конфиг всех Stream'ов орги, чтобы знать какие пути удалять в MediaMTX.
    // (После delete каскадом Stream'ы исчезнут — будет поздно.)
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      select: {
        streams: { select: { slug: true } },
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
        this.mediamtx.deleteStreamPaths(slug, s.slug),
      ));
    }
    return { ok: true };
  }
}
