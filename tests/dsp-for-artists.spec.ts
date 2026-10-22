import { expect, test, type Page } from '@playwright/test';
import { baseParameters, decodeSketch, encodeSketch, lessons } from '../src/lib/dsp-for-artists/course';
import { colorAt } from '../src/components/dsp-for-artists/canvas';

test.beforeEach(async ({ page }) => { await page.routeWebSocket('wss://rf.postoccupancy.com', () => {}); });

async function installAudioMock(page:Page) {
  await page.addInitScript(() => {
    const metrics={contexts:0,closed:0,oscillators:0,microphones:0,connections:0};
    class Param { value=0;setTargetAtTime(value:number){this.value=value;} }
    class Node { connect(){metrics.connections++;return this;}disconnect(){return this;} }
    class Oscillator extends Node {frequency=new Param();type:OscillatorType='sine';start(){}stop(){} }
    class Filter extends Node {frequency=new Param();Q=new Param();type:BiquadFilterType='lowpass';}
    class Gain extends Node {gain=new Param();}
    class Analyser extends Node {private size=2048;smoothingTimeConstant=0;minDecibels=-120;maxDecibels=0;get fftSize(){return this.size}set fftSize(value){this.size=value}get frequencyBinCount(){return this.size/2}getFloatFrequencyData(values:Float32Array){values.fill(-100);const tick=Math.floor(performance.now()/80);values[5+(tick%4)]=-18;values[20]=-28;values[60]=-35;}getFloatTimeDomainData(values:Float32Array){for(let index=0;index<values.length;index++)values[index]=.12*Math.sin(index*.12+performance.now()/180);}}
    class Context {state:AudioContextState='suspended';sampleRate=48000;currentTime=0;destination=new Node();constructor(){metrics.contexts++;}createGain(){return new Gain()}createOscillator(){metrics.oscillators++;return new Oscillator()}createBiquadFilter(){return new Filter()}createAnalyser(){return new Analyser()}createMediaStreamSource(){metrics.microphones++;return new Node()}async resume(){this.state='running'}async suspend(){this.state='suspended'}async close(){this.state='closed';metrics.closed++;}}
    Object.defineProperty(window,'AudioContext',{value:Context});
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
    Object.defineProperty(window,'__dspMetrics',{value:metrics});
  });
}

async function chooseMode(page:Page,name:string) {
  await page.locator('[data-control-group=visualization] [role="combobox"]').click();
  await page.getByRole('option',{name}).click();
}

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

test('one audio engine and canvas persist across lesson and visualization changes', async ({page}) => {
  await installAudioMock(page);
  await page.goto('/lab/dsp-for-artists/audio-processing');
  const canvas=page.locator('canvas[aria-label="stripes audio visualization"]');
  await expect(canvas).toBeVisible();
  await canvas.evaluate(element=>{(element as HTMLCanvasElement&{token?:string}).token='persistent'});
  await page.getByRole('button',{name:'Start audio'}).click();
  await expect(page.getByText('Oscillators analyzing')).toBeVisible();
  expect(await page.evaluate(()=>(window as typeof window&{__dspMetrics:{contexts:number}}).__dspMetrics.contexts)).toBe(1);
  await chooseMode(page,'Radial rings');
  await expect(page.locator('canvas[aria-label="rings audio visualization"]')).toBeVisible();
  expect(await page.locator('canvas').evaluate(element=>(element as HTMLCanvasElement&{token?:string}).token)).toBe('persistent');
  await page.getByRole('link',{name:'Next'}).click();
  await expect(page).toHaveURL('/lab/dsp-for-artists/interference-patterns');
  await expect(page.locator('canvas[aria-label="crest audio visualization"]')).toBeVisible();
  expect(await page.locator('canvas').evaluate(element=>(element as HTMLCanvasElement&{token?:string}).token)).toBe('persistent');
  expect(await page.evaluate(()=>(window as typeof window&{__dspMetrics:{contexts:number}}).__dspMetrics.contexts)).toBe(1);
});

