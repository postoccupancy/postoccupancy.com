import { chromium } from '@playwright/test';

async function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function measure(browser, baseURL) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const started = performance.now();
  await page.goto(`${baseURL}/lab/dsp-for-artists/audio-processing`, { waitUntil: 'domcontentloaded' });
  await page.locator('canvas[aria-label="stripes audio visualization"]').waitFor({ state: 'visible' });
  const loadMs = performance.now() - started;
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Open presentation window' }).click();
  const presentation = await popupPromise;
  await presentation.waitForLoadState('domcontentloaded');
  const fps = await page.locator('body').evaluate(() => new Promise(resolve => {
    let frames = 0;
    const start = performance.now();
    const tick = now => {
      frames += 1;
      if (now - start >= 2000) resolve(frames * 1000 / (now - start));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const slider = page.getByRole('slider', { name: 'Tone 1 frequency (Hz)' });
  const latencies = [];
  for (const value of [120, 180, 240, 300, 360, 420, 480, 540, 600, 660]) {
    const before = performance.now();
    await slider.fill(String(value));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
    latencies.push(performance.now() - before);
  }
  await presentation.close();
  await context.close();
  return { loadMs, fps, inputMedianMs: await percentile(latencies, .5), inputP95Ms: await percentile(latencies, .95) };
}

(async () => {
  const urls = process.argv.slice(2);
  if (!urls.length) throw new Error('Pass one or more production base URLs');
  const browser = await chromium.launch();
  try {
    for (const url of urls) console.log(JSON.stringify({ url, ...(await measure(browser, url)) }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
