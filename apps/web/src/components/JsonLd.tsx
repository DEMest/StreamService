/**
 * Вставка структурированных данных в `<head>`.
 *
 * `<` экранируется в `<` намеренно: в JSON-LD попадают названия и
 * описания организаций, которые вводит пользователь, и строка `</script>`
 * внутри такого названия иначе закрыла бы тег и превратила бы данные в
 * исполняемую разметку.
 */
export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
