import { expect, test } from '@playwright/test';
import { baseParameters, decodeSketch, encodeSketch, lessons } from '../src/lib/dsp-for-artists/course';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('wss://rf.postoccupancy.com', () => {}); });

test('lesson metadata and sketch links round trip safely', () => {
  expect(lessons.map(({slug})=>slug)).toEqual(['audio-processing','interference-patterns','make-some-art']);
  const changed={...baseParameters,frequency:220,mode:'pressure' as const,layers:5};
  expect(decodeSketch(encodeSketch(changed))).toMatchObject({frequency:220,mode:'pressure',layers:5});
  expect(decodeSketch('not-valid')).toEqual({});
});

test('lesson routes expose configured controls and preserve course state', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing');
  await expect(page.getByRole('heading',{name:'Audio Processing'})).toBeVisible();
  await expect(page.locator('[data-control-group=audio]')).toBeVisible();
  await expect(page.locator('[data-control-group=layers]')).toHaveCount(0);
  const frequency=page.getByRole('slider',{name:'Tone 1 frequency (Hz)'});await frequency.fill('220');
  await page.getByRole('link',{name:'Next'}).click();
  await expect(page).toHaveURL('/lab/dsp-for-artists/interference-patterns');
  await expect(page.locator('[data-control-group=layers]')).toBeVisible();
  await expect(page.getByRole('slider',{name:'Tone 1 frequency (Hz)'})).toHaveValue('220');
  await expect(page.getByRole('slider',{name:'Tone 2 frequency (Hz)'})).toBeVisible();
});

test('course navigation expands to all lessons and malformed shared state is harmless', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing?sketch=broken');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'Audio Processing'})).toHaveAttribute('aria-current','page');
  await expect(nav.getByRole('link',{name:'Interference Patterns'})).toBeVisible();
  await expect(page.getByLabel('stripes audio visualization')).toBeVisible();
});

test('presentation receives state over its session-specific channel', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/make-some-art');
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Open presentation window'}).click();
  const presentation=await popupPromise;
  await expect(presentation).toHaveURL(/\/lab\/dsp-for-artists\/presentation\?session=/);
  await expect(presentation.getByLabel('rings audio visualization')).toBeVisible();
  await expect(presentation.getByText('Waiting for the tutorial window…')).toHaveCount(0);
  await presentation.close();
});
