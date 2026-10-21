export const lessonSlugs = ['audio-processing', 'interference-patterns', 'make-some-art'] as const;
export type LessonSlug = (typeof lessonSlugs)[number];
export type ControlGroup = 'audio' | 'spectrum' | 'visualization' | 'layers' | 'geometry' | 'color' | 'rms';
export type DspMode = 'stripes' | 'rings' | 'crest' | 'pressure' | 'spectrogram' | 'scalogram';

export interface DspParameters {
  source: 'oscillator' | 'microphone'; oscillatorWave: OscillatorType; frequency: number; secondFrequency: number;
  analysis: 'fft' | 'cwt'; spectrum: 'raw' | 'relative'; frequencyAxis: 'log' | 'linear'; fftSize: number;
  mode: DspMode; layers: number; band: 'raw' | 'low' | 'mid' | 'high'; blend: 'multiply' | 'add' | 'maximum' | 'blend' | 'screen' | 'planeMultiply';
  blendAmount: number; direction: number; phase: number; propagation: number; radialExtent: number;
  palette: 'spectral' | 'mineral' | 'temperature' | 'mono'; rmsPulse: 'off' | 'thickness' | 'opacity'; rmsPulseDepth: number;
  rmsLuminosity: boolean; colorPulseDepth: number; pressureChroma: number; exposure: number; gate: number;
}

export const baseParameters: DspParameters = {
  source: 'oscillator', oscillatorWave: 'sawtooth', frequency: 110, secondFrequency: 165,
  analysis: 'fft', spectrum: 'raw', frequencyAxis: 'log', fftSize: 2048,
  mode: 'stripes', layers: 1, band: 'raw', blend: 'multiply', blendAmount: .5,
  direction: 0, phase: 0, propagation: 24, radialExtent: 400,
  palette: 'spectral', rmsPulse: 'off', rmsPulseDepth: 2, rmsLuminosity: false,
  colorPulseDepth: 2, pressureChroma: 1.5, exposure: 25, gate: 0,
};

export interface Lesson { slug: LessonSlug; number: number; title: string; summary: string; groups: ControlGroup[]; defaults: Partial<DspParameters>; exercises: string[]; }
export const lessons: Lesson[] = [
  { slug: 'audio-processing', number: 1, title: 'Audio Processing', summary: 'See how sound becomes samples, spectra, and time-frequency images.', groups: ['audio','spectrum','visualization'], defaults: { mode:'stripes', layers:1, analysis:'fft', band:'raw' }, exercises: ['Start the oscillator, then switch between FFT and CWT.', 'Compare logarithmic and linear frequency axes.', 'Try Low, Mid, and High filters, then enable the microphone.', 'Compare a live spectrum with its time-frequency history.'] },
  { slug: 'interference-patterns', number: 2, title: 'Interference Patterns', summary: 'Combine traveling waves and inspect constructive and destructive interference.', groups: ['audio','spectrum','visualization','layers','geometry','color'], defaults: { mode:'crest', layers:3, analysis:'fft', palette:'spectral' }, exercises: ['Change direction and phase without resetting propagation.', 'Compare Crest overlay with signed Pressure sum.', 'Tune the two oscillator frequencies to a simple ratio.', 'Find a geometry that produces a stable interference region.'] },
  { slug: 'make-some-art', number: 3, title: 'Make Some Art', summary: 'Use the complete instrument and save a restorable visual state.', groups: ['audio','spectrum','visualization','layers','geometry','color','rms'], defaults: { mode:'rings', layers:4, analysis:'cwt', palette:'mineral', rmsPulse:'thickness' }, exercises: ['Choose a preset and change at least three controls.', 'Use RMS to connect broadband energy to color or thickness.', 'Copy a sketch link and reopen it.', 'Open a presentation window and make a full-screen composition.'] },
];
export const lessonBySlug = (slug: string) => lessons.find((lesson) => lesson.slug === slug);

export const presets: Record<string, Partial<DspParameters>> = {
  'Spectral rings': { mode:'rings', analysis:'fft', layers:3, blend:'multiply', palette:'spectral' },
  'Mineral interference': { mode:'pressure', layers:5, blend:'planeMultiply', palette:'mineral', rmsLuminosity:true },
  'Bright field': { mode:'crest', layers:4, blend:'screen', palette:'temperature', rmsPulse:'opacity' },
  'CWT history': { mode:'scalogram', analysis:'cwt', palette:'spectral' },
};

const keys = Object.keys(baseParameters) as (keyof DspParameters)[];
const options:Partial<Record<keyof DspParameters,readonly unknown[]>>={
 source:['oscillator','microphone'],oscillatorWave:['sine','sawtooth','square','triangle'],analysis:['fft','cwt'],spectrum:['raw','relative'],frequencyAxis:['log','linear'],
 mode:['stripes','rings','crest','pressure','spectrogram','scalogram'],band:['raw','low','mid','high'],blend:['multiply','add','maximum','blend','screen','planeMultiply'],
 palette:['spectral','mineral','temperature','mono'],rmsPulse:['off','thickness','opacity'],fftSize:[512,1024,2048,4096,8192,16384],
};
export function validateParameters(input: unknown): Partial<DspParameters> {
  if (!input || typeof input !== 'object') return {};
  const candidate = input as Record<string, unknown>, output: Partial<DspParameters> = {};
  for (const key of keys) {
    const value = candidate[key]; const sample = baseParameters[key];
    if (typeof value === typeof sample && (!options[key] || options[key]?.includes(value))) (output as Record<string, unknown>)[key] = value;
  }
  if (output.frequency !== undefined) output.frequency = Math.min(1000, Math.max(40, output.frequency));
  if (output.secondFrequency !== undefined) output.secondFrequency = Math.min(1000, Math.max(40, output.secondFrequency));
  if (output.layers !== undefined) output.layers = Math.min(8, Math.max(1, Math.round(output.layers)));
  for(const key of ['blendAmount','rmsPulseDepth','colorPulseDepth','pressureChroma'] as const) if(output[key]!==undefined) output[key]=Math.max(0,Math.min(key==='blendAmount'?1:2,output[key]!));
  return output;
}
export function encodeSketch(parameters: DspParameters) {
  const changed = Object.fromEntries(keys.filter((key) => parameters[key] !== baseParameters[key]).map((key) => [key, parameters[key]]));
  return btoa(encodeURIComponent(JSON.stringify(changed))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export function decodeSketch(value: string | null): Partial<DspParameters> {
  if (!value || value.length > 4096) return {};
  try { return validateParameters(JSON.parse(decodeURIComponent(atob(value.replaceAll('-','+').replaceAll('_','/'))))); } catch { return {}; }
}
