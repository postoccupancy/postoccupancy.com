import type { BandFilter, DspOscillator, DspParameters } from './course';
import { DSP_BANDS, DSP_MAX_HZ, DSP_MIN_HZ, dspBandFrequency, type DspAnalysisFrame } from './engine';

export interface DspRendererContract {
  setParameters(parameters: DspParameters): void;
  pushFrame(frame: DspAnalysisFrame): void;
  resize(width: number, height: number, pixelRatio: number): void;
  render(now: number): void;
  destroy(): void;
}

const clamp = (value: number, low = 0, high = 1) => Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : low;
const spectralStops = [[5,9,25],[25,35,100],[20,135,170],[225,185,70],[255,225,135]];
const palettes: Record<string, string[]> = {
  spectral:['#183B58','#236781','#3A8C99','#83B7A4','#D4C5A0','#C88872','#9A536B','#653D67'],
  mineral:['#20374A','#405B66','#6B8588','#A3AF9E','#C8B89D','#C5A28A','#A98377','#745B60'],
  temperature:['#233D58','#426584','#7892A3','#BBC4C3','#E0D0AE','#C6A77D','#9B7658','#68535A'],
};

export function colorAt(stops: number[][], value: number) {
  if (!stops.length) return [0,0,0];
  const position = clamp(value) * .999999 * (stops.length - 1), index = Math.floor(position), fraction = position - index;
  const left = stops[index] ?? stops[0], right = stops[Math.min(stops.length - 1, index + 1)] ?? left;
  return left.map((component, channel) => Math.round(component + ((right[channel] ?? component) - component) * fraction));
}

function hexRgb(value: string) { return [1,3,5].map(offset => parseInt(value.slice(offset, offset + 2), 16)); }
export function visualSources(parameters:DspParameters){const sources=parameters.oscillators.filter(item=>item.playing).map(item=>({direction:item.direction,phase:item.phase,band:item.band,frequency:item.frequency}));if(parameters.microphone.enabled)sources.push({direction:parameters.microphone.direction,phase:0,band:'raw' as const,frequency:0});return sources;}

class SpectralState {
  private shown = new Float32Array(DSP_BANDS).fill(-120);
  private held = new Float32Array(DSP_BANDS).fill(-120);
  private lastSequence = -1;
  private lastAt = 0;
  private adaptiveReference: number | null = null;
  private adaptiveLevel: number | null = null;
  private adaptiveGain = 0;

  update(frame: DspAnalysisFrame, parameters: DspParameters) {
    if (frame.sequence === this.lastSequence) return;
    this.lastSequence = frame.sequence;
    const measured = parameters.analysis === 'cwt' && frame.cwtBandsDb ? frame.cwtBandsDb : frame.fftBandsDb;
    const dt = this.lastAt ? Math.max(.001, Math.min(.5, (frame.timestamp - this.lastAt) / 1000)) : .05;
    this.lastAt = frame.timestamp;
    const smooth = parameters.response, tau = smooth === 0 ? 0 : .05 * smooth / (1 - smooth), alpha = tau === 0 ? 1 : 1 - Math.exp(-dt / tau);
    const release = parameters.persistence === 0 ? 1 : 1 - Math.exp(-dt / (4 * parameters.persistence));
    let total = 0;
    for (let index = 0; index < DSP_BANDS; index++) {
      const value = Number.isFinite(measured[index]) ? measured[index] : -120;
      this.held[index] = value >= this.held[index] ? value : this.held[index] + (value - this.held[index]) * release;
      this.shown[index] += (this.held[index] - this.shown[index]) * alpha;
      total += value;
    }
    const current = total / DSP_BANDS;
    if (parameters.adaptive) {
      if (this.adaptiveReference === null) this.adaptiveReference = this.adaptiveLevel = current;
      const follow = 1 - Math.exp(-dt / (current > (this.adaptiveLevel ?? current) ? 3 : 12));
      this.adaptiveLevel! += (current - this.adaptiveLevel!) * follow;
      this.adaptiveGain = clamp(this.adaptiveReference - this.adaptiveLevel!, -18, 18) * parameters.adaptation;
    } else this.adaptiveGain = 0;
  }

