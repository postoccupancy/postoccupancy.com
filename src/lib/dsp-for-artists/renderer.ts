import type { BandFilter, DspParameters } from './course';
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

  values(channel: BandFilter, parameters: DspParameters) {
    const result = new Float32Array(DSP_BANDS);
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
      const frequency = dspBandFrequency(index), db = this.shown[index];
      if ((channel === 'low' && frequency > 350) || (channel === 'mid' && (frequency < 350 || frequency > 1500)) || (channel === 'high' && frequency < 1500)) continue;
      if (parameters.gate > 0 && db < floor) continue;
      const intensity = relative ? relative[index] : parameters.fixedDb ? clamp((db - parameters.dbFloor) / Math.max(1, parameters.dbCeiling - parameters.dbFloor)) : clamp((db + parameters.exposure + this.adaptiveGain + 72) / 54);
      result[index] = Math.pow(intensity, parameters.contrast);
    }
    if (parameters.diffusion <= 0) return result;
    const output = new Float32Array(DSP_BANDS), sigma = parameters.diffusion * 1.8, radius = Math.ceil(3 * sigma);
    for (let index = 0; index < DSP_BANDS; index++) { let sum = 0, weight = 0; for (let other = Math.max(0,index-radius); other <= Math.min(DSP_BANDS-1,index+radius); other++) { const w=Math.exp(-.5*((other-index)/sigma)**2);sum+=result[other]*w;weight+=w; } output[index]=sum/weight; }
    return output;
  }
}

interface PlaneHistory { t:number;amp:number;phase:number }
interface PlaneBand {
  low:number;high:number;minCycles:number;maxCycles:number;
  amp:number;hz:number;trackedHz:number|null;candidateHz:number|null;candidateFrames:number;missingFrames:number;phase:number;history:PlaneHistory[];
}

class PlaneState {
  private size = 540;
  private bands:PlaneBand[]=[];
  private bandKey='';
  private elapsed=0;
  private previous=0;
  private lastSequence=-1;
  private pulseEnvelope=0;
  private imageData:ImageData|null=null;
  private canvas=document.createElement('canvas');
  private context:CanvasRenderingContext2D;

  constructor(){this.canvas.width=this.size;this.canvas.height=this.size;this.context=this.canvas.getContext('2d',{alpha:false})!;}
  resize(size:number){if(size===this.size)return;this.size=size;this.canvas.width=size;this.canvas.height=size;this.context=this.canvas.getContext('2d',{alpha:false})!;this.imageData=null;}

  private ensureBands(parameters:DspParameters) {
    const sources=visualSources(parameters),key=sources.map(source=>source.band).join('|');if(key===this.bandKey)return;this.bandKey=key;const count=sources.length,prior=this.bands,ratio=6000/80,cycleAt=(frequency:number)=>3+33*clamp(Math.log(frequency/80)/Math.log(ratio));
    this.bands=Array.from({length:count},(_,index)=>{
      const automaticLow=count===3?[80,350,1500][index]:80*Math.pow(ratio,index/count),automaticHigh=count===3?[350,1500,6000][index]:80*Math.pow(ratio,(index+1)/count),channel=sources[index].band;
      const [low,high]=channel==='low'?[80,350]:channel==='mid'?[350,1500]:channel==='high'?[1500,6000]:[automaticLow,automaticHigh],old=prior[index];
      const automaticMin=count===3?[3,10,21][index]:3+33*index/count,automaticMax=count===3?[10,21,36][index]:3+33*(index+1)/count;
      return {low,high,minCycles:channel==='raw'?automaticMin:cycleAt(low),maxCycles:channel==='raw'?automaticMax:cycleAt(high),amp:old?.amp??0,hz:clamp(old?.hz??Math.sqrt(low*high),low,high),trackedHz:old?.trackedHz===null?null:clamp(old?.trackedHz??Math.sqrt(low*high),low,high),candidateHz:old?.candidateHz??null,candidateFrames:old?.candidateFrames??0,missingFrames:old?.missingFrames??0,phase:old?.phase??0,history:old?.history??[]};
    });
  }

