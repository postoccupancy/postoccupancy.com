import { expect, test } from '@playwright/test';
import { groups, pages } from '../src/content/site';

// Navigation checks should not open connections to the real Pi.
test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('wss://rf.postoccupancy.com', () => {});
});

test('all named routes render their title, breadcrumbs, and selected navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const entry of pages) {
    const response = await page.goto(entry.href);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: entry.title, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${entry.title} | Post Occupancy`);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
    if (entry.href === '/') {
      await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
      await expect(breadcrumb).toHaveCount(0);
      continue;
    }
    await expect(nav.getByRole('link', { name: entry.title, exact: true })).toHaveAttribute('aria-current', 'page');
    const section = groups.find((group) => group.items.some((item) => item.href === entry.href));
    await expect(breadcrumb).toHaveText(`${section!.title}/${entry.title}`);
  }
  expect(errors).toEqual([]);
});

test('sections collapse and active sections reopen on history navigation', async ({ page }) => {
  await page.goto('/nodes/electric-sky');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const nodes = nav.getByRole('button', { name: 'Nodes', exact: true });
  await nodes.click();
  await expect(nodes).toHaveAttribute('aria-expanded', 'false');
  await expect(nav.getByRole('link', { name: 'Indoor Sky' })).not.toBeVisible();
  await nav.getByRole('link', { name: 'Notes', exact: true }).click();
  await expect(page).toHaveURL('/lab/notes');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveText('Lab/Notes');
  await page.goBack();
  await expect(nodes).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('link', { name: 'Electric Sky' })).toBeVisible();
  await page.getByRole('link', { name: 'Post Occupancy', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveCount(0);
});

test('collapsing the sidebar releases the full viewport width and retains a keyboard control', async ({ page }) => {
  await page.goto('/interfaces/spectral-visualizer');
  const main = page.getByRole('main');
  const before = await main.boundingBox();
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(opener).toBeFocused();
  const after = await main.boundingBox();
  expect(after?.x).toBe(0);
  expect(after!.width).toBe(page.viewportSize()!.width);
  expect(after!.width - before!.width).toBe(280);
  await opener.press('Enter');
  await expect(page.getByRole('button', { name: 'Collapse navigation', exact: true })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
});

test('mobile drawer closes after navigation and with Escape without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const opener = page.getByRole('button', { name: 'Open navigation', exact: true });
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeVisible();
  await opener.click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Microphone Visualizer', exact: true }).click();
  await expect(page).toHaveURL('/interfaces/microphone-visualizer');
  await expect(nav).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Microphone Visualizer' })).toBeVisible();
  await opener.click();
  await expect(nav).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nav).not.toBeVisible();
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('unknown routes render a real 404', async ({ page }) => {
  const response = await page.goto('/not-a-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Return to Overview' }).click();
  await expect(page).toHaveURL('/');
});

test('MDX prose surrounds a working React wave explorer', async ({ page }) => {
  await page.goto('/lab/dsp-for-artists');
  await expect(page.getByRole('heading', { name: 'Frequency and amplitude', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Try it', exact: true })).toBeVisible();
  const explorer = page.getByRole('region', { name: 'Wave explorer' });
  const frequency = explorer.getByRole('slider', { name: /Frequency/ });
  await frequency.focus();
  await frequency.press('ArrowRight');
  await expect(explorer.getByRole('img')).toHaveAccessibleName('Sine wave: 4 Hz, amplitude 0.65');
  const amplitude = explorer.getByRole('slider', { name: /Amplitude/ });
  await amplitude.focus();
  await amplitude.press('Home');
  await expect(explorer.getByRole('img')).toHaveAccessibleName('Sine wave: 4 Hz, amplitude 0.00');
  const path = await explorer.locator('path').getAttribute('d');
  expect(path!.split(' ').every((point) => point.endsWith(',100.00'))).toBe(true);
  await explorer.getByRole('button', { name: 'Reset' }).click();
  await expect(explorer.getByRole('img')).toHaveAccessibleName('Sine wave: 3 Hz, amplitude 0.65');
  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.getByRole('main');
  expect(await main.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