  allValues(parameters: DspParameters): Record<BandFilter, Float32Array> {
    const base = new Float32Array(DSP_BANDS);
    let relative: Float32Array | null = null;
    if (parameters.spectrum === 'relative') {
      relative = new Float32Array(DSP_BANDS); let peak = 0;
      for (let index = 0; index < DSP_BANDS; index++) {
        const neighbors:number[] = [], center = dspBandFrequency(index);
        for (let other = 0; other < DSP_BANDS; other++) if (Math.abs(Math.log2(dspBandFrequency(other) / center)) <= .5) neighbors.push(Math.pow(10, this.shown[other] / 10));
        neighbors.sort((a,b)=>a-b);
        const median = neighbors[neighbors.length >> 1] || 1e-12;
        const value = Math.max(0, Math.log2(Math.max(Math.pow(10, this.shown[index] / 10) / median, 1e-12)));
        relative[index] = value; peak = Math.max(peak, value);
      }
      if (peak > 0) for (let index = 0; index < DSP_BANDS; index++) relative[index] /= peak;
    }
    const floor = -95 + parameters.gate;
    for (let index = 0; index < DSP_BANDS; index++) {
      const db = this.shown[index];
      if (parameters.gate > 0 && db < floor) continue;
      const intensity = relative ? relative[index] : parameters.fixedDb ? clamp((db - parameters.dbFloor) / Math.max(1, parameters.dbCeiling - parameters.dbFloor)) : clamp((db + parameters.exposure + this.adaptiveGain + 72) / 54);
      base[index] = Math.pow(intensity, parameters.contrast);
    }
    const channels = {raw:base,low:new Float32Array(base),mid:new Float32Array(base),high:new Float32Array(base)};
    for(let index=0;index<DSP_BANDS;index++){const frequency=dspBandFrequency(index);if(frequency>350)channels.low[index]=0;if(frequency<350||frequency>1500)channels.mid[index]=0;if(frequency<1500)channels.high[index]=0;}
    if(parameters.diffusion<=0)return channels;
    const sigma=parameters.diffusion*1.8,radius=Math.ceil(3*sigma);
    for(const channel of Object.keys(channels) as BandFilter[]){const input=channels[channel],output=new Float32Array(DSP_BANDS);for(let index=0;index<DSP_BANDS;index++){let sum=0,weight=0;for(let other=Math.max(0,index-radius);other<=Math.min(DSP_BANDS-1,index+radius);other++){const w=Math.exp(-.5*((other-index)/sigma)**2);sum+=input[other]*w;weight+=w;}output[index]=sum/weight;}channels[channel]=output;}
    return channels;
  }

  values(channel:BandFilter,parameters:DspParameters){return this.allValues(parameters)[channel];}
}

const SOUND_SPEED_METERS_PER_SECOND=343;
const PLANE_SPATIAL_SCALE_METERS=12;
const PLANE_PLAYBACK_RATE=.01;
const VIRTUAL_LISTENER={x:.25,y:.15};
type PhysicalSource=({kind:'oscillator';oscillator:DspOscillator}|{kind:'microphone'})&{direction:number;index:number;count:number};

export function layerDirectionDegrees(sourceDirection:number,index:number,count:number,parameters:Pick<DspParameters,'layerLayout'|'layerRotation'|'angleStep'|'angleOffset'>){if(parameters.layerLayout==='line')return sourceDirection+parameters.angleOffset;const direction=parameters.layerRotation==='even'?index*360/Math.max(1,count):parameters.layerRotation==='fixed'?index*parameters.angleStep:0;return direction+parameters.angleOffset;}
export function layerOrigin(index:number,count:number,parameters:Pick<DspParameters,'layerLayout'|'layoutRadius'|'xSpacing'|'ySpacing'|'layerRotation'|'angleStep'|'angleOffset'>){if(parameters.layerLayout==='circle'){const angle=layerDirectionDegrees(0,index,count,parameters)*Math.PI/180;return{x:parameters.layoutRadius*Math.cos(angle),y:parameters.layoutRadius*Math.sin(angle)};}const offset=index-(count-1)/2;return{x:offset*parameters.xSpacing,y:offset*parameters.ySpacing};}