  push(frame:DspAnalysisFrame, parameters:DspParameters) {
    this.ensureBands(parameters);
    if(frame.sequence===this.lastSequence)return;
    this.lastSequence=frame.sequence;
    const dt=this.previous?Math.min(.1,Math.max(.001,(frame.timestamp-this.previous)/1000)):.05;this.previous=frame.timestamp;this.elapsed+=dt;
    const pulseTarget=clamp(frame.rms/.075),tau=pulseTarget>this.pulseEnvelope?.045:.3;this.pulseEnvelope+=(pulseTarget-this.pulseEnvelope)*(1-Math.exp(-dt/tau));
    const binHz=frame.sampleRate/frame.fftSize,gate=-95+parameters.gate,useCwt=parameters.analysis==='cwt'&&!!frame.cwtBandsDb,source=useCwt?frame.cwtBandsDb!:frame.fftBinsDb,sourceHz=(index:number)=>useCwt?dspBandFrequency(index):index*binHz;
    for(const band of this.bands){let first=1,last=source.length-1;if(useCwt){while(first<source.length&&sourceHz(first)<band.low)first++;while(last>first&&sourceHz(last)>band.high)last--;}else{first=Math.max(1,Math.ceil(band.low/binHz));last=Math.min(source.length-1,Math.floor(band.high/binHz));}let power=0;const candidates:{hz:number;db:number}[]=[];
      for(let bin=first;bin<=last;bin++){const db=source[bin];if(!Number.isFinite(db))continue;power+=Math.pow(10,db/10);const left=bin>first?source[bin-1]:-Infinity,right=bin<last?source[bin+1]:-Infinity;if(db>=left&&db>=right){let offset=0,frequency=sourceHz(bin);const denominator=left-2*db+right;if(!useCwt&&bin>first&&bin<last&&Number.isFinite(denominator)&&Math.abs(denominator)>1e-8){offset=clamp(.5*(left-right)/denominator,-.5,.5);frequency=(bin+offset)*binHz;}candidates.push({hz:frequency,db});}}
      candidates.sort((a,b)=>b.db-a.db);const energyDb=10*Math.log10(Math.max(power,1e-12)),strongest=candidates[0];let displayDb=energyDb;if(parameters.spectrum==='relative'&&strongest){const neighbors:number[]=[];for(let bin=1;bin<source.length;bin++){const frequency=sourceHz(bin);if(frequency<strongest.hz/Math.SQRT2||frequency>strongest.hz*Math.SQRT2||Math.abs(frequency-strongest.hz)<=binHz)continue;const db=source[bin];if(Number.isFinite(db))neighbors.push(db);}neighbors.sort((a,b)=>a-b);const baseline=neighbors.length?neighbors[Math.floor(neighbors.length/2)]:strongest.db,prominence=clamp(strongest.db-baseline,0,30);displayDb=-80+prominence*1.55+.24*clamp(energyDb+75,-25,50);}const target=parameters.gate>0&&energyDb<gate?0:clamp((displayDb+parameters.exposure+72)/54),amount=parameters.response;
      band.amp+=(target-band.amp)*(target>band.amp?Math.max(.18,1-amount):Math.max(.025,(1-amount)*.3));
      const maxJump=.11+.19*(1-parameters.persistence),hold=Math.round(3+45*parameters.persistence),switchFrames=Math.round(2+14*parameters.persistence),audible=strongest&&energyDb>=gate&&strongest.db>gate-12;
      if(!audible){band.missingFrames++;band.candidateHz=null;band.candidateFrames=0;if(band.missingFrames>hold)band.trackedHz=null;}else{band.missingFrames=0;if(band.trackedHz===null)band.trackedHz=strongest.hz;else{const nearby=candidates.filter(candidate=>Math.abs(Math.log2(candidate.hz/band.trackedHz!))<=maxJump).sort((a,b)=>(b.db-12*Math.abs(Math.log2(b.hz/band.trackedHz!)))-(a.db-12*Math.abs(Math.log2(a.hz/band.trackedHz!))))[0];if(nearby)band.trackedHz=Math.exp(Math.log(band.trackedHz)+(.07+.24*(1-parameters.persistence))*(Math.log(nearby.hz)-Math.log(band.trackedHz)));const remote=candidates.find(candidate=>Math.abs(Math.log2(candidate.hz/band.trackedHz!))>maxJump);if(remote&&(!nearby||remote.db>nearby.db+3+12*parameters.persistence)){const same=band.candidateHz!==null&&Math.abs(Math.log2(remote.hz/band.candidateHz))<.08;band.candidateFrames=same?band.candidateFrames+1:1;band.candidateHz=remote.hz;if(band.candidateFrames>=switchFrames){band.trackedHz=remote.hz;band.candidateHz=null;band.candidateFrames=0;}}else{band.candidateHz=null;band.candidateFrames=0;}}}
      if(band.trackedHz!==null)band.hz=Math.exp(Math.log(Math.max(1,band.hz))+Math.max(.01,1-parameters.response)*(Math.log(band.trackedHz)-Math.log(Math.max(1,band.hz))));
      const normalized=clamp(band.hz,band.low,band.high),u=Math.log(normalized/band.low)/Math.log(band.high/band.low),cycles=band.minCycles+(band.maxCycles-band.minCycles)*u,wavelength=this.size/cycles;
      band.phase-=2*Math.PI*(24*this.size/360)*dt/wavelength;band.history.push({t:this.elapsed,amp:band.amp,phase:band.phase});const cutoff=this.elapsed-40;while(band.history.length>2&&band.history[1].t<cutoff)band.history.shift();
    }
  }

