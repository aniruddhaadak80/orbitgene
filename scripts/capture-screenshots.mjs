#!/usr/bin/env node
/**
 * Screenshots for the README and the DEV post.
 *
 *   npm run build && npm start          # in one shell
 *   npm run capture -- http://localhost:3000
 *
 * Writes PNGs into ./screenshots, which is gitignored. Each shot waits for the
 * thing it is meant to show rather than for a fixed delay, because the first
 * gene fetch on a cold embedded store takes real time.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = 'screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});

const shot = async (name, options = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...options });
  console.log(`wrote ${OUT}/${name}.png`);
};

const settle = () => page.waitForLoadState('networkidle').catch(() => {});

try {
  console.log(`Capturing ${BASE}`);

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle();
  await shot('01-landing', { fullPage: true });

  // Workbench with a scored variant, ClinVar line and the factor ledger.
  await page.goto(`${BASE}/variants?accession=P38398`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });
  await page
    .locator('button', { hasText: 'Run locally' })
    .first()
    .waitFor({ state: 'visible', timeout: 240000 })
    .catch(() => console.warn('  (no score rendered, capturing anyway)'));
  await page.waitForTimeout(1500);
  await shot('02-workbench-scored', { fullPage: true });

  // The local model having actually produced a ranking.
  const runButton = page.locator('button', { hasText: 'Run locally' }).first();
  if (await runButton.isVisible().catch(() => false)) {
    console.log('running the local model for the screenshot (~70 MB)...');
    await runButton.click();
    await page
      .locator('text=/ran on this device, not a server/')
      .first()
      .waitFor({ state: 'visible', timeout: 480000 })
      .then(() => console.log('  model finished'))
      .catch(() => console.warn('  (model did not finish in time, capturing anyway)'));
    await page.waitForTimeout(500);
    await shot('03-local-model-explanation', { fullPage: true });
  }

  await page.goto(`${BASE}/bench`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle();
  await shot('04-plate-map', { fullPage: true });

  await page.goto(`${BASE}/flight`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle();
  await shot('05-flight-budget', { fullPage: true });

  await page.goto(`${BASE}/agent`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle();
  await shot('06-mcp-agent', { fullPage: true });

  await page.goto(`${BASE}/verify`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await settle();
  await shot('07-integrity-replay', { fullPage: true });

  console.log(`\nDone. ${OUT}/ contains the screenshots.`);
} finally {
  await browser.close();
}