export function physicalWavelength(frequency:number,soundSpeed=SOUND_SPEED_METERS_PER_SECOND){return soundSpeed/frequency;}
export function oscillatorPressure(waveform:OscillatorType,frequency:number,time:number,phaseRadians=0){const angle=2*Math.PI*frequency*time+phaseRadians;if(waveform==='square')return Math.sin(angle)>=0?1:-1;if(waveform==='sawtooth'){const cycle=angle/(2*Math.PI);return 2*(cycle-Math.floor(cycle+.5));}if(waveform==='triangle')return 2/Math.PI*Math.asin(Math.sin(angle));return Math.sin(angle);}
export function travelingWaveTime(elapsed:number,distanceMeters:number,soundSpeed=SOUND_SPEED_METERS_PER_SECOND){return elapsed-distanceMeters/soundSpeed;}
export function directionalDistanceMeters(x:number,y:number,directionDegrees:number,spatialScale:number){const radians=directionDegrees*Math.PI/180;return(Math.cos(radians)*x+Math.sin(radians)*y+Math.SQRT2/2)*spatialScale;}
export function virtualListenerDistanceMeters(directionDegrees:number){return directionalDistanceMeters(VIRTUAL_LISTENER.x,VIRTUAL_LISTENER.y,directionDegrees,PLANE_SPATIAL_SCALE_METERS);}
export function modeledOscillatorPressureAtListener(source:DspOscillator,time:number,angleOffset=0){const delay=virtualListenerDistanceMeters(source.direction+angleOffset)/SOUND_SPEED_METERS_PER_SECOND,level=.35*Math.pow(10,source.levelDb/20);return level*oscillatorPressure(source.waveform,source.frequency,time-delay,source.phase*Math.PI/180);}

interface SpectrumGeometryLayer{angle:number;cos:number;sin:number;x:number;y:number;channel:BandFilter;positions:Float32Array}

class PlaneState {
  private size=540;
  private elapsed=0;
  private previous=0;
  private pulseEnvelope=0;
  private imageData:ImageData|null=null;
  private canvas=document.createElement('canvas');
  private context:CanvasRenderingContext2D;
  private microphoneHistory=new Float32Array(48000*8);
  private microphoneWrite=0;
  private microphoneOldest=0;
  private microphonePlayhead=0;
  private microphoneRate=48000;
  private microphoneReference=.02;
  private compositeRange:[number,number]=[0,0];

  constructor(){this.canvas.width=this.size;this.canvas.height=this.size;this.context=this.canvas.getContext('2d',{alpha:false})!;}
  resize(size:number){if(size===this.size)return;this.size=size;this.canvas.width=size;this.canvas.height=size;this.context=this.canvas.getContext('2d',{alpha:false})!;this.imageData=null;}

