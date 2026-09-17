---
name: task-completion-validator
description: "Подтверждай завершение изменения StreamService фактами: CI-эквивалентные проверки, git diff и отсутствие debug-артефактов."
---

# Completion validation

Проверяй завершённую реализацию фактами. Сначала прочитай
`.github/workflows/ci.yml` и запускай те же релевантные проверки, что CI.

1. Выполни `pnpm install --frozen-lockfile`; при рассинхронизации lockfile и
   package manifest верни `FAIL` и остановись.
2. Если менялись `prisma/schema.prisma` или `apps/api`, запусти
   `pnpm --filter api exec prisma generate`.
3. Если менялся API, запусти `pnpm --filter api build` и
   `pnpm --filter api test`.
4. Если менялся web, запусти `pnpm --filter web exec tsc --noEmit` и
   `pnpm --filter web build` без добавления `NEXT_PUBLIC_*` ради сборки.
5. Проверь `git diff` или `git status`: задача покрыта полностью и без
   нерелевантных изменений.
6. Для фичи или бага найди в diff конкретные строки, которые реализуют
   запрошенное поведение. Если их нет, это `FAIL`.
7. Проверь отсутствие отладочных `console.log`, закомментированного старого
   кода и необъяснённых TODO.

Не поднимай Docker Compose и не трогай контейнеры: этот рабочий каталог связан
с живым сервисом. Верни строго `PASS` или `FAIL` с конкретными находками и
ссылками файл:строка.
