import { expect, test } from '@playwright/test';
import { baseParameters, decodeSketch, encodeSketch, lessons } from '../src/lib/dsp-for-artists/course';
import { colorAt } from '../src/components/dsp-for-artists/canvas';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('wss://rf.postoccupancy.com', () => {}); });

test('lesson metadata and sketch links round trip safely', () => {
  expect(lessons.map(({slug})=>slug)).toEqual(['audio-processing','interference-patterns','make-some-art']);
  const changed={...baseParameters,frequency:220,mode:'pressure' as const,layers:5};
  expect(decodeSketch(encodeSketch(changed))).toMatchObject({frequency:220,mode:'pressure',layers:5});
  expect(decodeSketch('not-valid')).toEqual({});
});

test('palette lookup survives non-finite and incomplete analysis values', () => {
  expect(colorAt([[5,9,25],[255,225,135]], Number.NaN)).toEqual([5,9,25]);
  expect(colorAt([], Number.POSITIVE_INFINITY)).toEqual([0,0,0]);
});

test('lesson routes expose configured controls and preserve course state', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing');
  await expect(page.getByRole('heading',{name:'Audio Processing'})).toBeVisible();
  await expect(page.locator('[data-control-group=audio]')).toBeVisible();
  await expect(page.locator('[data-control-group=layers]')).toHaveCount(0);
  const fft=page.frameLocator('iframe[title="fft source sketch"]');
  await expect(fft.locator('canvas')).toBeVisible();
  await expect(fft.locator('label').filter({hasText:'Geometry'}).locator('select')).toHaveValue('linear');
  await expect(fft.locator('label').filter({hasText:'Layers'}).locator('select')).toHaveValue('1');
  await expect(fft.locator('label').filter({hasText:'Channel'}).nth(1).locator('select')).toHaveValue('raw');
  await page.getByRole('switch',{name:'Listen to oscillator'}).check();
  await expect(fft.locator('input[type="checkbox"]').first()).toBeChecked();
  const frequency=page.getByRole('slider',{name:'Tone 1 frequency (Hz)'});await frequency.fill('220');
  await page.getByRole('link',{name:'Next'}).click();
  await expect(page).toHaveURL('/lab/dsp-for-artists/interference-patterns');
  await expect(page.locator('[data-control-group=layers]')).toBeVisible();
  const plane=page.frameLocator('iframe[title="plane source sketch"]');
  await expect(plane.locator('canvas')).toBeVisible();
  await expect(plane.locator('select').first()).toHaveValue('crests');
  await expect(page.getByRole('slider',{name:'Tone 1 frequency (Hz)'})).toHaveValue('220');
  await expect(page.getByRole('slider',{name:'Tone 2 frequency (Hz)'})).toBeVisible();
});

test('course navigation expands to all lessons and malformed shared state is harmless', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing?sketch=broken');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'Audio Processing'})).toHaveAttribute('aria-current','page');
  await expect(nav.getByRole('link',{name:'Interference Patterns'})).toBeVisible();
  await expect(page.getByTitle('fft source sketch')).toBeVisible();
});

test('invalid persisted controls cannot crash the animation palette', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>sessionStorage.setItem('dsp-for-artists:v1',JSON.stringify({layers:Number.NaN,palette:'missing',rmsPulseDepth:'loud'})));
  await page.goto('/lab/dsp-for-artists/interference-patterns');
  await expect(page.getByTitle('plane source sketch')).toBeVisible();
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});

test('presentation receives state over its session-specific channel', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/make-some-art');
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Open presentation window'}).click();
  const presentation=await popupPromise;
  await expect(presentation).toHaveURL(/\/lab\/dsp-for-artists\/presentation\?session=/);
  await expect(presentation.getByAltText('rings live presentation')).toBeVisible();
  await expect(presentation.getByText('Waiting for the tutorial window…')).toHaveCount(0);
  await presentation.close();
});