  push(frame:DspAnalysisFrame,parameters:DspParameters){const dt=this.previous?Math.min(.1,Math.max(.001,(frame.timestamp-this.previous)/1000)):.05;this.previous=frame.timestamp;this.elapsed+=dt*PLANE_PLAYBACK_RATE;const target=clamp(frame.rms/.075),tau=target>this.pulseEnvelope?.045:.3;this.pulseEnvelope+=(target-this.pulseEnvelope)*(1-Math.exp(-dt/tau));if(!parameters.microphone.enabled){this.microphoneWrite=this.microphoneOldest=this.microphonePlayhead=0;this.microphoneReference=.02;return;}const microphone=frame.microphoneSamples;if(microphone?.length){if(frame.sampleRate!==this.microphoneRate){this.microphoneRate=frame.sampleRate;this.microphoneHistory=new Float32Array(Math.round(frame.sampleRate*8));this.microphoneWrite=this.microphoneOldest=this.microphonePlayhead=0;}let energy=0,peak=0;for(const sample of microphone){energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));this.microphoneHistory[this.microphoneWrite%this.microphoneHistory.length]=sample;this.microphoneWrite++;if(this.microphoneWrite-this.microphoneOldest>this.microphoneHistory.length)this.microphoneOldest++;}const rms=Math.sqrt(energy/microphone.length),level=Math.max(rms*2.5,peak*.35),silent=level<.0015,envelopeTarget=silent?.02:Math.max(.006,level),envelopeTau=silent?.12:envelopeTarget>this.microphoneReference?.025:.35;this.microphoneReference+=(envelopeTarget-this.microphoneReference)*(1-Math.exp(-dt/envelopeTau));this.microphonePlayhead=this.microphoneWrite-2;}}

  render(parameters:DspParameters){const size=this.size,ctx=this.context,sources=this.sources(parameters);ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);if(!this.imageData)this.imageData=ctx.createImageData(size,size);const pixels=this.imageData.data,screen=parameters.palette!=='mono'&&parameters.blend==='screen',pulse=this.pulseEnvelope*parameters.rmsPulseDepth,colorPulse=parameters.rmsLuminosity?this.pulseEnvelope*parameters.colorPulseDepth:0,gain=Math.pow(10,parameters.exposure/40),states=sources.map((source,index)=>({source,color:this.sourceColor(index,sources.length,parameters.palette),geometry:this.geometry(source,parameters),amplitude:this.sourceAmplitude(source)})),samples=new Float32Array(states.length);let minimum=Infinity,maximum=-Infinity;
    for(let pixel=0;pixel<size*size;pixel++){const y=Math.floor(pixel/size)+.5,x=pixel%size+.5,offset=pixel*4;let sum=0;for(let index=0;index<states.length;index++){const state=states[index],value=this.sourceAt(state.source,this.distanceMeters(x,y,state.geometry),0,parameters);samples[index]=value;sum+=value;}minimum=Math.min(minimum,sum);maximum=Math.max(maximum,sum);if(parameters.mode==='pressure'&&parameters.layerSource==='combined'){let normalized=clamp(sum*gain,-1,1);if(parameters.rmsPulse==='thickness')normalized=Math.sign(normalized)*(1-Math.pow(1-Math.abs(normalized),1+pulse));else if(parameters.rmsPulse==='opacity')normalized=clamp(normalized*(1+pulse),-1,1);if(parameters.blend==='screen'){const color=colorAt(spectralStops,.5+.5*normalized),strength=.25+.75*Math.abs(normalized);pixels[offset]=255-(255-color[0])*(1-strength);pixels[offset+1]=255-(255-color[1])*(1-strength);pixels[offset+2]=255-(255-color[2])*(1-strength);}else pixels[offset]=pixels[offset+1]=pixels[offset+2]=127.5+127.5*normalized;
      }else if(parameters.pressureComposition==='organic'){let signed=clamp(sum*gain,-1,1);if(parameters.rmsPulse==='thickness')signed=Math.sign(signed)*(1-Math.pow(1-Math.abs(signed),1+pulse));else if(parameters.rmsPulse==='opacity')signed=clamp(signed*(1+pulse),-1,1);const strength=clamp(Math.max(0,signed)*(1+colorPulse));let weight=0,red=0,green=0,blue=0;for(let layerIndex=0;layerIndex<states.length;layerIndex++){const contribution=Math.max(0,samples[layerIndex]*gain),color=states[layerIndex].color;weight+=contribution;red+=color[0]*contribution;green+=color[1]*contribution;blue+=color[2]*contribution;}const color=weight>0?[red/weight,green/weight,blue/weight]:[0,0,0];if(screen){pixels[offset]=strength*color[0];pixels[offset+1]=strength*color[1];pixels[offset+2]=strength*color[2];}else{pixels[offset]=255-strength*(255-color[0]);pixels[offset+1]=255-strength*(255-color[1]);pixels[offset+2]=255-strength*(255-color[2]);}
      }else{let r=screen?0:255,g=r,b=r;for(let layerIndex=0;layerIndex<states.length;layerIndex++){const state=states[layerIndex],color=state.color;let signed=clamp(samples[layerIndex]*gain,-1,1);if(parameters.rmsPulse==='thickness')signed=Math.sign(signed)*(1-Math.pow(1-Math.abs(signed),1+pulse));else if(parameters.rmsPulse==='opacity')signed=clamp(signed*(1+pulse),-1,1);const strength=clamp(Math.max(0,signed)*(1+colorPulse));if(screen){r=255*(1-(1-r/255)*(1-strength*color[0]/255));g=255*(1-(1-g/255)*(1-strength*color[1]/255));b=255*(1-(1-b/255)*(1-strength*color[2]/255));}else{r*=1-strength*(1-color[0]/255);g*=1-strength*(1-color[1]/255);b*=1-strength*(1-color[2]/255);}}pixels[offset]=r;pixels[offset+1]=g;pixels[offset+2]=b;}pixels[offset+3]=255;}
    this.compositeRange=states.length?[minimum,maximum]:[0,0];ctx.putImageData(this.imageData,0,0);return this.canvas;}

  diagnostics(){return{range:this.compositeRange,microphoneLagSamples:Math.max(0,this.microphoneWrite-2-this.microphonePlayhead)};}

  private sources(parameters:DspParameters):PhysicalSource[]{const active:Array<{kind:'oscillator';oscillator:DspOscillator}|{kind:'microphone'}>=parameters.oscillators.filter(item=>item.playing).map(oscillator=>({kind:'oscillator',oscillator}));if(parameters.microphone.enabled)active.push({kind:'microphone'});return active.map((source,index)=>({...source,index,count:active.length,direction:layerDirectionDegrees(source.kind==='oscillator'?source.oscillator.direction:parameters.microphone.direction,index,active.length,parameters)}));}
  private sourceAmplitude(source:PhysicalSource){return source.kind==='oscillator' ? .35*Math.pow(10,source.oscillator.levelDb/20) : Math.max(.006,this.microphoneReference);}
  private sourceAt(source:PhysicalSource,distanceMeters:number,timeOffset:number,parameters:DspParameters){const time=travelingWaveTime(this.elapsed+timeOffset,distanceMeters);if(source.kind==='oscillator')return this.sourceAmplitude(source)*oscillatorPressure(source.oscillator.waveform,source.oscillator.frequency,time,source.oscillator.phase*Math.PI/180);const position=this.microphonePlayhead+(time-this.elapsed)*this.microphoneRate,left=Math.floor(position),fraction=position-left;if(left<this.microphoneOldest||left+1>=this.microphoneWrite)return 0;const sample=this.microphoneHistory[left%this.microphoneHistory.length]+(this.microphoneHistory[(left+1)%this.microphoneHistory.length]-this.microphoneHistory[left%this.microphoneHistory.length])*fraction;return sample*parameters.microphone.visualInfluence;}
  private geometry(source:PhysicalSource,parameters:DspParameters){const radians=source.direction*Math.PI/180,dx=Math.cos(radians),dy=Math.sin(radians),corner=this.size*Math.SQRT2/2,origin=layerOrigin(source.index,source.count,parameters),sourceX=this.size/2+origin.x/570*this.size,sourceY=this.size/2+origin.y/570*this.size;return{dx,dy,corner,radial:parameters.waveGeometry==='radial',sourceX,sourceY};}
  private distanceMeters(x:number,y:number,geometry:ReturnType<PlaneState['geometry']>){if(!geometry.radial){const localX=(x-geometry.sourceX)/this.size,localY=(y-geometry.sourceY)/this.size;return directionalDistanceMeters(localX,localY,Math.atan2(geometry.dy,geometry.dx)*180/Math.PI,PLANE_SPATIAL_SCALE_METERS);}return Math.hypot(x-geometry.sourceX,y-geometry.sourceY)*PLANE_SPATIAL_SCALE_METERS/this.size;}
  private sourceColor(index:number,count:number,palette:string){if(palette==='mono')return[0,0,0];const anchors=palettes[palette]??palettes.spectral,position=count<=1?3.5:index/(count-1)*7,left=Math.min(6,Math.floor(position)),fraction=position-left,a=hexRgb(anchors[left]),b=hexRgb(anchors[left+1]);return a.map((value,channel)=>value+(b[channel]-value)*fraction);}
}