test('lesson routes preserve controls and all six visualization modes use one canvas', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing');
  await expect(page.getByRole('heading',{name:'Audio Processing'})).toBeVisible();
  await expect(page.locator('[data-control-group=layers]')).toHaveCount(0);
  await page.getByRole('slider',{name:'Tone 1 frequency (Hz)'}).fill('220');
  for(const [label,mode] of [['Radial rings','rings'],['FFT spectrogram','spectrogram'],['CWT scalogram','scalogram']] as const){await chooseMode(page,label);await expect(page.locator(`canvas[aria-label="${mode} audio visualization"]`)).toBeVisible();}
  await page.getByRole('link',{name:'Next'}).click();
  await expect(page.getByRole('slider',{name:'Tone 1 frequency (Hz)'})).toHaveValue('220');
  await expect(page.getByRole('slider',{name:'Layers'})).toHaveAttribute('min','1');
  await expect(page.locator('canvas[aria-label="crest audio visualization"]')).toBeVisible();
  await chooseMode(page,'Pressure sum');
  await expect(page.locator('canvas[aria-label="pressure audio visualization"]')).toBeVisible();
});

test('microphone source uses the existing engine and cleanup closes it once', async ({page}) => {
  await installAudioMock(page);
  await page.goto('/lab/dsp-for-artists/audio-processing');
  await page.getByRole('button',{name:'Start audio'}).click();
  await page.getByRole('button',{name:'Enable microphone'}).click();
  await expect(page.getByText('Microphone analyzing')).toBeVisible();
  expect(await page.evaluate(()=>(window as typeof window&{__dspMetrics:{contexts:number;microphones:number}}).__dspMetrics)).toMatchObject({contexts:1,microphones:1});
  await page.getByRole('link',{name:'Post Occupancy'}).click();
  await expect(page).toHaveURL('/');
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__dspMetrics:{closed:number}}).__dspMetrics.closed)).toBe(1);
});

test('crest and pressure preserve moving plane-wave output and respond to phase', async ({page}) => {
  await installAudioMock(page);
  await page.goto('/lab/dsp-for-artists/interference-patterns');
  await page.getByRole('button',{name:'Start audio'}).click();
  const canvas=page.locator('canvas');
  await page.waitForTimeout(350);
  const crestA=await canvas.evaluate(element=>(element as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(250);
  const crestB=await canvas.evaluate(element=>(element as HTMLCanvasElement).toDataURL());
  expect(crestB).not.toBe(crestA);
  await page.getByRole('slider',{name:'Phase (degrees)'}).fill('90');
  await page.waitForTimeout(100);
  const phased=await canvas.evaluate(element=>(element as HTMLCanvasElement).toDataURL());
  expect(phased).not.toBe(crestB);
  await chooseMode(page,'Pressure sum');
  await page.waitForTimeout(100);
  const pressure=await canvas.evaluate(element=>(element as HTMLCanvasElement).toDataURL());
  expect(pressure).not.toBe(phased);
});

test('course navigation expands to all lessons and malformed shared state is harmless', async ({page}) => {
  await page.goto('/lab/dsp-for-artists/audio-processing?sketch=broken');
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'Audio Processing'})).toHaveAttribute('aria-current','page');
  await expect(nav.getByRole('link',{name:'Interference Patterns'})).toBeVisible();
  await expect(page.locator('canvas[aria-label="stripes audio visualization"]')).toBeVisible();
});

test('invalid persisted controls cannot crash the renderer', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>sessionStorage.setItem('dsp-for-artists:v1',JSON.stringify({layers:Number.NaN,palette:'missing',rmsPulseDepth:'loud'})));
  await page.goto('/lab/dsp-for-artists/interference-patterns');
  await expect(page.locator('canvas[aria-label="crest audio visualization"]')).toBeVisible();
  await page.waitForTimeout(250);
  expect(errors).toEqual([]);
});

test('presentation receives parameters and analysis without frame React state', async ({page}) => {
  await installAudioMock(page);
  await page.goto('/lab/dsp-for-artists/make-some-art');
  await page.getByRole('button',{name:'Start audio'}).click();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Open presentation window'}).click();
  const presentation=await popupPromise;
  await expect(presentation).toHaveURL(/\/lab\/dsp-for-artists\/presentation\?session=/);
  await expect(presentation.locator('canvas[aria-label="rings audio visualization"]')).toBeVisible();
  await expect(presentation.getByText('Waiting for the tutorial window…')).toHaveCount(0);
  await presentation.close();
});
