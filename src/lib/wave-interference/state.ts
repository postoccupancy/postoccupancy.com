import {baseParameters,oscillator,type DspParameters} from '@/lib/dsp-for-artists/course';

export type WaveVisualization='fft'|'plane';
export type WaveGeometry='lines'|'rings';
export type WaveBlend='multiply'|'add'|'maximum'|'blend'|'screen';
export interface WaveState{visualization:WaveVisualization;geometry:WaveGeometry;layers:number;spacing:number;exposure:number;blend:WaveBlend;persistence:number}
export const waveDefaults:WaveState={visualization:'fft',geometry:'rings',layers:3,spacing:220,exposure:25,blend:'multiply',persistence:0};
export const wavePresets:{name:string;state:Pick<WaveState,'visualization'|'geometry'|'blend'|'spacing'>}[]=[
 {name:'FFT Lines',state:{visualization:'fft',geometry:'lines',blend:'multiply',spacing:80}},
 {name:'FFT Rings',state:{visualization:'fft',geometry:'rings',blend:'multiply',spacing:220}},
 {name:'Plane Lines',state:{visualization:'plane',geometry:'lines',blend:'multiply',spacing:80}},
 {name:'Plane Rings',state:{visualization:'plane',geometry:'rings',blend:'screen',spacing:220}},
];
const finite=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
export function validateWaveState(value:unknown):WaveState{const item=value&&typeof value==='object'?value as Partial<WaveState>:{};return{visualization:item.visualization==='plane'?'plane':'fft',geometry:item.geometry==='lines'?'lines':'rings',layers:Math.round(finite(item.layers,waveDefaults.layers,1,8)),spacing:finite(item.spacing,waveDefaults.spacing,0,400),exposure:finite(item.exposure,waveDefaults.exposure,-30,60),blend:['multiply','add','maximum','blend','screen'].includes(item.blend??'')?item.blend!:waveDefaults.blend,persistence:finite(item.persistence,waveDefaults.persistence,0,1)}}
export function encodeWaveState(state:WaveState){return btoa(encodeURIComponent(JSON.stringify(state))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
export function decodeWaveState(value:string|null){if(!value||value.length>2000)return waveDefaults;try{return validateWaveState(JSON.parse(decodeURIComponent(atob(value.replaceAll('-','+').replaceAll('_','/')))))}catch{return waveDefaults}}
export function rendererParameters(state:WaveState):DspParameters{const rings=state.geometry==='rings',plane=state.visualization==='plane',blend=plane?(state.blend==='screen'?'screen':'planeMultiply'):state.blend==='screen'?'multiply':state.blend;return{...baseParameters,analysis:'fft',mode:plane?'crest':rings?'rings':'stripes',waveGeometry:rings?'radial':'linear',layerLayout:rings?'circle':'line',layerRotation:rings?'even':'none',layoutRadius:state.spacing,xSpacing:state.spacing,ySpacing:state.spacing,angleOffset:0,exposure:state.exposure,persistence:state.persistence,blend,oscillators:Array.from({length:state.layers},(_,index)=>oscillator(`wave-layer-${index+1}`,110*Math.pow(1.45,index)))};}
