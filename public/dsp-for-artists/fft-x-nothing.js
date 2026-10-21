/* FFT × NOTHING × N — displaced concentric spectral rings. Paste into p5 Web Editor sketch.js.
   Uses native Canvas and Web Audio. Turn OFF editor Loop Protection (p5 2.3.x _LP errors).
   No p5.sound or p5 APIs. */
(() => {
'use strict';
const SIZE=570, RES=570, BANDS=256, MIN=60, MAX=6000;
const root=document.createElement('div');root.style.cssText='font:12px monospace;color:#ddd;background:#090c16;padding:14px;max-width:1100px';document.body.appendChild(root);
const h=document.createElement('h3');h.textContent='SPECTRAL LAB — FFT / CWT × N';root.appendChild(h);
const layout=document.createElement('div');layout.style.cssText='display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start';root.appendChild(layout);
const canvas=document.createElement('canvas');canvas.width=SIZE;canvas.height=SIZE;canvas.style.cssText='width:570px;max-width:100%;border:1px solid #697284';layout.appendChild(canvas);
const ctx=canvas.getContext('2d');const pane=document.createElement('div');pane.style.cssText='min-width:310px;flex:1;max-width:470px;line-height:2';layout.appendChild(pane);
function row(){const d=document.createElement('div');d.style.margin='4px 0';pane.appendChild(d);return d;}
function button(parent,label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=fn;parent.appendChild(b);return b;}
function select(parent,label,opts,initial){const l=document.createElement('label');l.textContent=label+' ';const s=document.createElement('select');for(const [name,value] of opts){const o=document.createElement('option');o.textContent=name;o.value=value;s.appendChild(o);}s.value=initial;l.appendChild(s);parent.appendChild(l);return s;}
function slider(parent,label,min,max,initial,step){const l=document.createElement('label');l.style.cssText='display:flex;align-items:center;gap:7px';const name=document.createElement('span');name.style.width='205px';name.textContent=label;const s=document.createElement('input');s.type='range';s.min=min;s.max=max;s.step=step;s.value=initial;s.style.width='130px';const v=document.createElement('span');v.textContent=initial;s.addEventListener('input',()=>v.textContent=s.value);l.append(name,s,v);parent.appendChild(l);s.readout=v;return s;}
const status=row();status.textContent='Choose audio source';
let audio=null,analyser=null,cwtAnalyser=null,cwtData=null,cwtKernels=null,stream=null,freqData=null,sourceNode=null,osc=null,filter=null,oscGain=null,monitorGain=null,outputGate=null,micSource=null,paused=false,last=0,prev=null;
const sourceChoice=select(row(),'Audio source',[['Internal oscillator','osc'],['Microphone','mic']],'osc');
const oscWave=select(row(),'Waveform',[['Sine','sine'],['Sawtooth','sawtooth'],['Square','square'],['Triangle','triangle']],'sawtooth');
const oscFrequency=slider(pane,'Fundamental frequency (Hz)',40,1000,110,1);
// Logarithmic cutoff slider gives useful travel through the bass and midrange.
const cutoffMin=60,cutoffMax=12000;
const cutoffToPosition=f=>1000*Math.log(f/cutoffMin)/Math.log(cutoffMax/cutoffMin);
const oscCutoff=slider(pane,'Low-pass cutoff (Hz)',0,1000,cutoffToPosition(4000),1);
const cutoffHz=()=>cutoffMin*Math.pow(cutoffMax/cutoffMin,Number(oscCutoff.value)/1000);
const updateCutoffReadout=()=>oscCutoff.readout.textContent=Math.round(cutoffHz())+' Hz';
oscCutoff.addEventListener('input',updateCutoffReadout);updateCutoffReadout();
const oscQ=slider(pane,'Filter resonance (Q)',0.1,15,0.707,0.1);
const oscVolume=slider(pane,'Oscillator level (%)',0,100,35,1);
const monitorRow=row();const monitorCheck=document.createElement('input');monitorCheck.type='checkbox';monitorRow.append(monitorCheck,' Listen to oscillator (caution: volume)');
const fftSizeChoice=select(row(),'FFT window', [512,1024,2048,4096,8192,16384].map(n=>[n+' samples',String(n)]),'2048');
const cwtCycles=slider(pane,'CWT cycles',3,12,6,1);
const cwtAverage=slider(pane,'CWT temporal averaging (ms)',0,500,120,10);
const markersRow=row();const markersCheck=document.createElement('input');markersCheck.type='checkbox';markersCheck.checked=true;markersRow.append(markersCheck,' Show harmonic markers (straight lines, 1 layer)');
const dbRow=row();const fixedDb=document.createElement('input');fixedDb.type='checkbox';dbRow.append(fixedDb,' Fixed dB scale in Raw mode');
const dbFloor=slider(pane,'Fixed dB floor',-120,-30,-90,5);
const dbCeiling=slider(pane,'Fixed dB ceiling',-60,0,-15,5);
const micRow=row();const startButton=button(micRow,'Start audio',startAudio);
const pauseButton=button(micRow,'Pause audio + freeze',togglePause);
function togglePause(){
 if(!audio)return;
 paused=!paused;
 if(outputGate)outputGate.gain.setTargetAtTime(paused?0:1,audio.currentTime,0.008);
 pauseButton.textContent=paused?'Resume audio + visuals':'Pause audio + freeze';
 status.textContent=paused?'Paused: audio muted and image frozen':(sourceChoice.value==='osc'?'Oscillator':'Microphone')+' analyzing';
}
function resetAnalysis(){shown.fill(-120);held.fill(-120);measured.fill(-120);cwtSmoothed.fill(-120);adaptiveReference=null;adaptiveLevel=null;adaptiveGain=0;prev=null;}
async function ensureAudio(){
 if(audio)return;
 audio=new (window.AudioContext||window.webkitAudioContext)();
 analyser=audio.createAnalyser();analyser.fftSize=Number(fftSizeChoice.value);
 analyser.smoothingTimeConstant=0;analyser.minDecibels=-120;analyser.maxDecibels=0;
 cwtAnalyser=audio.createAnalyser();cwtAnalyser.fftSize=16384;cwtAnalyser.smoothingTimeConstant=0;
 cwtData=new Float32Array(cwtAnalyser.fftSize);cwtKernels=makeCwtKernels(audio.sampleRate);
 freqData=new Float32Array(analyser.frequencyBinCount);
 osc=audio.createOscillator();osc.type=oscWave.value;osc.frequency.value=Number(oscFrequency.value);
 filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=cutoffHz();filter.Q.value=Number(oscQ.value);
 oscGain=audio.createGain();oscGain.gain.value=Number(oscVolume.value)/100*0.5;
 monitorGain=audio.createGain();monitorGain.gain.value=monitorCheck.checked?0.15:0;
 outputGate=audio.createGain();outputGate.gain.value=paused?0:1;
 osc.connect(filter);filter.connect(oscGain);oscGain.connect(monitorGain);
 monitorGain.connect(outputGate);outputGate.connect(audio.destination);
 osc.start();
}
async function selectSource(){
 if(!audio)return;
 if(sourceNode){sourceNode.disconnect(analyser);sourceNode.disconnect(cwtAnalyser);sourceNode=null;}
 if(sourceChoice.value==='mic'){
   if(!micSource){
     stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
     micSource=audio.createMediaStreamSource(stream);
   }
   sourceNode=micSource;
 }else sourceNode=oscGain;
 sourceNode.connect(analyser);sourceNode.connect(cwtAnalyser);
 resetAnalysis();
 status.textContent=(sourceChoice.value==='osc'?'Internal oscillator':'Microphone')+' analyzing · oscillator '+(monitorCheck.checked?'audible':'monitor muted')+' · '+audio.sampleRate+' Hz';
}
async function startAudio(){
 try{
   await ensureAudio();await audio.resume();
   await selectSource();
   startButton.textContent='Audio started';
 }catch(err){status.textContent='Audio error: '+err.message;}
}
sourceChoice.addEventListener('change',async()=>{
 if(!audio)return;
 try{await selectSource();}catch(err){status.textContent='Source error: '+err.message;}
});
fftSizeChoice.addEventListener('change',()=>{if(analyser){analyser.fftSize=Number(fftSizeChoice.value);freqData=new Float32Array(analyser.frequencyBinCount);resetAnalysis();}});
oscWave.addEventListener('change',()=>{if(osc)osc.type=oscWave.value;});
oscFrequency.addEventListener('input',()=>{if(osc)osc.frequency.setTargetAtTime(Number(oscFrequency.value),audio.currentTime,0.008);});
oscCutoff.addEventListener('input',()=>{if(filter)filter.frequency.setTargetAtTime(cutoffHz(),audio.currentTime,0.01);});
oscQ.addEventListener('input',()=>{if(filter)filter.Q.setTargetAtTime(Number(oscQ.value),audio.currentTime,0.01);});
oscVolume.addEventListener('input',()=>{if(oscGain)oscGain.gain.setTargetAtTime(Number(oscVolume.value)/100*0.5,audio.currentTime,0.01);});
monitorCheck.addEventListener('change',()=>{if(monitorGain)monitorGain.gain.setTargetAtTime(monitorCheck.checked?0.15:0,audio.currentTime,0.01);});
cwtCycles.addEventListener('input',()=>{if(audio)cwtKernels=makeCwtKernels(audio.sampleRate);resetAnalysis();});
const opts=[['Raw (full spectrum)','raw'],['Low (60–350 Hz)','low'],['Mid (350–1500 Hz)','mid'],['High (1500–6000 Hz)','high']];
const analysisMode=select(row(),'Analysis',[['FFT','fft'],['CWT (Morlet)','cwt']],'fft');
const r1=row();const mode=select(r1,'Spectrum', [['Raw','raw'],['Relative','relative']],'raw');
const blend=select(r1,'  Combination',[['Multiply','multiply'],['Add','add'],['Maximum','maximum'],['Blend','blend']],'multiply');
const blendAmount=slider(pane,'Blend amount (Add → Multiply)',0,1,0.5,0.01);
const frequencyScale=select(row(),'Frequency axis',[['Logarithmic','log'],['Linear','linear']],'log');
const geometry=select(row(),'Geometry', [['Radial rings','radial'],['Straight lines','linear']],'radial');
const radialExtent=slider(pane,'Radial spectrum radius (px)',100,1200,400,5);
const centerLayout=select(row(),'Layer layout', [['Line','line'],['Circle','circle']],'line');
const layoutRadius=slider(pane,'Circle layout radius (px)',0,1200,400,5);
const r2=row();const layerCount=select(r2,'Layers',Array.from({length:8},(_,i)=>[String(i+1),String(i+1)]),'3');
const distribution=select(r2,'  Angles',[['Evenly spaced','even'],['Fixed step','fixed']],'even');
const angleStep=slider(pane,'Angle step (degrees)',0,360,60,1);
const angleOffset=slider(pane,'Angle offset (degrees)',0,360,0,1);
const globalX=slider(pane,'Line X spacing (pixels)',-1000,1000,120,5);
const globalY=slider(pane,'Line Y spacing (pixels)',-1000,1000,0,5);
const r3=row();const assignment=select(r3,'Channel distribution',[['All raw','all'],['Cycle Raw / Low / Mid / High','cycle'],['Cycle Low / Mid / High','bands']],'all');
const exposure=slider(pane,'Exposure (dB)',-30,60,25,1);
const gate=slider(pane,'Noise gate (dB above -95)',0,60,0,1);
const adaptRow=row();
const adaptLabel=document.createElement('label');
const adaptive=document.createElement('input');
adaptive.type='checkbox';
adaptLabel.append(adaptive,' Adaptive dynamic range');
adaptRow.appendChild(adaptLabel);
const adaptation=slider(pane,'Adaptation strength',0,1,0.5,0.05);
const contrast=slider(pane,'Contrast',0.5,6,1,0.1);
const response=slider(pane,'Amplitude + frequency smoothing',0,0.95,0,0.05);
const persistence=slider(pane,'Frequency persistence',0,1,0,0.05);
const diffusion=slider(pane,'Diffusion',0,8,0,0.5);
const background=slider(pane,'Background',0,0.4,0.08,0.01);
const layerPanel=row();const layerHeading=document.createElement('strong');layerHeading.textContent='Per-layer overrides';layerPanel.appendChild(layerHeading);
const layerRows=document.createElement('div');layerPanel.appendChild(layerRows);
const note=row();note.style.cssText='color:#aeb6c5;line-height:1.5;margin-top:10px';
note.textContent='Audio: Start audio initializes a persistent oscillator. Source switches only the analyzer input; Listen to oscillator works even while analyzing the microphone. Pause mutes monitored audio and freezes the image; Resume restores both. The cutoff slider is logarithmic (60–12000 Hz); harmonics only change when cutoff passes through their frequencies. For teaching: Logarithmic axis emphasizes ratios, Linear axis emphasizes equal-Hz distances. Fixed dB scale makes Raw amplitude comparisons consistent across time, but is optional; when off, the original Exposure mapping is used. FFT window and CWT cycles control frequency/time resolution. Circle and Line layouts retain their previous behavior.';
const layers=[];
function setChannels(){layers.forEach((l,i)=>{if(!l.channelOverride.checked){l.channel.value=assignment.value==='all'?'raw':assignment.value==='cycle'?['raw','low','mid','high'][i%4]:['low','mid','high'][i%3];}});}
function setAngles(){const n=layers.length,step=distribution.value==='even'?360/n:Number(angleStep.value);layers.forEach((l,i)=>{if(!l.override.checked){l.angle.value=String((Number(angleOffset.value)+i*step)%360);l.readout.textContent=l.angle.value+'°';}});}
function buildLayers(){const n=Number(layerCount.value);layerRows.replaceChildren();layers.length=0;for(let i=0;i<n;i++){
 const div=document.createElement('div');div.style.cssText='padding:5px 0;border-top:1px solid #3c4355';layerRows.appendChild(div);
 const head=document.createElement('div');div.appendChild(head);const enable=document.createElement('input');enable.type='checkbox';enable.checked=true;head.appendChild(enable);head.append(' Layer '+(i+1)+'  ');
 const channel=select(head,'Channel',opts,'raw');const channelOverride=document.createElement('input');channelOverride.type='checkbox';head.append(' lock ');head.appendChild(channelOverride);
 const angleRow=document.createElement('div');angleRow.style.cssText='display:flex;align-items:center;gap:5px';div.appendChild(angleRow);
 const override=document.createElement('input');override.type='checkbox';angleRow.append('Angle ');angleRow.appendChild(override);angleRow.append(' override ');
 const angle=document.createElement('input');angle.type='range';angle.min=0;angle.max=360;angle.step=1;angle.style.width='130px';angleRow.appendChild(angle);
 const readout=document.createElement('span');angleRow.appendChild(readout);
 const xOffset=slider(div,'X offset (px)',-1000,1000,0,5);
 const yOffset=slider(div,'Y offset (px)',-1000,1000,0,5);
 angle.addEventListener('input',()=>{override.checked=true;readout.textContent=angle.value+'°';});
 channel.addEventListener('change',()=>channelOverride.checked=true);
 layers.push({enable,channel,channelOverride,angle,override,readout,xOffset,yOffset});
 }setAngles();setChannels();}
layerCount.addEventListener('change',buildLayers);distribution.addEventListener('change',setAngles);angleStep.addEventListener('input',setAngles);angleOffset.addEventListener('input',setAngles);assignment.addEventListener('change',setChannels);buildLayers();
const measured=new Float32Array(BANDS).fill(-120),shown=new Float32Array(BANDS).fill(-120),held=new Float32Array(BANDS).fill(-120),cwtSmoothed=new Float32Array(BANDS).fill(-120);
// Reference is captured when adaptive mode is enabled, preserving the current ambient look.
// The tracked level follows changes slowly, and compensation is capped at +/-18 dB.
let adaptiveReference=null, adaptiveLevel=null, adaptiveGain=0;
analysisMode.addEventListener('change',()=>{
  resetAnalysis();
});
adaptive.addEventListener('change',()=>{adaptiveReference=null;adaptiveLevel=null;adaptiveGain=0;});
function hz(i){return MIN*Math.pow(MAX/MIN,i/(BANDS-1));}
// Complex Morlet-like Gaussian-windowed wavelets, six cycles per frequency.
 // Kernels are cached; one CWT coefficient is calculated for each of 64 log-spaced bands.
 // This is a real time-domain CWT analysis, not an FFT-bin remapping.
function makeCwtKernels(sampleRate){
 const kernels=[];
 for(let i=0;i<BANDS;i++){
   const f=hz(i),sigma=Number(cwtCycles.value)/(2*Math.PI*f);
   const radius=Math.min(8191,Math.ceil(3*sigma*sampleRate));
   const real=new Float32Array(2*radius+1),imag=new Float32Array(2*radius+1);
   let weight=0;
   for(let j=-radius;j<=radius;j++){
     const t=j/sampleRate;
     const env=Math.exp(-0.5*(t/sigma)**2);
     const phase=2*Math.PI*f*t;
     real[j+radius]=env*Math.cos(phase);
     imag[j+radius]=env*Math.sin(phase);
     weight+=env;
   }
   kernels.push({real,imag,radius,scale:2/weight});
 }
 return kernels;
}
function analyze(t){
 const dt=prev===null?0.05:Math.max(0.001,Math.min(0.5,(t-prev)/1000));prev=t;
 if(analysisMode.value==='cwt'){
   cwtAnalyser.getFloatTimeDomainData(cwtData);
   const center=8191; // centered on the 16384-sample history buffer
   for(let i=0;i<BANDS;i++){
     const k=cwtKernels[i];let re=0,im=0;
     for(let j=-k.radius;j<=k.radius;j++){
       const sample=cwtData[center+j];
       re+=sample*k.real[j+k.radius];
       im+=sample*k.imag[j+k.radius];
     }
     const amplitude=Math.hypot(re,im)*k.scale;
     const db=Math.max(-120,20*Math.log10(Math.max(amplitude,1e-6)));
     const averaging=Number(cwtAverage.value)/1000;
     const averageAlpha=averaging<=0?1:1-Math.exp(-dt/averaging);
     cwtSmoothed[i]=cwtSmoothed[i]<=-119?db:cwtSmoothed[i]+averageAlpha*(db-cwtSmoothed[i]);
     measured[i]=cwtSmoothed[i];
   }
 }else{
   analyser.getFloatFrequencyData(freqData);
   const binHz=audio.sampleRate/analyser.fftSize;
   for(let i=0;i<BANDS;i++){
     const pos=hz(i)/binHz;
     const left=Math.max(0,Math.floor((i===0?MIN:Math.sqrt(hz(i-1)*hz(i)))/binHz));
     const right=Math.min(freqData.length-1,Math.ceil((i===BANDS-1?MAX:Math.sqrt(hz(i)*hz(i+1)))/binHz));
     let best=-120;
     for(let j=left;j<=right;j++)if(Number.isFinite(freqData[j]))best=Math.max(best,freqData[j]);
     // Peak-hold over each log band keeps high harmonics from falling between samples.
     measured[i]=best;
   }
 }
 const smooth=Number(response.value),tau=smooth===0?0:0.05*smooth/(1-smooth),alpha=tau===0?1:1-Math.exp(-dt/tau);
 const hold=Number(persistence.value),release=hold===0?1:1-Math.exp(-dt/(4*hold));
 for(let i=0;i<BANDS;i++){
   held[i]=measured[i]>=held[i]?measured[i]:held[i]+(measured[i]-held[i])*release;
   shown[i]+=(held[i]-shown[i])*alpha;
 }
 // Global broadband level, computed from finite logarithmically spaced FFT bands.
 let total=0;
 for(let i=0;i<BANDS;i++)total+=measured[i];
 const current=total/BANDS;
 if(adaptive.checked){
   if(adaptiveReference===null){
     adaptiveReference=current;
     adaptiveLevel=current;
   }
   // Quicker adaptation when the room grows louder; slower when it quiets down.
   const tau=current>adaptiveLevel?3:12;
   const follow=1-Math.exp(-dt/tau);
   adaptiveLevel+=(current-adaptiveLevel)*follow;
   adaptiveGain=Math.max(-18,Math.min(18,adaptiveReference-adaptiveLevel))*Number(adaptation.value);
 }else adaptiveGain=0;
}
// Relative mode faithfully follows FFT × FFT: neighborhood median POWER,
// positive log2 power ratio, then per-frame maximum normalization.
// The original sketch's Relative floor was 0; we keep that default here.
function relativeSpectrum(){
 const transformed=new Float32Array(BANDS);
 let peak=0;
 for(let i=0;i<BANDS;i++){
   const neighbors=[];
   const centerHz=hz(i);
   for(let j=0;j<BANDS;j++){
     if(Math.abs(Math.log2(hz(j)/centerHz))<=0.5){
       // Web Audio gives amplitude dB; converting with /10 yields power.
       const db=Number.isFinite(shown[j])?shown[j]:-120;
       neighbors.push(Math.pow(10,db/10));
     }
   }
   neighbors.sort((a,b)=>a-b);
   const m=neighbors.length>>1;
   const median=neighbors.length%2?neighbors[m]:(neighbors[m-1]+neighbors[m])/2;
   const power=Math.pow(10,(Number.isFinite(shown[i])?shown[i]:-120)/10);
   const ratio=power/Math.max(median,1e-12);
   const v=Math.max(0,Math.log2(Math.max(ratio,1e-12)));
   transformed[i]=v;
   peak=Math.max(peak,v);
 }
 if(peak>0)for(let i=0;i<BANDS;i++)transformed[i]/=peak;
 return transformed;
}
function bandsFor(channel,relative){
 const result=new Float32Array(BANDS);
 const floor=-95+Number(gate.value);
 for(let i=0;i<BANDS;i++){
   const frequency=hz(i);
   if((channel==='low'&&frequency>350)||
      (channel==='mid'&&(frequency<350||frequency>1500))||
      (channel==='high'&&frequency<1500))continue;
   const db=Number.isFinite(shown[i])?shown[i]:-120;
   if(Number(gate.value)>0&&db<floor)continue;
   // Relative is normalized peak prominence, not exposure-mapped dB.
   // Contrast=1 preserves the reference algorithm exactly.
   const intensity=relative?relative[i]:(fixedDb.checked?
     Math.max(0,Math.min(1,(db-Number(dbFloor.value))/Math.max(1,Number(dbCeiling.value)-Number(dbFloor.value)))):
     Math.max(0,Math.min(1,(db+Number(exposure.value)+adaptiveGain+72)/54)));
   result[i]=Math.pow(intensity,Number(contrast.value));
 }
 return result;
}
function diffuse(input){const smooth=Number(diffusion.value);if(smooth<=0)return input;const out=new Float32Array(input.length),sigma=smooth*1.8,radius=Math.ceil(3*sigma);for(let i=0;i<input.length;i++){let sum=0,wSum=0;for(let j=Math.max(0,i-radius);j<=Math.min(input.length-1,i+radius);j++){const w=Math.exp(-0.5*((j-i)/sigma)**2);sum+=input[j]*w;wSum+=w;}out[i]=sum/wSum;}return out;}
const stops=[[5,9,25],[25,35,100],[20,135,170],[225,185,70],[255,225,135]];
function palette(v){const t=Math.max(0,Math.min(0.999999,Number.isFinite(v)?v:0))*4,i=Math.floor(t),f=t-i;return [0,1,2].map(k=>Math.round(stops[i][k]*(1-f)+stops[i+1][k]*f));}
const image=ctx.createImageData(RES,RES);const channels={};
const off=document.createElement('canvas');off.width=RES;off.height=RES;const offCtx=off.getContext('2d');
function render(){const relative=mode.value==='relative'?relativeSpectrum():null;for(const key of ['raw','low','mid','high'])channels[key]=diffuse(bandsFor(key,relative));
 const active=layers.filter(l=>l.enable.checked).map((l)=>{
   const index=layers.indexOf(l)-(layers.length-1)/2;
   const angle=Number(l.angle.value)*Math.PI/180;
   const cos=Math.cos(angle),sin=Math.sin(angle);
   // Line positions are independent of angle; circle positions use polar coordinates.
   const circle=centerLayout.value==='circle';
   const px=(circle?Number(layoutRadius.value)*cos:index*Number(globalX.value))+Number(l.xOffset.value);
   const py=(circle?Number(layoutRadius.value)*sin:index*Number(globalY.value))+Number(l.yOffset.value);
   return {values:channels[l.channel.value],channel:l.channel.value,angle,
     x:px/SIZE,y:py/SIZE};
 });
 const combinationMode=blend.value, blendFraction=Number(blendAmount.value),base=Number(background.value),d=image.data;
 for(let y=0;y<RES;y++){const cy=(y+0.5)/RES-0.5;for(let x=0;x<RES;x++){
 const cx=(x+0.5)/RES-0.5;let product=1,sum=0,maximum=0,contributions=0;
 for(const layer of active){
 let u;
 if(geometry.value==='radial'){
   // Circular rings; layer centers may be well outside the canvas.
   const radius=Math.hypot(cx-layer.x,cy-layer.y);
   const extent=Number(radialExtent.value)/SIZE; // identical radial scale for every layer
   u=Math.max(0,Math.min(1,radius/extent));
 }else{
   // Infinite straight stripes, projected across the entire output canvas.
   const cos=Math.cos(layer.angle),sin=Math.sin(layer.angle);
   const projected=(cx-layer.x)*cos+(cy-layer.y)*sin;
   const extent=0.5*(Math.abs(cos)+Math.abs(sin));
   u=Math.max(0,Math.min(1,(projected+extent)/(2*extent)));
 }
 const range=layer.channel==='low'?[MIN,350]:layer.channel==='mid'?[350,1500]:layer.channel==='high'?[1500,MAX]:[MIN,MAX];
 const frequency=frequencyScale.value==='linear'?range[0]+(range[1]-range[0])*u:range[0]*Math.pow(range[1]/range[0],u);
 const pos=Math.max(0,Math.min(BANDS-1,Math.log(frequency/MIN)/Math.log(MAX/MIN)*(BANDS-1)));
 const lo=Math.floor(pos),hi=Math.min(BANDS-1,lo+1);
 const v=layer.values[lo]+(layer.values[hi]-layer.values[lo])*(pos-lo);
 const value=Math.max(0,Math.min(1,Number.isFinite(v)?v:0));
 product*=value;sum+=value;maximum=Math.max(maximum,value);contributions++;
 }
 const added=contributions?sum/contributions:0;
 const multiplied=contributions?Math.pow(product,1/contributions):0;
 let combined=multiplied;
 if(combinationMode==='add')combined=added;
 else if(combinationMode==='maximum')combined=maximum;
 else if(combinationMode==='blend')combined=added*(1-blendFraction)+multiplied*blendFraction;
 const c=palette(base+(1-base)*combined),idx=4*(y*RES+x);d[idx]=c[0];d[idx+1]=c[1];d[idx+2]=c[2];d[idx+3]=255;
 }}
 offCtx.putImageData(image,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(off,0,0,SIZE,SIZE);
 if(markersCheck.checked&&sourceChoice.value==='osc'&&geometry.value==='linear'&&active.length===1){
   const layer=active[0], f0=Number(oscFrequency.value);
   const cos=Math.cos(layer.angle),sin=Math.sin(layer.angle),extent=0.5*(Math.abs(cos)+Math.abs(sin));
   const range=layer.channel==='low'?[MIN,350]:layer.channel==='mid'?[350,1500]:layer.channel==='high'?[1500,MAX]:[MIN,MAX];
   ctx.save();ctx.strokeStyle='rgba(255,231,139,0.55)';ctx.lineWidth=1;ctx.fillStyle='rgba(255,231,139,0.85)';ctx.font='10px monospace';
   for(let n=1;n*f0<=range[1]&&n<=100;n++){
     const f=n*f0;if(f<range[0])continue;
     const u=frequencyScale.value==='linear'?(f-range[0])/(range[1]-range[0]):Math.log(f/range[0])/Math.log(range[1]/range[0]);
     const projected=(2*u-1)*extent;
     const cx=layer.x+cos*projected,cy=layer.y+sin*projected;
     const vx=-sin,vy=cos,span=2;
     ctx.beginPath();ctx.moveTo(SIZE*(0.5+cx-vx*span),SIZE*(0.5+cy-vy*span));ctx.lineTo(SIZE*(0.5+cx+vx*span),SIZE*(0.5+cy+vy*span));ctx.stroke();
     if(n<=12)ctx.fillText(String(n),SIZE*(0.5+cx)+4,SIZE*(0.5+cy)+10);
   }ctx.restore();
 }
}
function frame(t){if(!paused){if(analyser&&t-last>=50){last=t;analyze(t);}render();}requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();
