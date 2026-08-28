import { BadRequestException, Controller, Get, Header, Query } from '@nestjs/common';
import { SeoService } from './seo.service';

/**
 * Данные для SEO-разметки фронта. Публичный, без авторизации: всё, что тут
 * отдаётся, и так видно на публичных страницах.
 *
 * Живёт на бэкенде, а не на фронте, по двум причинам: решение «пускать ли
 * страницу в индекс» зависит от истории вещания (это БД), и оно должно быть
 * ОДНО для sitemap.xml и для мета-тега robots на самой странице — иначе карта
 * сайта зовёт краулера туда, где страница просит его уйти.
 */
@Controller('v1/public/seo')
export class SeoController {
  constructor(private seo: SeoService) {}

  /**
   * Список URL для sitemap.xml. Кэш на 10 минут: карта меняется, только когда
   * начинается/заканчивается эфир, а краулеры ходят сюда пачками.
   */
  @Get('sitemap')
  @Header('Cache-Control', 'public, max-age=600')
  async getSitemap() {
    return { urls: await this.seo.getSitemapUrls() };
  }

  /**
   * Мета-данные одной страницы просмотра: `?org=<slug>` и опционально
   * `&stream=<slug>`.
   */
  @Get('page-meta')
  @Header('Cache-Control', 'public, max-age=60')
  async getPageMeta(@Query('org') org?: string, @Query('stream') stream?: string) {
    const orgSlug = (org ?? '').trim();
    if (!orgSlug) throw new BadRequestException('org is required');
    const streamSlug = (stream ?? '').trim();
    return this.seo.getPageMeta(orgSlug, streamSlug || undefined);
  }
}