export class WorkshopRenderer implements DspRendererContract {
  private parameters:DspParameters;
  private frame:DspAnalysisFrame|null=null;
  private width=1;private height=1;private pixelRatio=1;
  private context:CanvasRenderingContext2D;
  private spectral=new SpectralState();
  private plane=new PlaneState();
  private fftRaster=document.createElement('canvas');
  private fftImage:ImageData|null=null;
  private spectrumGeometryKey='';
  private spectrumGeometryLayers:SpectrumGeometryLayer[]=[];
  private spectrumGeometryBuilds=0;
  private historyRaster=document.createElement('canvas');
  private historyContext=this.historyRaster.getContext('2d',{alpha:false})!;
  private lastHistorySequence=-1;
  private dirty=true;

  constructor(private canvas:HTMLCanvasElement,parameters:DspParameters){this.parameters=parameters;this.context=canvas.getContext('2d',{alpha:false})!;}
  setParameters(parameters:DspParameters){this.parameters=parameters;this.dirty=true;}
  pushFrame(frame:DspAnalysisFrame){this.frame=frame;this.spectral.update(frame,this.parameters);this.plane.push(frame,this.parameters);this.dirty=true;}
  resize(width:number,height:number,pixelRatio:number){const nextWidth=Math.max(1,width),nextHeight=Math.max(1,height),nextRatio=Math.max(1,pixelRatio),logicalChanged=nextWidth!==this.width||nextHeight!==this.height||nextRatio!==this.pixelRatio;this.width=nextWidth;this.height=nextHeight;this.pixelRatio=nextRatio;if(logicalChanged)this.dirty=true;if(this.canvas.width!==Math.round(nextWidth*nextRatio)||this.canvas.height!==Math.round(nextHeight*nextRatio)){this.canvas.width=Math.round(nextWidth*nextRatio);this.canvas.height=Math.round(nextHeight*nextRatio);this.context.setTransform(nextRatio,0,0,nextRatio,0,0);this.dirty=true;}}
  render(now:number){if(!Number.isFinite(now)||!this.dirty)return;this.dirty=false;const p=this.parameters,waveformHeight=this.waveformHeight(),size=this.rasterSize(waveformHeight),plane=p.mode==='pressure',sources=visualSources(p);this.canvas.dataset.layerDirections=sources.map((source,index)=>layerDirectionDegrees(source.direction,index,sources.length,p)).join(',');this.canvas.dataset.layerOrigins=sources.map((_,index)=>{const origin=layerOrigin(index,sources.length,p);return`${origin.x.toFixed(2)}:${origin.y.toFixed(2)}`}).join(',');this.context.fillStyle='#050919';this.context.fillRect(0,0,this.width,this.height);if(plane){this.plane.resize(size);this.drawContained(this.plane.render(p),waveformHeight);const diagnostics=this.plane.diagnostics();delete this.canvas.dataset.planeOverlays;this.canvas.dataset.planePressureRange=diagnostics.range.join(',');this.canvas.dataset.planeMicrophoneLagSamples=String(diagnostics.microphoneLagSamples);}else if(p.mode==='timeFrequency')this.renderHistory(size,waveformHeight);else this.renderSpectrum(size,waveformHeight);this.renderWaveform(waveformHeight);}
  destroy(){this.fftRaster.width=this.fftRaster.height=this.historyRaster.width=this.historyRaster.height=0;}

