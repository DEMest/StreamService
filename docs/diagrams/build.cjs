'use strict';

// Собирает архитектурные диаграммы: docs/diagrams/<имя>.cjs → docs/diagrams/<имя>.svg
// → docs/<имя>.png (растр 2x через Chromium из Playwright).
//
//   node docs/diagrams/build.cjs            # SVG + PNG
//   node docs/diagrams/build.cjs --no-png   # только SVG (Playwright не нужен)
//
// Playwright берётся из node_modules проекта либо из глобальной установки
// (`npm root -g`); браузер — `npx playwright install chromium`, если его нет.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const here = __dirname;
const docsDir = path.resolve(here, '..');
const DIAGRAMS = ['architecture-current', 'architecture-target'];
const SCALE = 2;

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  }
}

async function main() {
  const wantPng = !process.argv.includes('--no-png');
  const only = process.argv.find((a) => a.startsWith('--only='));
  const names = only ? [only.slice('--only='.length)] : DIAGRAMS;

  const built = [];
  for (const name of names) {
    const def = require(path.join(here, `${name}.cjs`));
    const { svg, width, height } = def.build(require('./lib.cjs'));
    const svgPath = path.join(here, `${name}.svg`);
    fs.writeFileSync(svgPath, svg);
    built.push({ name, svg, width, height, svgPath });
    console.log(`svg  ${path.relative(process.cwd(), svgPath)}`);
  }

  if (!wantPng) return;
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  try {
    for (const d of built) {
      const page = await browser.newPage({
        deviceScaleFactor: SCALE,
        viewport: { width: d.width, height: d.height },
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${d.svg}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      const pngPath = path.join(docsDir, `${d.name}.png`);
      await page.locator('svg').screenshot({ path: pngPath, type: 'png' });
      await page.close();
      const kb = Math.round(fs.statSync(pngPath).size / 1024);
      console.log(`png  ${path.relative(process.cwd(), pngPath)}  ${d.width * SCALE}×${d.height * SCALE}px, ${kb} KB`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
