import { ImageResponse } from 'next/og';

/**
 * Дефолтная og:image для страниц без своего превью (список трансляций,
 * организации, архив, офлайн-стрим без сохранённого кадра). Рисуется на лету
 * без внешних ассетов — так её не нужно хранить и обновлять руками.
 *
 * Текст — только латиницей: у шрифта по умолчанию в next/og (Satori) нет
 * кириллицы, а догружать шрифт по сети на каждый заход бота-краулера
 * (Telegram/VK/MAX разворачивают превью синхронно при первой отправке ссылки)
 * — лишняя внешняя зависимость и точка отказа. Русский заголовок и описание
 * приходят отдельными og:title/og:description, картинка их не дублирует.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Liga Live';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          backgroundColor: '#0C0C0E',
          backgroundImage: 'radial-gradient(circle at 82% 78%, rgba(229,68,51,0.35), rgba(229,68,51,0) 55%)',
          fontFamily: 'sans-serif',
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
            fontSize: 116,
            fontWeight: 700,
            letterSpacing: -2,
            color: '#FAFAFA',
            marginTop: 32,
          }}
        >
          Liga Live
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#9A9AA0', marginTop: 28 }}>liga-live.ru</div>
      </div>
    ),
    { ...size }
  );
}