  private renderSpectrum(size:number,waveformHeight:number){const p=this.parameters,channels=this.spectral.allValues(p);if(!this.fftImage||this.fftImage.width!==size)this.fftImage=new ImageData(size,size);const data=this.fftImage.data,visible=visualSources(p),layers=this.spectrumGeometry(size,p,visible);
    for(let pixel=0;pixel<size*size;pixel++){let product=1,sum=0,maximum=0;for(const layer of layers){const position=layer.positions[pixel],left=Math.floor(position),right=Math.min(DSP_BANDS-1,left+1),values=channels[layer.channel],value=clamp(values[left]+(values[right]-values[left])*(position-left));product*=value;sum+=value;maximum=Math.max(maximum,value);}const added=layers.length?sum/layers.length:0,multiplied=layers.length?Math.pow(product,1/layers.length):0,combined=p.blend==='add'?added:p.blend==='maximum'?maximum:p.blend==='blend'?added*(1-p.blendAmount)+multiplied*p.blendAmount:multiplied,color=colorAt(spectralStops,p.background+(1-p.background)*combined),offset=4*pixel;data[offset]=color[0];data[offset+1]=color[1];data[offset+2]=color[2];data[offset+3]=255;}
    if(this.fftRaster.width!==size)this.fftRaster.width=size;if(this.fftRaster.height!==size)this.fftRaster.height=size;const rasterContext=this.fftRaster.getContext('2d',{alpha:false})!;rasterContext.putImageData(this.fftImage,0,0);
    if(p.harmonicMarkers&&p.waveGeometry==='linear'&&layers.length===1&&(visible[0]?.frequency??0)>0){const layer=layers[0],fundamental=visible[0].frequency,range=layer.channel==='low'?[DSP_MIN_HZ,350]:layer.channel==='mid'?[350,1500]:layer.channel==='high'?[1500,DSP_MAX_HZ]:[DSP_MIN_HZ,DSP_MAX_HZ],extent=.5*(Math.abs(layer.cos)+Math.abs(layer.sin)),vx=-layer.sin,vy=layer.cos;rasterContext.save();rasterContext.strokeStyle='rgba(255,231,139,.55)';rasterContext.fillStyle='rgba(255,231,139,.85)';rasterContext.font='10px monospace';for(let harmonic=1;harmonic*fundamental<=range[1]&&harmonic<=100;harmonic++){const frequency=harmonic*fundamental;if(frequency<range[0])continue;const u=p.frequencyAxis==='linear'?(frequency-range[0])/(range[1]-range[0]):Math.log(frequency/range[0])/Math.log(range[1]/range[0]),projected=(2*u-1)*extent,cx=layer.x+layer.cos*projected,cy=layer.y+layer.sin*projected;rasterContext.beginPath();rasterContext.moveTo(size*(.5+cx-vx*2),size*(.5+cy-vy*2));rasterContext.lineTo(size*(.5+cx+vx*2),size*(.5+cy+vy*2));rasterContext.stroke();if(harmonic<=12)rasterContext.fillText(String(harmonic),size*(.5+cx)+4,size*(.5+cy)+10);}rasterContext.restore();}
    this.drawContained(this.fftRaster,waveformHeight);
  }

