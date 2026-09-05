import { ImageResponse } from 'next/og';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Дефолтная og:image для страниц без своего превью (список трансляций,
 * организации, архив, офлайн-стрим без сохранённого кадра). Рисуется на лету
 * без внешних ассетов — так её не нужно хранить и обновлять руками.
 *
 * Текст — только латиницей: у шрифтов ниже нет кириллицы, а догружать шрифт
 * с кириллицей по сети на каждый заход бота-краулера (Telegram/VK/MAX
 * разворачивают превью синхронно при первой отправке ссылки) — лишняя
 * внешняя зависимость и точка отказа. Русский заголовок и описание приходят
 * отдельными og:title/og:description, картинка их не дублирует.
 *
 * Контент строго по центру, не у левого края: часть платформ (замечено на
 * VK) показывает не сам баннер целиком, а квадратный кроп из его середины —
 * при левом выравнивании в такой кроп попадал только край с точкой-индикатором,
 * а сам вордмарк обрезался. По центру вордмарк переживает любой крой сверху
 * донизу или слева направо.
 *
 * Шрифт — Geist (тот же, что и на самом сайте, через npm-пакет `geist`),
 * а не дефолтный fallback next/og: тот заметно тоньше на вид и не даёт
 * настоящего жирного начертания даже с fontWeight в стилях — Satori не
 * умеет "утолщать" шрифт синтетически, ему нужен реальный файл нужного
 * начертания. Файл читаем напрямую с диска (`fs`), а не через
 * `require.resolve('geist/...')`: у пакета строгий `exports` в package.json,
 * который закрывает доступ к путям внутри пакета через module-резолюцию, но
 * не мешает обычному чтению файла по пути на диске.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Liga Live';

const geistDir = join(process.cwd(), 'node_modules/geist/dist/fonts/geist-sans');
const geistBlack = readFileSync(join(geistDir, 'Geist-Black.ttf'));
const geistBold = readFileSync(join(geistDir, 'Geist-Bold.ttf'));

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0C0C0E',
          backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(229,68,51,0.35), rgba(229,68,51,0) 60%)',
          fontFamily: 'Geist',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ display: 'flex', width: 20, height: 20, borderRadius: '50%', background: '#E54433' }} />
          <div
            style={{
              display: 'flex',
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: '#E54433',
            }}
          >
            Live
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 100,
            fontWeight: 900,
            letterSpacing: -2,
            color: '#FAFAFA',
            marginTop: 28,
          }}
        >
          Liga Live
        </div>
        <div style={{ display: 'flex', fontSize: 28, fontWeight: 700, color: '#9A9AA0', marginTop: 24 }}>
          liga-live.ru
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: geistBlack, weight: 900, style: 'normal' },
        { name: 'Geist', data: geistBold, weight: 700, style: 'normal' },
      ],
    }
  );
}
