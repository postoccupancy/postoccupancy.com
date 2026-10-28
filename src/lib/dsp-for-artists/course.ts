export const lessonSlugs = ['audio-processing', 'interference-patterns', 'make-some-art'] as const;
export type LessonSlug = (typeof lessonSlugs)[number];
export type DspMode = 'stripes' | 'rings' | 'timeFrequency' | 'pressure' | 'crest'; // crest is accepted only for legacy-state migration
export type BandFilter = 'raw' | 'low' | 'mid' | 'high';

export interface DspOscillator { id:string;playing:boolean;waveform:OscillatorType;frequency:number;levelDb:number;cutoff:number;direction:number;phase:number;band:BandFilter;sourceVoiceKey?:string;sourceAmplitude?:number }
export interface DspMicrophone { enabled:boolean;gainDb:number;visualInfluence:number;cutoff:number;direction:number;analyzing:boolean;monitoring:boolean }
export interface DspParameters {
 oscillators:DspOscillator[];microphone:DspMicrophone;monitorMuted:boolean;
 analysis:'fft'|'cwt';spectrum:'raw'|'relative';frequencyAxis:'log'|'linear';fftSize:number;cwtCycles:number;cwtAverage:number;harmonicMarkers:boolean;fixedDb:boolean;dbFloor:number;dbCeiling:number;
 mode:DspMode;blend:'multiply'|'add'|'maximum'|'blend'|'screen'|'planeMultiply';blendAmount:number;radialExtent:number;radialSourceRadius:number;
 waveGeometry:'linear'|'radial';layerLayout:'line'|'circle';layerSource:'separate'|'combined';layoutRadius:number;layerRotation:'none'|'even'|'fixed';angleStep:number;angleOffset:number;xSpacing:number;ySpacing:number;
 palette:'spectral'|'mineral'|'temperature'|'mono';rmsPulse:'off'|'thickness'|'opacity';rmsPulseDepth:number;rmsLuminosity:boolean;colorPulseDepth:number;pressureChroma:number;
 exposure:number;gate:number;adaptive:boolean;adaptation:number;contrast:number;response:number;persistence:number;diffusion:number;background:number;
}
export const oscillator=(id:string,frequency:number,direction=0):DspOscillator=>({id,playing:true,waveform:'sine',frequency,levelDb:-9,cutoff:4000,direction,phase:0,band:'raw'});
export const baseParameters:DspParameters={
 oscillators:[oscillator('oscillator-1',110,0)],microphone:{enabled:false,gainDb:0,visualInfluence:1.5,cutoff:12000,direction:0,analyzing:true,monitoring:false},monitorMuted:true,
 analysis:'fft',spectrum:'raw',frequencyAxis:'log',fftSize:2048,cwtCycles:6,cwtAverage:120,harmonicMarkers:false,fixedDb:false,dbFloor:-90,dbCeiling:-15,
 mode:'stripes',blend:'multiply',blendAmount:.5,radialExtent:400,radialSourceRadius:1,waveGeometry:'linear',layerLayout:'line',layerSource:'separate',layoutRadius:400,layerRotation:'none',angleStep:60,angleOffset:0,xSpacing:120,ySpacing:0,
 palette:'spectral',rmsPulse:'off',rmsPulseDepth:2,rmsLuminosity:false,colorPulseDepth:2,pressureChroma:1.5,exposure:25,gate:0,adaptive:false,adaptation:.5,contrast:1,response:0,persistence:0,diffusion:0,background:.08,
};
export interface Lesson {slug:LessonSlug;number:number;title:string;summary:string;defaults:Partial<DspParameters>;exercises:string[]}
export const lessons:Lesson[]=[
 {slug:'audio-processing',number:1,title:'Harmonics',summary:'Goal: see how all sounds are composed of pure sine waves.',defaults:{mode:'stripes',analysis:'fft',oscillators:[{...oscillator('oscillator-1',110),waveform:'sine'}]},
 exercises:[
    'You are now playing a single sine wave in Oscillator 1. Change its frequency and level. Unmute audio to hear the result.',
    'Add a second sine wave. Change its frequency and level. Notice how the resulting waveform changes.',
    'Turn off the second oscillator and change the waveform to sawtooth. Notice the smooth harmonic series -- a sawtooth wave is a synthesized sound computed as the combination of all harmonics from a fundamental tone.',
    'Try adjusting the cutoff filter -- also known as a low-pass filter. This removes higher harmonics from the sound.',
    'Turn off the oscillator and enable the microphone. Sing or whistle or speak -- what kind of waveform does it create? Do you see harmonics?',
    'Notice how this visualization has only one axis. Amplitude is expressed as color intensity. The y-axis is up for grabs. Try changing the visualization to Radial.',
    'Change the visualization to Time. Notice how the x-axis is now time and the y-axis is frequency. The color intensity represents amplitude.',
]},
 {slug:'interference-patterns',number:2,title:'Interference',summary:'Goal: see how waves combine in space.',defaults:{mode:'pressure',analysis:'fft',layerSource:'combined',oscillators:[oscillator('oscillator-1',110),{...oscillator('oscillator-2',165),playing:false}]},
 exercises:[
    'Waveforms can also combine differently depending on their relationship in space. Watch this visualization of a sine waveform as seen from above. Darker areas represent higher amplitude.',
    'Play the second sine wave and change its direction between 180 and 0 degrees. Notice how the resulting waveform changes for someone standing in the middle.',
    'Try changing waveform shapes and angles to see how interference patterns vary.',
    'Most sound sources emit pressure waves radially, rather than as parallel lines. Under Layers, change Wave geometry to Radial; use Layer arrangement separately to position the source origins.',
    'Try different methods of representing the interference. Change the blend mode to screen, then compare Combined output with Separate sources.',
]},
 {slug:'make-some-art',number:3,title:'Sandbox',summary:'Goal: Use the complete instrument and save a restorable visual state.',defaults:{mode:'rings',analysis:'cwt',waveGeometry:'radial',oscillators:[oscillator('oscillator-1',110),oscillator('oscillator-2',165),oscillator('oscillator-3',220)],rmsPulse:'thickness'},exercises:[
    'Open the Expression control panel and try the Exposure control. This increases the intensity of peaks.',
    'Turn on the mic and adjust the Noise gate. This removes signal below a certain amplitude level, such as background noise.',
    'Try smoothness and persistence. These slow the rate of response to the incoming signal. This can be useful for creating a more stable image.',
    'Try laying out the oscillators at different angles, such as evenly spaced, or at a fixed angle step.',
    'Try the different blend modes and adjust other parameters to find sweet spots.',
    'If you find a combination you like, find the Copy Sketch Link option in the top right and save it. You can restore this state later by pasting the URL into your browser.',
]},
];
export const lessonBySlug=(slug:string)=>lessons.find(lesson=>lesson.slug===slug);
const options:Partial<Record<keyof DspParameters,readonly unknown[]>>={analysis:['fft','cwt'],spectrum:['raw','relative'],frequencyAxis:['log','linear'],mode:['stripes','rings','timeFrequency','pressure'],blend:['multiply','add','maximum','blend','screen','planeMultiply'],palette:['spectral','mineral','temperature','mono'],rmsPulse:['off','thickness','opacity'],fftSize:[512,1024,2048,4096,8192,16384],waveGeometry:['linear','radial'],layerLayout:['line','circle'],layerSource:['separate','combined'],layerRotation:['none','even','fixed']};
const finite=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.min(max,Math.max(min,value)):fallback;
function validateOscillator(value:unknown,index:number):DspOscillator|null{if(!value||typeof value!=='object')return null;const item=value as Partial<DspOscillator>&{visible?:boolean},fallback=oscillator(`oscillator-${index+1}`,110*Math.pow(1.5,index)),playing=(typeof item.playing==='boolean'?item.playing:true)&&item.visible!==false;return{id:typeof item.id==='string'&&item.id?item.id:fallback.id,playing,waveform:['sine','sawtooth','square','triangle'].includes(item.waveform??'')?item.waveform!:fallback.waveform,frequency:finite(item.frequency,fallback.frequency,20,12000),levelDb:finite(item.levelDb,-9,-60,6),cutoff:finite(item.cutoff,4000,40,20000),direction:finite(item.direction,0,0,360),phase:finite(item.phase,0,0,360),band:['raw','low','mid','high'].includes(item.band??'')?item.band!:fallback.band};}
export function validateParameters(input:unknown):Partial<DspParameters>{if(!input||typeof input!=='object')return{};const candidate=input as Record<string,unknown>,output:Partial<DspParameters>={};for(const key of Object.keys(baseParameters) as (keyof DspParameters)[]){if(key==='oscillators'||key==='microphone')continue;const value=candidate[key],sample=baseParameters[key];if(typeof value===typeof sample&&(!(typeof value==='number')||Number.isFinite(value))&&(!options[key]||options[key]?.includes(value)))(output as Record<string,unknown>)[key]=value;}if(candidate.mode==='crest')output.mode='pressure';if(output.waveGeometry===undefined)output.waveGeometry=candidate.mode==='rings'?'radial':'linear';if(output.layerRotation===undefined&&['even','fixed'].includes(String(candidate.angleDistribution)))output.layerRotation=candidate.angleDistribution as 'even'|'fixed';if(Array.isArray(candidate.oscillators)){const ids=new Set<string>(),items=candidate.oscillators.slice(0,8).map(validateOscillator).filter((value):value is DspOscillator=>!!value).map((item,index)=>{const id=ids.has(item.id)?`oscillator-${index+1}`:item.id;ids.add(id);return{...item,id}});output.oscillators=items;}if(candidate.microphone&&typeof candidate.microphone==='object'){const mic=candidate.microphone as Partial<DspMicrophone>&{visible?:boolean},base=baseParameters.microphone;output.microphone={enabled:(typeof mic.enabled==='boolean'?mic.enabled:base.enabled)&&mic.visible!==false,gainDb:finite(mic.gainDb,base.gainDb,-60,24),visualInfluence:finite(mic.visualInfluence,base.visualInfluence,0,4),cutoff:finite(mic.cutoff,base.cutoff,40,20000),direction:finite(mic.direction,base.direction,0,360),analyzing:typeof mic.analyzing==='boolean'?mic.analyzing:base.analyzing,monitoring:typeof mic.monitoring==='boolean'?mic.monitoring:false};}return output;}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function encodeSketch(parameters:DspParameters){const changed=Object.fromEntries((Object.keys(baseParameters) as (keyof DspParameters)[]).filter(key=>!equal(parameters[key],baseParameters[key])).map(key=>[key,parameters[key]]));if(parameters.mode==='pressure')changed.layerSource=parameters.layerSource;return btoa(encodeURIComponent(JSON.stringify(changed))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function decodeSketch(value:string|null):Partial<DspParameters>{if(!value||value.length>12000)return{};try{const candidate=JSON.parse(decodeURIComponent(atob(value.replaceAll('-','+').replaceAll('_','/')))) as Record<string,unknown>,output=validateParameters(candidate);if(candidate.mode==='pressure'&&candidate.layerSource===undefined)output.layerSource='combined';return output;}catch{return{}}}