  private spectrumGeometry(size:number,p:DspParameters,visible:ReturnType<typeof visualSources>){const identities=visible.map(source=>`${source.direction}:${source.band}`).join('|'),key=[size,p.waveGeometry,p.radialExtent,p.frequencyAxis,p.layerSource,p.layerLayout,p.layerRotation,p.layoutRadius,p.xSpacing,p.ySpacing,p.angleStep,p.angleOffset,identities].join(':');if(key===this.spectrumGeometryKey)return this.spectrumGeometryLayers;this.spectrumGeometryKey=key;this.spectrumGeometryBuilds++;this.canvas.dataset.spectrumGeometryBuilds=String(this.spectrumGeometryBuilds);this.spectrumGeometryLayers=visible.map((source,index)=>{const angle=layerDirectionDegrees(source.direction,index,visible.length,p)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),origin=layerOrigin(index,visible.length,p),x=origin.x/570,y=origin.y/570,channel=p.layerSource==='combined'?'raw':source.band,positions=new Float32Array(size*size),range=channel==='low'?[DSP_MIN_HZ,350]:channel==='mid'?[350,1500]:channel==='high'?[1500,DSP_MAX_HZ]:[DSP_MIN_HZ,DSP_MAX_HZ];for(let pixel=0;pixel<positions.length;pixel++){const px=pixel%size,py=Math.floor(pixel/size),cx=(px+.5)/size-.5,cy=(py+.5)/size-.5;let u;if(p.waveGeometry==='radial')u=clamp(Math.hypot(cx-x,cy-y)/(p.radialExtent/570));else{const projected=(cx-x)*cos+(cy-y)*sin,extent=.5*(Math.abs(cos)+Math.abs(sin));u=clamp((projected+extent)/(2*extent));}const frequency=p.frequencyAxis==='linear'?range[0]+(range[1]-range[0])*u:range[0]*Math.pow(range[1]/range[0],u);positions[pixel]=clamp(Math.log(frequency/DSP_MIN_HZ)/Math.log(DSP_MAX_HZ/DSP_MIN_HZ),0,1)*(DSP_BANDS-1);}return{angle,cos,sin,x,y,channel,positions};});return this.spectrumGeometryLayers;}

  private renderHistory(size:number,waveformHeight:number){if(this.historyRaster.width!==size||this.historyRaster.height!==size){this.historyRaster.width=size;this.historyRaster.height=size;this.historyContext=this.historyRaster.getContext('2d',{alpha:false})!;this.historyContext.fillStyle='#050919';this.historyContext.fillRect(0,0,size,size);this.lastHistorySequence=-1;}const frame=this.frame;if(frame&&frame.sequence!==this.lastHistorySequence){this.lastHistorySequence=frame.sequence;this.historyContext.drawImage(this.historyRaster,1,0,size-1,size,0,0,size-1,size);const values=this.spectral.values('raw',this.parameters),column=this.historyContext.createImageData(1,size);for(let y=0;y<size;y++){const u=1-y/(size-1),frequency=this.parameters.frequencyAxis==='linear'?DSP_MIN_HZ+(DSP_MAX_HZ-DSP_MIN_HZ)*u:DSP_MIN_HZ*Math.pow(DSP_MAX_HZ/DSP_MIN_HZ,u),position=clamp(Math.log(frequency/DSP_MIN_HZ)/Math.log(DSP_MAX_HZ/DSP_MIN_HZ),0,1)*(DSP_BANDS-1),left=Math.floor(position),right=Math.min(DSP_BANDS-1,left+1),value=values[left]+(values[right]-values[left])*(position-left),color=colorAt(spectralStops,value),offset=4*y;column.data[offset]=color[0];column.data[offset+1]=color[1];column.data[offset+2]=color[2];column.data[offset+3]=255;}this.historyContext.putImageData(column,size-1,0);}this.drawContained(this.historyRaster,waveformHeight);}

  private waveformHeight(){return this.frame?.waveform.length?Math.max(58,Math.min(86,this.height*.14)):0;}
  private rasterSize(waveformHeight:number){const side=Math.min(this.width,this.height-waveformHeight),size=Math.max(2,Math.round(Math.min(side*this.pixelRatio,480)));this.canvas.dataset.internalRaster=`${size}x${size}`;return size;}
  private drawContained(source:HTMLCanvasElement,waveformHeight:number){const availableHeight=this.height-waveformHeight,side=Math.min(this.width,availableHeight),x=(this.width-side)/2,y=waveformHeight+(availableHeight-side)/2;this.context.imageSmoothingEnabled=true;this.context.imageSmoothingQuality='high';this.context.drawImage(source,x,y,side,side);this.canvas.dataset.visualBounds=[x,y,side,side].map(value=>value.toFixed(2)).join(',');}

  private renderWaveform(height:number){const frame=this.frame;if(!frame||!height)return;const points=Math.max(2,Math.ceil(this.width*this.pixelRatio)),duration=.05,end=frame.timestamp/1000,p=this.parameters,traces:Array<{values:Float32Array;color:string}> = [],anchors=palettes[p.palette]??palettes.spectral;for(let sourceIndex=0;sourceIndex<p.oscillators.length;sourceIndex++){const source=p.oscillators[sourceIndex];if(!source.playing)continue;const values=new Float32Array(points);for(let index=0;index<points;index++)values[index]=modeledOscillatorPressureAtListener(source,end-duration+duration*index/(points-1));const color=hexRgb(anchors[sourceIndex%anchors.length]);traces.push({values,color:`rgba(${color[0]},${color[1]},${color[2]},.5)`});}if(p.microphone.enabled&&frame.microphoneWaveform?.length){const values=new Float32Array(points),input=frame.microphoneWaveform,delay=virtualListenerDistanceMeters(p.microphone.direction)/SOUND_SPEED_METERS_PER_SECOND;for(let index=0;index<points;index++){const offset=-duration+duration*index/(points-1)-delay,position=input.length-1+offset*frame.sampleRate,left=Math.floor(position),fraction=position-left;if(left>=0&&left+1<input.length)values[index]=input[left]+(input[left+1]-input[left])*fraction;}traces.push({values,color:'rgba(54,91,76,.48)'});}const combined=new Float32Array(points);for(const trace of traces)for(let index=0;index<points;index++)combined[index]+=trace.values[index];let peak=.12;for(const trace of traces)for(const value of trace.values)peak=Math.max(peak,Math.abs(value));for(const value of combined)peak=Math.max(peak,Math.abs(value));const middle=height/2,ctx=this.context,gain=height*.34/peak;ctx.fillStyle='rgba(250,250,250,.96)';ctx.fillRect(0,0,this.width,height);ctx.strokeStyle='rgba(40,48,58,.24)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,middle+.5);ctx.lineTo(this.width,middle+.5);ctx.stroke();const draw=(values:Float32Array,color:string,width:number)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin='round';ctx.beginPath();for(let index=0;index<points;index++){const x=index/(points-1)*this.width,y=middle-values[index]*gain;if(index)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke()};for(const trace of traces)draw(trace.values,trace.color,1);draw(combined,'#111820',1.8);this.canvas.dataset.waveformSources=String(traces.length);this.canvas.dataset.waveformWindow='50ms';ctx.fillStyle='#38414b';ctx.font='11px sans-serif';ctx.fillText('virtual-listener pressure',8,13);ctx.textAlign='right';ctx.fillText('50 ms',this.width-8,height-7);ctx.textAlign='start';}
}
