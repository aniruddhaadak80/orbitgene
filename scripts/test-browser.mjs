#!/usr/bin/env node
/**
 * Browser check for the one thing unit tests cannot reach: does the open-weight
 * model actually download, compile and run on a real browser, on the local GPU.
 *
 *   npm run build && npm start          # in one shell
 *   npm run test:browser -- http://localhost:3000
 *
 * Deliberately NOT in CI. It fetches ~70 MB of weights from the Hugging Face CDN
 * and needs a WebGPU or WASM runtime, so it would be slow and flaky as a gate.
 * Run it before a release, or when touching src/components/verdict-explainer.tsx.
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const ACCESSION = process.argv[3] ?? 'P38398';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 200)}`);
});

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  console.log(`\nBrowser check against ${BASE}\n${'='.repeat(56)}`);

  await page.goto(`${BASE}/variants?accession=${ACCESSION}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000,
  });

  // A deep link must score on arrival rather than sitting on an empty form.
  const runButton = page.locator('button', { hasText: 'Run locally' }).first();
  const scored = await runButton
    .waitFor({ state: 'visible', timeout: 240000 })
    .then(() => true)
    .catch(() => false);
  check('a deep link scores its featured variant on load', scored);

  if (scored) {
    const clinical = await page
      .locator('text=/ClinVar:/')
      .first()
      .textContent()
      .catch(() => null);
    check('ClinVar context is shown', Boolean(clinical), clinical?.trim());

    console.log('\nRunning the local model, which downloads ~70 MB of weights...');
    const started = Date.now();
    await runButton.click();

    const explained = await page
      .locator('text=/ran on this device, not a server/')
      .first()
      .waitFor({ state: 'visible', timeout: 480000 })
      .then(() => true)
      .catch(() => false);

    check(
      'the open-weight model ran in the browser',
      explained,
      `${Math.round((Date.now() - started) / 1000)}s`,
    );

    if (explained) {
      const device = await page.locator('text=/ran on this device/').first().textContent();
      console.log(`\n  ${device?.trim()}`);

      const ranked = (await page.locator('ol li').allTextContents()).map((t) =>
        t.replace(/\s+/g, ' ').trim(),
      );
      check('the model ranked every diagnosis', ranked.length === 5, `${ranked.length} ranked`);
      for (const row of ranked) console.log(`    ${row}`);

      const premise = await page.locator('details p').first().textContent().catch(() => null);
      check('the premise sent to the model is shown to the reader', Boolean(premise?.length), `${premise?.length ?? 0} chars`);
    }
  }

  check('no uncaught page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally {
  console.log(`${'='.repeat(56)}\n${failures === 0 ? 'browser check passed' : `${failures} browser check(s) failed`}`);
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}