  render(parameters:DspParameters) {
    this.ensureBands(parameters);const size=this.size,ctx=this.context;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);
    const states=this.states(parameters);
    if(!this.imageData)this.imageData=ctx.createImageData(size,size);const pixels=this.imageData.data,palette=parameters.palette,screen=palette!=='mono'&&parameters.blend==='screen',pulse=this.pulseEnvelope*parameters.rmsPulseDepth,colorPulse=parameters.rmsLuminosity?this.pulseEnvelope*parameters.colorPulseDepth:0;
    const active=states.map((state,index)=>({state,color:this.bandColor(index,palette)}));
    for(let pixel=0;pixel<size*size;pixel++){const y=Math.floor(pixel/size)+.5,x=pixel%size+.5,offset=pixel*4;if(parameters.mode==='pressure'){let sum=0,weight=0,cr=0,cg=0,cb=0;for(const layer of active){const sample=this.sample(x,y,layer.state),w=Math.abs(sample.value);sum+=sample.value;weight+=w;cr+=w*layer.color[0];cg+=w*layer.color[1];cb+=w*layer.color[2];}let normalized=clamp(sum/3,-1,1);if(parameters.rmsPulse==='thickness')normalized=Math.sign(normalized)*(1-Math.pow(1-Math.abs(normalized),1+pulse));else if(parameters.rmsPulse==='opacity')normalized=clamp(normalized*(1+pulse),-1,1);const gray=127.5+127.5*normalized;let r=gray,g=gray,b=gray;if(palette!=='mono'){const rr=weight>1e-8?cr/weight/255:.5,gg=weight>1e-8?cg/weight/255:.5,bb=weight>1e-8?cb/weight/255:.5,average=(rr+gg+bb)/3,chroma=parameters.pressureChroma;if(screen){const light=clamp(Math.max(0,normalized)*(1+colorPulse));r=255*light*clamp(average+(rr-average)*chroma);g=255*light*clamp(average+(gg-average)*chroma);b=255*light*clamp(average+(bb-average)*chroma);}else{const base=clamp(gray+(gray-127.5)*colorPulse,0,255),den=Math.max(.15,average);r=clamp(base*(1+chroma*(rr/den-1)),0,255);g=clamp(base*(1+chroma*(gg/den-1)),0,255);b=clamp(base*(1+chroma*(bb/den-1)),0,255);}}pixels[offset]=r;pixels[offset+1]=g;pixels[offset+2]=b;
      }else{let r=screen?0:255,g=r,b=r;for(const layer of active){const sample=this.sample(x,y,layer.state);if(sample.amp<.01)continue;const distance=this.distance(x,y,layer.state),at=Math.floor(distance),before=layer.state.lookup[Math.max(0,at-1)],after=layer.state.lookup[Math.min(layer.state.lookup.length-1,at+1)],localK=Math.max(.02,Math.abs(after.phase-before.phase)/2),wrapped=Math.atan2(Math.sin(sample.phase),Math.cos(sample.phase)),crest=Math.abs(wrapped)/localK,thickness=(.35+6.5*sample.amp)*(this.size/360)*(parameters.rmsPulse==='thickness'?1+pulse:1),coverage=clamp(thickness+.65-crest),opacity=clamp(.93*Math.pow(sample.amp,.8)*coverage*(parameters.rmsPulse==='opacity'?1+pulse:1)),strength=clamp(opacity*(1+colorPulse));if(screen){r=255*(1-(1-r/255)*(1-strength*layer.color[0]/255));g=255*(1-(1-g/255)*(1-strength*layer.color[1]/255));b=255*(1-(1-b/255)*(1-strength*layer.color[2]/255));}else{r*=1-strength*(1-layer.color[0]/255);g*=1-strength*(1-layer.color[1]/255);b*=1-strength*(1-layer.color[2]/255);}}pixels[offset]=r;pixels[offset+1]=g;pixels[offset+2]=b;}pixels[offset+3]=255;}
    ctx.putImageData(this.imageData,0,0);return this.canvas;
  }

  private historyAt(band:PlaneBand,when:number){const history=band.history;if(!history.length||when<history[0].t)return{amp:0,phase:0};if(when>=history[history.length-1].t)return history[history.length-1];let low=0,high=history.length-1;while(high-low>1){const middle=(low+high)>>1;if(history[middle].t<=when)low=middle;else high=middle;}const a=history[low],b=history[high],u=(when-a.t)/(b.t-a.t);return{amp:a.amp+(b.amp-a.amp)*u,phase:a.phase+(b.phase-a.phase)*u};}
  private states(parameters:DspParameters){const corner=this.size*Math.SQRT2/2,visible=visualSources(parameters),radial=parameters.layerLayout==='circle',sourceRadius=corner*parameters.layoutRadius/400,speed=24*this.size/360;return this.bands.map((band,index)=>{const oscillator=visible[index],step=parameters.angleDistribution==='even'?360/this.bands.length:parameters.angleStep,angle=((oscillator?.direction??index*step)+parameters.angleOffset)*Math.PI/180,dx=Math.cos(angle),dy=Math.sin(angle),sourceX=this.size/2-sourceRadius*dx,sourceY=this.size/2-sourceRadius*dy,lookup=Array.from({length:Math.ceil(2*this.size*Math.SQRT2)+5},(_,distance)=>this.historyAt(band,this.elapsed-distance/speed));return{band,radial,sourceRadius,sourceX,sourceY,corner,dx,dy,minProjection:-corner,userPhase:(oscillator?.phase??0)*Math.PI/180,lookup};});}
  private distance(x:number,y:number,state:ReturnType<PlaneState['states']>[number]){if(state.radial)return clamp(Math.hypot(x-state.sourceX,y-state.sourceY)-state.sourceRadius+state.corner,0,state.lookup.length-2);return clamp(state.dx*(x-this.size/2)+state.dy*(y-this.size/2)-state.minProjection,0,state.lookup.length-2);}
  private sample(x:number,y:number,state:ReturnType<PlaneState['states']>[number]){const distance=this.distance(x,y,state),index=Math.floor(distance),fraction=distance-index,a=state.lookup[index],b=state.lookup[index+1],amp=a.amp+(b.amp-a.amp)*fraction,phase=a.phase+(b.phase-a.phase)*fraction+state.userPhase;return{amp,phase,value:amp*Math.cos(phase)};}
  private pressure(x:number,y:number,states:ReturnType<PlaneState['states']>){let value=0;for(const state of states)value+=this.sample(x,y,state).value;return value;}
  private bandColor(index:number,palette:string){if(palette==='mono')return[0,0,0];const anchors=palettes[palette]??palettes.spectral,band=this.bands[index],position=clamp(Math.log(Math.sqrt(band.low*band.high)/80)/Math.log(6000/80))*7,left=Math.min(6,Math.floor(position)),fraction=position-left,a=hexRgb(anchors[left]),b=hexRgb(anchors[left+1]);return a.map((value,channel)=>value+(b[channel]-value)*fraction);}
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
  private historyRaster=document.createElement('canvas');
  private historyContext=this.historyRaster.getContext('2d',{alpha:false})!;
  private lastHistorySequence=-1;
  private dirty=true;

  constructor(private canvas:HTMLCanvasElement,parameters:DspParameters){this.parameters=parameters;this.context=canvas.getContext('2d',{alpha:false})!;}
  setParameters(parameters:DspParameters){this.parameters=parameters;this.dirty=true;}
  pushFrame(frame:DspAnalysisFrame){this.frame=frame;this.spectral.update(frame,this.parameters);this.plane.push(frame,this.parameters);this.dirty=true;}
  resize(width:number,height:number,pixelRatio:number){this.width=Math.max(1,width);this.height=Math.max(1,height);this.pixelRatio=pixelRatio;if(this.canvas.width!==Math.round(width*pixelRatio)||this.canvas.height!==Math.round(height*pixelRatio)){this.canvas.width=Math.round(width*pixelRatio);this.canvas.height=Math.round(height*pixelRatio);this.context.setTransform(pixelRatio,0,0,pixelRatio,0,0);this.dirty=true;}}
  render(now:number){if(!Number.isFinite(now)||!this.dirty)return;this.dirty=false;const p=this.parameters,waveformHeight=this.waveformHeight(),size=this.rasterSize(waveformHeight);this.context.fillStyle='#050919';this.context.fillRect(0,0,this.width,this.height);if(p.mode==='crest'||p.mode==='pressure'){this.plane.resize(size);this.drawContained(this.plane.render(p),waveformHeight);}else if(p.mode==='timeFrequency')this.renderHistory(size,waveformHeight);else this.renderSpectrum(size,waveformHeight);this.renderWaveform(waveformHeight);}
  destroy(){this.fftRaster.width=this.fftRaster.height=this.historyRaster.width=this.historyRaster.height=0;}

  private renderSpectrum(size:number,waveformHeight:number){const p=this.parameters,relative=this.spectral.values('raw',p),channels:{[key:string]:Float32Array}={raw:relative,low:this.spectral.values('low',p),mid:this.spectral.values('mid',p),high:this.spectral.values('high',p)};if(!this.fftImage||this.fftImage.width!==size)this.fftImage=new ImageData(size,size);const data=this.fftImage.data,visible=visualSources(p),layers=visible.map((oscillator,index)=>{const angle=(oscillator.direction+p.angleOffset)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),circle=p.layerLayout==='circle',offset=index-(visible.length-1)/2,channel=oscillator.band;return{angle,cos,sin,x:(circle?p.layoutRadius*cos:offset*p.xSpacing)/570,y:(circle?p.layoutRadius*sin:offset*p.ySpacing)/570,channel,values:channels[channel]};});
    for(let y=0;y<size;y++){const cy=(y+.5)/size-.5;for(let x=0;x<size;x++){const cx=(x+.5)/size-.5;let product=1,sum=0,maximum=0;for(const layer of layers){let u;if(p.mode==='rings')u=clamp(Math.hypot(cx-layer.x,cy-layer.y)/(p.radialExtent/570));else{const projected=(cx-layer.x)*layer.cos+(cy-layer.y)*layer.sin,extent=.5*(Math.abs(layer.cos)+Math.abs(layer.sin));u=clamp((projected+extent)/(2*extent));}const range=layer.channel==='low'?[DSP_MIN_HZ,350]:layer.channel==='mid'?[350,1500]:layer.channel==='high'?[1500,DSP_MAX_HZ]:[DSP_MIN_HZ,DSP_MAX_HZ],frequency=p.frequencyAxis==='linear'?range[0]+(range[1]-range[0])*u:range[0]*Math.pow(range[1]/range[0],u),position=clamp(Math.log(frequency/DSP_MIN_HZ)/Math.log(DSP_MAX_HZ/DSP_MIN_HZ),0,1)*(DSP_BANDS-1),left=Math.floor(position),right=Math.min(DSP_BANDS-1,left+1),value=clamp(layer.values[left]+(layer.values[right]-layer.values[left])*(position-left));product*=value;sum+=value;maximum=Math.max(maximum,value);}const added=layers.length?sum/layers.length:0,multiplied=layers.length?Math.pow(product,1/layers.length):0,combined=p.blend==='add'?added:p.blend==='maximum'?maximum:p.blend==='blend'?added*(1-p.blendAmount)+multiplied*p.blendAmount:multiplied,color=colorAt(spectralStops,p.background+(1-p.background)*combined),offset=4*(y*size+x);data[offset]=color[0];data[offset+1]=color[1];data[offset+2]=color[2];data[offset+3]=255;}}
    if(this.fftRaster.width!==size)this.fftRaster.width=size;if(this.fftRaster.height!==size)this.fftRaster.height=size;const rasterContext=this.fftRaster.getContext('2d',{alpha:false})!;rasterContext.putImageData(this.fftImage,0,0);
    if(p.harmonicMarkers&&p.mode==='stripes'&&layers.length===1&&(visible[0]?.frequency??0)>0){const layer=layers[0],fundamental=visible[0].frequency,range=layer.channel==='low'?[DSP_MIN_HZ,350]:layer.channel==='mid'?[350,1500]:layer.channel==='high'?[1500,DSP_MAX_HZ]:[DSP_MIN_HZ,DSP_MAX_HZ],extent=.5*(Math.abs(layer.cos)+Math.abs(layer.sin)),vx=-layer.sin,vy=layer.cos;rasterContext.save();rasterContext.strokeStyle='rgba(255,231,139,.55)';rasterContext.fillStyle='rgba(255,231,139,.85)';rasterContext.font='10px monospace';for(let harmonic=1;harmonic*fundamental<=range[1]&&harmonic<=100;harmonic++){const frequency=harmonic*fundamental;if(frequency<range[0])continue;const u=p.frequencyAxis==='linear'?(frequency-range[0])/(range[1]-range[0]):Math.log(frequency/range[0])/Math.log(range[1]/range[0]),projected=(2*u-1)*extent,cx=layer.x+layer.cos*projected,cy=layer.y+layer.sin*projected;rasterContext.beginPath();rasterContext.moveTo(size*(.5+cx-vx*2),size*(.5+cy-vy*2));rasterContext.lineTo(size*(.5+cx+vx*2),size*(.5+cy+vy*2));rasterContext.stroke();if(harmonic<=12)rasterContext.fillText(String(harmonic),size*(.5+cx)+4,size*(.5+cy)+10);}rasterContext.restore();}
    this.drawContained(this.fftRaster,waveformHeight);
  }

  private renderHistory(size:number,waveformHeight:number){if(this.historyRaster.width!==size||this.historyRaster.height!==size){this.historyRaster.width=size;this.historyRaster.height=size;this.historyContext=this.historyRaster.getContext('2d',{alpha:false})!;this.historyContext.fillStyle='#050919';this.historyContext.fillRect(0,0,size,size);this.lastHistorySequence=-1;}const frame=this.frame;if(frame&&frame.sequence!==this.lastHistorySequence){this.lastHistorySequence=frame.sequence;this.historyContext.drawImage(this.historyRaster,1,0,size-1,size,0,0,size-1,size);const values=this.spectral.values('raw',this.parameters),column=this.historyContext.createImageData(1,size);for(let y=0;y<size;y++){const u=1-y/(size-1),frequency=this.parameters.frequencyAxis==='linear'?DSP_MIN_HZ+(DSP_MAX_HZ-DSP_MIN_HZ)*u:DSP_MIN_HZ*Math.pow(DSP_MAX_HZ/DSP_MIN_HZ,u),position=clamp(Math.log(frequency/DSP_MIN_HZ)/Math.log(DSP_MAX_HZ/DSP_MIN_HZ),0,1)*(DSP_BANDS-1),left=Math.floor(position),right=Math.min(DSP_BANDS-1,left+1),value=values[left]+(values[right]-values[left])*(position-left),color=colorAt(spectralStops,value),offset=4*y;column.data[offset]=color[0];column.data[offset+1]=color[1];column.data[offset+2]=color[2];column.data[offset+3]=255;}this.historyContext.putImageData(column,size-1,0);}this.drawContained(this.historyRaster,waveformHeight);}

  private waveformHeight(){return this.frame?.waveform.length?Math.max(58,Math.min(86,this.height*.14)):0;}
  private rasterSize(waveformHeight:number){const side=Math.min(this.width,this.height-waveformHeight);return Math.max(2,Math.round(Math.min(side*this.pixelRatio,Math.max(side,720))));}
  private drawContained(source:HTMLCanvasElement,waveformHeight:number){const availableHeight=this.height-waveformHeight,side=Math.min(this.width,availableHeight),x=(this.width-side)/2,y=waveformHeight+(availableHeight-side)/2;this.context.imageSmoothingEnabled=true;this.context.imageSmoothingQuality='high';this.context.drawImage(source,x,y,side,side);this.canvas.dataset.visualBounds=[x,y,side,side].map(value=>value.toFixed(2)).join(',');}

  private renderWaveform(height:number){const waveform=this.frame?.waveform;if(!waveform?.length||!height)return;const middle=height/2,ctx=this.context;ctx.fillStyle='rgba(250,250,250,.96)';ctx.fillRect(0,0,this.width,height);ctx.strokeStyle='rgba(40,48,58,.24)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,middle+.5);ctx.lineTo(this.width,middle+.5);ctx.stroke();ctx.strokeStyle='#111820';ctx.lineWidth=1.5;ctx.lineJoin='round';ctx.beginPath();const points=Math.max(2,Math.min(waveform.length,Math.ceil(this.width*this.pixelRatio)));let peak=.12;for(let index=0;index<waveform.length;index++)peak=Math.max(peak,Math.abs(waveform[index]));const gain=(height*.4)/peak;for(let point=0;point<points;point++){const x=point/(points-1)*this.width,index=Math.min(waveform.length-1,Math.floor(point/points*waveform.length)),y=middle-waveform[index]*gain;if(point)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();}
}
