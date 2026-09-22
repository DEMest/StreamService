# Favicon в Google Search

Источник: [официальная документация Google Search Central](https://developers.google.com/search/docs/appearance/favicon-in-search).

## Требования Google Search

- На главной странице каждого hostname нужен тег `<link rel="icon" href="/постоянный-путь-к-иконке">`. Google также распознаёт `shortcut icon`, `apple-touch-icon` и `apple-touch-icon-precomposed`.
- Иконка должна быть квадратной (`1:1`), не меньше `8×8 px`; Google рекомендует размер больше `48×48 px`.
- Поддерживаемые в Google Search форматы: BMP, GIF, ICO, PNG, JPEG, PPM и TIFF. SVG не указан в списке, поэтому его нельзя использовать как единственный favicon для поисковой выдачи.
- URL иконки должен быть стабильным: не следует регулярно менять путь, hash или query-параметры для cache busting.
- Главная страница должна быть доступна Googlebot, а файл favicon — Googlebot-Image; оба не должны блокироваться в `robots.txt` или правилами доступа.
- Google использует один favicon на hostname. Поддомены могут иметь разные иконки, но отдельный favicon для подкаталога не поддерживается.

## Обновление в выдаче

После замены Google повторно обходит главную страницу и обрабатывает favicon от нескольких дней до нескольких недель. Ускорить постановку в очередь можно через URL Inspection в Search Console, запросив переиндексацию главной страницы. Даже при выполнении требований показ иконки в выдаче не гарантирован.

Для `liga-live.ru` надёжная конфигурация для Google Search — неизменяемый URL `/icon-192.png`, с квадратной PNG-иконкой `192×192 px` и `rel="icon"` в `<head>` главной страницы.
