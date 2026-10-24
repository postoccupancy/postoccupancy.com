// Disable p5.js's speculative typo suggestions so actual errors are visible.
// This does not suppress genuine JavaScript exceptions.
if (typeof p5 !== 'undefined') p5.disableFriendlyErrors = true;

/*
  MICROPHONE -> VARIABLE-BAND PLANE WAVES
  p5.js global mode, no p5.sound dependency.

  The microphone supplies spectral energy and a dominant frequency
  for each of the selected frequency bands. Each band drives ONE illustrative
  plane wave; direction and initial phase are user-defined.
  A mono microphone cannot measure arrival direction or spatial phase.

  Uses Web Audio AnalyserNode FFT (2048) and browser microphone.
*/

const MP_SIZE = 360;
const MP_REF_HEIGHT = 70;
const MP_GAP = 12;
const MP_FIELD_TOP = MP_REF_HEIGHT + MP_GAP;
const MP_HEIGHT = MP_FIELD_TOP + MP_SIZE;
const MP_VISUAL_SPEED = 24;  // pixels/second, artistic not acoustic
const MP_FFT = 2048;

const MP_SPECS = [
  {name:'LOW',  low:80,   high:350,  minCycles:3,  maxCycles:10, direction:0},
  {name:'MID',  low:350,  high:1500, minCycles:10, maxCycles:21, direction:60},
  {name:'HIGH', low:1500, high:6000, minCycles:21, maxCycles:36, direction:120}
];

let mpBands = [];
let mpBandCount, mpBandContainer;
let mpPersistence;
let mpMode, mpStart, mpStatus, mpExposure, mpGate, mpResponse;
let mpSpectrumMode, mpEnvelopeMode, mpPairMode;
let mpCtx=null, mpAnalyser=null, mpStream=null, mpSource=null, mpFreqData=null;
let mpPulseMode, mpPulseDepth, mpPulseReadout;
let mpPaletteMode, mpBlendMode, mpColorRms, mpColorDepth, mpPressureChroma;
let mpGeometry, mpAngleDistribution, mpAngleStep, mpAngleOffset, mpRadialRadius;
let mpTimeData=null, mpPulseEnvelope=0, mpPulseRms=0;
const MP_PULSE_ATTACK=0.045; // 45 ms
const MP_PULSE_RELEASE=0.300; // 300 ms
const MP_PULSE_RMS_REFERENCE=0.075; // ~ -22.5 dBFS, full pulse
let mpPressureImage;
let mpCrestImage;
const MP_HISTORY_SECONDS = 40;
const MP_HISTORY_STEP_PX = 1;
const MP_MAX_TRAVEL = Math.ceil(2 * MP_SIZE * Math.SQRT2) + 4;
let mpElapsed=0, mpPrev=0, mpRunning=true;
// Independent, accumulated propagation phase (radians) for each band.
// Never recalculate elapsed phase using the latest wavelength.
let mpReady=false;

function setup(){
  // Side-by-side layout keeps the visual field visible while adjusting controls.
  const mpLocal_layout=createDiv();
  mpLocal_layout.style('display','flex');
  mpLocal_layout.style('align-items','flex-start');
  mpLocal_layout.style('gap','20px');
  mpLocal_layout.style('flex-wrap','wrap');
  mpLocal_layout.style('width','100%');
  const mpLocal_canvasPane=createDiv();
  mpLocal_canvasPane.parent(mpLocal_layout);
  mpLocal_canvasPane.style('flex','0 0 360px');
  const mpLocal_canvas=createCanvas(MP_SIZE, MP_HEIGHT);
  mpLocal_canvas.parent(mpLocal_canvasPane);
  pixelDensity(1);
  frameRate(30);
  mpPressureImage=createImage(MP_SIZE, MP_SIZE);
  mpCrestImage=createImage(MP_SIZE, MP_SIZE);

  const mpLocal_root=createDiv();
  mpLocal_root.style('font-family','monospace');
  mpLocal_root.style('font-size','12px');
  mpLocal_root.style('max-width','430px');
  mpLocal_root.style('flex','1 1 360px');
  mpLocal_root.style('min-width','320px');
  mpLocal_root.parent(mpLocal_layout);

  const mpLocal_first=createDiv();
  mpLocal_first.parent(mpLocal_root);
  mpLocal_first.style('margin','6px 0');
  mpMode=createSelect();
  mpMode.parent(mpLocal_first);
  mpMode.option('Crest overlay','crests');
  mpMode.option('Pressure sum','pressure');
  mpMode.selected('crests');

  const mpLocal_options=createDiv();
  mpLocal_options.parent(mpLocal_root);
  mpLocal_options.style('margin','6px 0');
  createSpan('Spectrum: ').parent(mpLocal_options);
  mpSpectrumMode=createSelect(); mpSpectrumMode.parent(mpLocal_options);
  mpSpectrumMode.option('Raw','raw');
  mpSpectrumMode.option('Relative','relative');
  createSpan('  Envelope: ').parent(mpLocal_options);
  mpEnvelopeMode=createSelect(); mpEnvelopeMode.parent(mpLocal_options);
  mpEnvelopeMode.option('Off','off');
  mpEnvelopeMode.option('Spatial','spatial');
  mpEnvelopeMode.option('Broad component','broad');
  mpEnvelopeMode.selected('off');
  const mpLocal_pairRow=createDiv();mpLocal_pairRow.parent(mpLocal_root);
  createSpan('Envelope pair: ').parent(mpLocal_pairRow);
  mpPairMode=createSelect();mpPairMode.parent(mpLocal_pairRow);
  // Pair choices are populated whenever the number of bands changes.

  mpStart=createButton('Enable microphone');
  mpStart.parent(mpLocal_first);
  mpStart.mousePressed(mpEnableMic);

  mpStatus=createDiv('Mic off — click Enable microphone');
  mpStatus.parent(mpLocal_root);
  mpStatus.style('margin','5px 0');
  mpStatus.style('color','#555');

  mpExposure=mpMakeSlider(mpLocal_root,'Exposure (dB)',-30,45,45,1);
  mpGate=mpMakeSlider(mpLocal_root,'Noise gate (0=off; dB above -95)',0,60,0,1);
  mpResponse=mpMakeSlider(mpLocal_root,'Amplitude + frequency smoothing',0,0.95,0,0.05);
  mpPersistence=mpMakeSlider(mpLocal_root,'Frequency persistence',0,1,0,0.05);

  const mpLocal_pulseRow=createDiv();
  mpLocal_pulseRow.parent(mpLocal_root);
  mpLocal_pulseRow.style('margin','10px 0 4px');
  createSpan('Broadband RMS pulse: ').parent(mpLocal_pulseRow);
  mpPulseMode=createSelect();
  mpPulseMode.parent(mpLocal_pulseRow);
  mpPulseMode.option('Off (original)','off');
  mpPulseMode.option('Global thickness pulse','thickness');
  mpPulseMode.option('Global opacity pulse','opacity');
  mpPulseMode.selected('off');
  mpPulseDepth=mpMakeSlider(mpLocal_root,'Pulse depth',0,2,1,0.05);
  mpPulseReadout=createDiv('RMS: waiting · envelope: 0%');
  mpPulseReadout.parent(mpLocal_root);
  mpPulseReadout.style('color','#666');
  mpPulseReadout.style('font-size','11px');


  const mpLocal_colorRow=createDiv();
  mpLocal_colorRow.parent(mpLocal_root);
  mpLocal_colorRow.style('margin','10px 0 4px');
  createSpan('Color palette: ').parent(mpLocal_colorRow);
  mpPaletteMode=createSelect(); mpPaletteMode.parent(mpLocal_colorRow);
  mpPaletteMode.option('Monochrome (original)','mono');
  mpPaletteMode.option('Spectral gradient','spectral');
  mpPaletteMode.option('Muted mineral','mineral');
  mpPaletteMode.option('Complementary temperature','temperature');
  mpPaletteMode.selected('spectral');
  createSpan('  Mix: ').parent(mpLocal_colorRow);
  mpBlendMode=createSelect(); mpBlendMode.parent(mpLocal_colorRow);
  mpBlendMode.option('Multiply','multiply');
  mpBlendMode.option('Screen','screen');
  mpBlendMode.selected('multiply');
  const mpLocal_lumRow=createDiv();
  mpLocal_lumRow.parent(mpLocal_root);
  createSpan('RMS luminosity: ').parent(mpLocal_lumRow);
  mpColorRms=createSelect(); mpColorRms.parent(mpLocal_lumRow);
  mpColorRms.option('Off','off'); mpColorRms.option('On','on');
  mpColorRms.selected('off');
  mpColorDepth=mpMakeSlider(mpLocal_root,'Color pulse depth',0,2,1,0.05);
  mpPressureChroma=mpMakeSlider(mpLocal_root,'Pressure color strength',0,2,1.5,0.05);

  const mpLocal_geometryRow=createDiv();
  mpLocal_geometryRow.parent(mpLocal_root);
  mpLocal_geometryRow.style('margin','10px 0 4px');
  createSpan('Wave geometry: ').parent(mpLocal_geometryRow);
  mpGeometry=createSelect();mpGeometry.parent(mpLocal_geometryRow);
  mpGeometry.option('Plane','plane');mpGeometry.option('Radial','radial');
  mpGeometry.selected('plane');
  // Radius measured in units of the center-to-corner distance.
  // 0 = all sources at center, 1 = sources at corners, 10 = nearly flat arcs.
  mpRadialRadius=mpMakeSlider(mpLocal_root,'Radial source circle (corner radii)',0,10,1,0.01);
  createSpan('  Angle distribution: ').parent(mpLocal_geometryRow);
  mpAngleDistribution=createSelect();mpAngleDistribution.parent(mpLocal_geometryRow);
  mpAngleDistribution.option('Even (360° / bands)','even');
  mpAngleDistribution.option('Fixed step','fixed');
  mpAngleDistribution.selected('even');
  mpAngleStep=mpMakeSlider(mpLocal_root,'Angle step (degrees)',0,360,60,1);
  mpAngleOffset=mpMakeSlider(mpLocal_root,'Angle offset (degrees)',0,360,45,1);
  // Distribution and offset are applied to existing sliders, without
  // rebuilding bands or discarding their audio histories.
  mpAngleDistribution.changed(mpApplyAngleDistribution);
  mpAngleStep.input(mpApplyAngleDistribution);
  mpAngleOffset.input(mpApplyAngleDistribution);

  const mpLocal_countRow=createDiv();
  mpLocal_countRow.parent(mpLocal_root);
  mpLocal_countRow.style('margin','8px 0');
  createSpan('Frequency bands: ').parent(mpLocal_countRow);
  mpBandCount=createSelect();
  mpBandCount.parent(mpLocal_countRow);
  for(let mpLocal_n=1;mpLocal_n<=8;mpLocal_n++)mpBandCount.option(String(mpLocal_n),String(mpLocal_n));
  mpBandCount.selected('3');
  mpBandContainer=createDiv();
  mpBandContainer.parent(mpLocal_root);
  mpBandCount.changed(()=>mpBuildBands(Number(mpBandCount.value())));
  mpBuildBands(3);

  const mpLocal_last=createDiv();
  mpLocal_last.parent(mpLocal_root);
  mpLocal_last.style('margin-top','8px');

  const mpLocal_play=createButton('Pause animation');
  mpLocal_play.parent(mpLocal_last);
  mpLocal_play.mousePressed(()=>{
    mpRunning=!mpRunning;
    mpLocal_play.html(mpRunning?'Pause animation':'Resume animation');
  });
  const mpLocal_reset=createButton('Reset time');
  mpLocal_reset.parent(mpLocal_last);
  mpLocal_reset.mousePressed(()=>{
    mpElapsed=0;
    for(const mpLocal_band of mpBands){ mpLocal_band.propagationPhase=0; mpLocal_band.history=[]; }
  });

  const mpLocal_note=createDiv(
    'Selectable logarithmic spectral bands, not measured arrival directions. '+
    'Each new microphone measurement enters at the upstream boundary and travels through the field. '+
    'Wave motion uses a fixed visual propagation speed. '+
    'Envelope is computed for the selected pair only; the black sum uses all enabled bands. '+
    'Relative mode uses peak prominence versus nearby FFT bins, with an absolute noise gate. '+
    'Broadband RMS pulse changes existing crest widths or darkness globally, not their historical amplitudes. '+
    '45 ms attack / 300 ms release. Geometry affects both render modes; reference shows the selected cross-section.'
  );
  mpLocal_note.parent(mpLocal_root);
  mpLocal_note.style('margin-top','9px');
  mpLocal_note.style('color','#555');
}

// Partition the same 80–6000 Hz span into logarithmically equal bands.
// Retain the original three-band layout for direct comparison.
function mpSpecsForCount(mpLocal_n){
  if(mpLocal_n===3){
    return MP_SPECS.map(mpLocal_spec => ({
      name:mpLocal_spec.name, low:mpLocal_spec.low, high:mpLocal_spec.high,
      minCycles:mpLocal_spec.minCycles, maxCycles:mpLocal_spec.maxCycles,
      direction:mpLocal_spec.direction
    }));
  }
  const mpLocal_low=80,mpLocal_high=6000,mpLocal_ratio=mpLocal_high/mpLocal_low;
  return Array.from({length:mpLocal_n}, (_,mpLocal_i) => {
    const mpLocal_a=mpLocal_low*Math.pow(mpLocal_ratio,mpLocal_i/mpLocal_n);
    const mpLocal_b=mpLocal_low*Math.pow(mpLocal_ratio,(mpLocal_i+1)/mpLocal_n);
    const mpLocal_visualA=3+33*mpLocal_i/mpLocal_n,mpLocal_visualB=3+33*(mpLocal_i+1)/mpLocal_n;
    return {name:'BAND '+(mpLocal_i+1),low:mpLocal_a,high:mpLocal_b,
      minCycles:mpLocal_visualA,maxCycles:mpLocal_visualB,direction:(45+mpLocal_i*360/mpLocal_n)%360};
  });
}

function mpApplyAngleDistribution(){
  if(!mpBands.length || !mpAngleDistribution)return;
  const mpLocal_count=mpBands.length;
  const mpLocal_step=mpAngleDistribution.value()==='even'
    ?360/mpLocal_count:Number(mpAngleStep.value());
  const mpLocal_offset=Number(mpAngleOffset.value());
  mpBands.forEach((mpLocal_band,mpLocal_i)=>{
    const mpLocal_angle=(mpLocal_offset+mpLocal_i*mpLocal_step)%360;
    // p5 slider .value(x) does not fire .input(), so update label explicitly.
    mpLocal_band.direction.value(mpLocal_angle);
    const mpLocal_display=mpLocal_band.direction.elt.parentElement.querySelector('span:last-child');
    if(mpLocal_display)mpLocal_display.textContent=String(Math.round(mpLocal_angle*100)/100);
  });
}

function mpBuildBands(mpLocal_n){
  mpBandContainer.html('');
  mpBands=[];
  const mpLocal_bandSpecs=mpSpecsForCount(mpLocal_n);
  mpLocal_bandSpecs.forEach((mpLocal_spec) => {
    const mpLocal_section=createDiv();
    mpLocal_section.parent(mpBandContainer);
    mpLocal_section.style('border-top','1px solid #aaa');
    mpLocal_section.style('padding','6px 0');
    const mpLocal_head=createDiv();mpLocal_head.parent(mpLocal_section);
    const mpLocal_enabled=createCheckbox(mpLocal_spec.name+' ('+
      Math.round(mpLocal_spec.low)+'–'+Math.round(mpLocal_spec.high)+' Hz)',true);
    mpLocal_enabled.parent(mpLocal_head);
    const mpLocal_readout=createSpan(' — waiting');
    mpLocal_readout.parent(mpLocal_head);mpLocal_readout.style('color','#555');
    const mpLocal_direction=mpMakeSlider(mpLocal_section,'Direction / inward angle',0,360,mpLocal_spec.direction,1);
    const mpLocal_phase=mpMakeSlider(mpLocal_section,'Phase',0,360,0,1);
    mpBands.push({spec:mpLocal_spec,enabled:mpLocal_enabled,readout:mpLocal_readout,direction:mpLocal_direction,phase:mpLocal_phase,
      propagationPhase:0,history:[],travelLookup:[],
      amp:0,hz:Math.sqrt(mpLocal_spec.low*mpLocal_spec.high),db:-120,
      trackedHz:null,missingFrames:0,candidateHz:null,
      candidateFrames:0,trackingState:'searching'});
  });
  mpPairMode.elt.innerHTML='';
  mpBands.forEach((mpLocal_bandA, mpLocal_i) => {
    mpBands.slice(mpLocal_i+1).forEach((mpLocal_bandB, mpLocal_offset) => {
      const mpLocal_j=mpLocal_i+1+mpLocal_offset;
      mpPairMode.option(mpLocal_bandA.spec.name+' + '+mpLocal_bandB.spec.name,mpLocal_i+','+mpLocal_j);
    });
  });
  mpPairMode.elt.disabled=mpLocal_n<2;
  mpElapsed=0;
  mpApplyAngleDistribution();
}

function mpMakeSlider(mpLocal_parent,mpLocal_label,mpLocal_min,mpLocal_max,mpLocal_initial,mpLocal_step){
  const mpLocal_row=createDiv();
  mpLocal_row.parent(mpLocal_parent);
  mpLocal_row.style('display','flex');
  mpLocal_row.style('align-items','center');
  mpLocal_row.style('gap','6px');
  mpLocal_row.style('padding','2px 0');
  const mpLocal_title=createSpan(mpLocal_label);
  mpLocal_title.parent(mpLocal_row);
  mpLocal_title.style('width','120px');
  const mpLocal_control=createSlider(mpLocal_min,mpLocal_max,mpLocal_initial,mpLocal_step);
  mpLocal_control.parent(mpLocal_row);
  mpLocal_control.style('width','170px');
  const mpLocal_output=createSpan(String(mpLocal_initial));
  mpLocal_output.parent(mpLocal_row);
  mpLocal_output.style('min-width','40px');
  mpLocal_control.input(()=>mpLocal_output.html(String(mpLocal_control.value())));
  return mpLocal_control;
}

async function mpEnableMic(){
  if(mpReady){
    if(mpCtx && mpCtx.state==='suspended') await mpCtx.resume();
    return;
  }
  mpStart.attribute('disabled','');
  mpStatus.html('Requesting microphone permission…');
  try{
    mpStream=await navigator.mediaDevices.getUserMedia({
      audio:{
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false,
        channelCount:1
      }
    });
    const mpLocal_AC=window.AudioContext||window.webkitAudioContext;
    mpCtx=new mpLocal_AC();
    await mpCtx.resume();
    mpAnalyser=mpCtx.createAnalyser();
    mpAnalyser.fftSize=MP_FFT;
    mpAnalyser.smoothingTimeConstant=0;
    mpAnalyser.minDecibels=-120;
    mpAnalyser.maxDecibels=0;
    mpSource=mpCtx.createMediaStreamSource(mpStream);
    mpSource.connect(mpAnalyser);
    // Do NOT connect analyser to speakers (avoid feedback).
    mpFreqData=new Float32Array(mpAnalyser.frequencyBinCount);
    mpTimeData=new Float32Array(mpAnalyser.fftSize);
    mpReady=true;
    mpStart.html('Microphone enabled');
    mpStatus.html('Live microphone · '+Math.round(mpCtx.sampleRate)+' Hz sample rate');
  }catch(err){
    mpStatus.html('Microphone unavailable: '+err.message+
      '. Use HTTPS or localhost and grant permission.');
    mpStart.removeAttribute('disabled');
  }
}

// Separate broadband microphone envelope. It does not alter spectral histories.
// Attack/release use real elapsed seconds, independent of frame rate.
function mpUpdatePulse(mpLocal_dt){
  if(!mpReady || !mpTimeData || mpLocal_dt<=0)return;
  mpAnalyser.getFloatTimeDomainData(mpTimeData);
  let mpLocal_energy=0;
  mpTimeData.forEach(mpLocal_sample => { mpLocal_energy+=mpLocal_sample*mpLocal_sample; });
  mpPulseRms=Math.sqrt(mpLocal_energy/mpTimeData.length);
  const mpLocal_target=mpClamp(mpPulseRms/MP_PULSE_RMS_REFERENCE,0,1);
  const mpLocal_tau=mpLocal_target>mpPulseEnvelope?MP_PULSE_ATTACK:MP_PULSE_RELEASE;
  const mpLocal_blend=1-Math.exp(-mpLocal_dt/mpLocal_tau);
  mpPulseEnvelope+=(mpLocal_target-mpPulseEnvelope)*mpLocal_blend;
  mpPulseReadout.html('RMS: '+(20*Math.log10(Math.max(mpPulseRms,1e-8))).toFixed(1)+
    ' dBFS · envelope: '+Math.round(mpPulseEnvelope*100)+'%');
}

function mpUpdateSpectrum(){
  if(!mpReady || !mpRunning) return;
  mpAnalyser.getFloatFrequencyData(mpFreqData);
  const mpLocal_binHz=mpCtx.sampleRate/MP_FFT;
  const mpLocal_exposure=Number(mpExposure.value());
  const mpLocal_gateStrength=Number(mpGate.value());
  const mpLocal_gate=-95+mpLocal_gateStrength;
  const mpSmoothingAmount=Number(mpResponse.value());

  for(const mpLocal_band of mpBands){
    const mpLocal_spec=mpLocal_band.spec;
    const mpLocal_first=Math.max(1,Math.ceil(mpLocal_spec.low/mpLocal_binHz));
    const mpLocal_last=Math.min(mpFreqData.length-1,Math.floor(mpLocal_spec.high/mpLocal_binHz));
    let mpLocal_power=0, mpLocal_peak=-Infinity, mpLocal_peakBin=mpLocal_first;
    for(let mpLocal_i=mpLocal_first;mpLocal_i<=mpLocal_last;mpLocal_i++){
      const mpLocal_db=mpFreqData[mpLocal_i];
      if(Number.isFinite(mpLocal_db)){
        mpLocal_power+=Math.pow(10,mpLocal_db/10);
        if(mpLocal_db>mpLocal_peak){mpLocal_peak=mpLocal_db;mpLocal_peakBin=mpLocal_i;}
      }
    }

    // Summed bin power approximates band energy. The analyser's
    // window and frequency resolution affect the calibration.
    const mpLocal_energyDb=10*Math.log10(Math.max(mpLocal_power,1e-12));
    // Relative mode uses the strongest peak's local prominence
    // over the median spectral level in a +/- half-octave neighborhood.
    // The absolute gate still suppresses low-level microphone noise.
    let mpLocal_displayDb=mpLocal_energyDb;
    if(mpSpectrumMode.value()==='relative'){
      const mpLocal_peakHz=mpLocal_peakBin*mpLocal_binHz;
      const mpLocal_lo=Math.max(1,Math.ceil(mpLocal_peakHz/Math.SQRT2/mpLocal_binHz));
      const mpLocal_hi=Math.min(mpFreqData.length-1,
        Math.floor(mpLocal_peakHz*Math.SQRT2/mpLocal_binHz));
      const mpLocal_neighbors=[];
      for(let mpLocal_j=mpLocal_lo;mpLocal_j<=mpLocal_hi;mpLocal_j++){
        if(Math.abs(mpLocal_j-mpLocal_peakBin)<=1)continue;
        if(Number.isFinite(mpFreqData[mpLocal_j]))mpLocal_neighbors.push(mpFreqData[mpLocal_j]);
      }
      mpLocal_neighbors.sort((mpLocal_a,mpLocal_b)=>mpLocal_a-mpLocal_b);
      const mpLocal_baseline=mpLocal_neighbors.length ?
        mpLocal_neighbors[Math.floor(mpLocal_neighbors.length/2)] : mpLocal_peak;
      const mpLocal_prominence=mpClamp(mpLocal_peak-mpLocal_baseline,0,30);
      // Keep a modest absolute-level contribution, so quiet noise
      // cannot be made as bright as a strong foreground signal.
      mpLocal_displayDb=-80+mpLocal_prominence*1.55+
        0.24*mpClamp(mpLocal_energyDb+75,-25,50);
    }
    const mpLocal_exposedDb=mpLocal_displayDb+mpLocal_exposure;
    const mpLocal_target=mpLocal_gateStrength>0 && mpLocal_energyDb<mpLocal_gate ? 0 :
      mpClamp((mpLocal_exposedDb+72)/54,0,1);
    const mpAmplitudeResponse=mpLocal_target>mpLocal_band.amp ?
      Math.max(0.18,1-mpSmoothingAmount) : Math.max(0.025,(1-mpSmoothingAmount)*0.3);
    mpLocal_band.amp+=(mpLocal_target-mpLocal_band.amp)*mpAmplitudeResponse;

    // Find local spectral maxima rather than blindly selecting the loudest bin.
    // The tracker prefers a peak near its previous frequency, and requires
    // repeated evidence before switching to a distant competitor.
    const mpLocal_persistence=Number(mpPersistence.value());
    const mpLocal_candidates=[];
    for(let mpLocal_i=mpLocal_first;mpLocal_i<=mpLocal_last;mpLocal_i++){
      const mpLocal_value=mpFreqData[mpLocal_i];
      if(!Number.isFinite(mpLocal_value))continue;
      const mpLocal_left=mpLocal_i>mpLocal_first ? mpFreqData[mpLocal_i-1] : -Infinity;
      const mpLocal_right=mpLocal_i<mpLocal_last ? mpFreqData[mpLocal_i+1] : -Infinity;
      if(mpLocal_value<mpLocal_left || mpLocal_value<mpLocal_right)continue;
      let mpLocal_offset=0;
      if(mpLocal_i>mpLocal_first && mpLocal_i<mpLocal_last){
        const mpLocal_denom=mpLocal_left-2*mpLocal_value+mpLocal_right;
        if(Number.isFinite(mpLocal_denom) && Math.abs(mpLocal_denom)>1e-8){
          mpLocal_offset=mpClamp(0.5*(mpLocal_left-mpLocal_right)/mpLocal_denom,-0.5,0.5);
        }
      }
      mpLocal_candidates.push({hz:(mpLocal_i+mpLocal_offset)*mpLocal_binHz, db:mpLocal_value});
    }
    mpLocal_candidates.sort((mpLocal_a,mpLocal_b)=>mpLocal_b.db-mpLocal_a.db);
    const mpLocal_strongest=mpLocal_candidates[0] || null;
    const mpLocal_audible=mpLocal_energyDb>=mpLocal_gate && mpLocal_strongest && mpLocal_strongest.db>mpLocal_gate-12;
    const mpLocal_maxJumpOctaves=0.11+0.19*(1-mpLocal_persistence);
    const mpLocal_switchFrames=Math.round(2+14*mpLocal_persistence);
    const mpLocal_holdFrames=Math.round(3+45*mpLocal_persistence);
    const mpLocal_switchAdvantageDb=3+12*mpLocal_persistence;

    if(!mpLocal_audible){
      mpLocal_band.missingFrames++;
      mpLocal_band.trackingState='holding';
      mpLocal_band.candidateHz=null;
      mpLocal_band.candidateFrames=0;
      if(mpLocal_band.missingFrames>mpLocal_holdFrames){
        mpLocal_band.trackedHz=null;
        mpLocal_band.trackingState='searching';
      }
    }else{
      mpLocal_band.missingFrames=0;
      if(mpLocal_band.trackedHz===null){
        mpLocal_band.trackedHz=mpLocal_strongest.hz;
        mpLocal_band.trackingState='locked';
      }else{
        // Select the best nearby peak, with a modest proximity penalty.
        const mpLocal_nearby=mpLocal_candidates.filter(mpLocal_c=>
          Math.abs(Math.log2(mpLocal_c.hz/mpLocal_band.trackedHz))<=mpLocal_maxJumpOctaves);
        mpLocal_nearby.sort((mpLocal_a,mpLocal_b)=>
          (mpLocal_b.db-12*Math.abs(Math.log2(mpLocal_b.hz/mpLocal_band.trackedHz)))-
          (mpLocal_a.db-12*Math.abs(Math.log2(mpLocal_a.hz/mpLocal_band.trackedHz))));
        const mpLocal_current=mpLocal_nearby[0]||null;
        if(mpLocal_current){
          // Update the locked frequency slowly, even before display smoothing.
          const mpLocal_follow=0.07+0.24*(1-mpLocal_persistence);
          mpLocal_band.trackedHz=Math.exp(Math.log(mpLocal_band.trackedHz)+
            mpLocal_follow*(Math.log(mpLocal_current.hz)-Math.log(mpLocal_band.trackedHz)));
          mpLocal_band.trackingState='locked';
        }else{
          mpLocal_band.trackingState='holding';
        }

        // A remote peak must be substantially louder than the local peak,
        // or persist when no local peak remains, before we switch tracks.
        const mpLocal_remote=mpLocal_candidates.find(mpLocal_c=>
          Math.abs(Math.log2(mpLocal_c.hz/mpLocal_band.trackedHz))>mpLocal_maxJumpOctaves);
        const mpLocal_deservesSwitch=mpLocal_remote &&
          (!mpLocal_current || mpLocal_remote.db>mpLocal_current.db+mpLocal_switchAdvantageDb);
        if(mpLocal_deservesSwitch){
          const mpLocal_sameCandidate=mpLocal_band.candidateHz!==null &&
            Math.abs(Math.log2(mpLocal_remote.hz/mpLocal_band.candidateHz))<0.08;
          mpLocal_band.candidateFrames=mpLocal_sameCandidate?mpLocal_band.candidateFrames+1:1;
          mpLocal_band.candidateHz=mpLocal_remote.hz;
          if(mpLocal_band.candidateFrames>=mpLocal_switchFrames){
            mpLocal_band.trackedHz=mpLocal_remote.hz;
            mpLocal_band.candidateHz=null;
            mpLocal_band.candidateFrames=0;
            mpLocal_band.trackingState='switched';
          }
        }else{
          mpLocal_band.candidateHz=null;
          mpLocal_band.candidateFrames=0;
        }
      }
    }

    // The original smoothing control still governs how fast the visible
    // wavelength approaches the persistent tracker frequency.
    if(mpLocal_band.trackedHz!==null){
      const mpLocal_frequencyAlpha=Math.max(0.01,1-mpSmoothingAmount);
      mpLocal_band.hz=Math.exp(Math.log(Math.max(1,mpLocal_band.hz))+
        mpLocal_frequencyAlpha*(Math.log(mpLocal_band.trackedHz)-Math.log(Math.max(1,mpLocal_band.hz))));
    }
    mpLocal_band.db=mpLocal_energyDb;
    mpLocal_band.readout.html(
      ' '+Math.round(mpLocal_band.hz)+' Hz · '+mpLocal_energyDb.toFixed(0)+' dB · '+
      Math.round(mpLocal_band.amp*100)+'% · '+mpLocal_band.trackingState
    );
  }
}

function mpClamp(mpLocal_value,mpLocal_low,mpLocal_high){
  return Math.max(mpLocal_low,Math.min(mpLocal_high,mpLocal_value));
}

// Each history entry is a snapshot of the waveform at the UPSTREAM
// boundary, not a global change to the whole medium. The wavefront
// at a point is determined by its travel time from that boundary.
function mpAdvancePropagation(mpLocal_dt){
  if(mpLocal_dt<=0)return;
  for(const mpLocal_band of mpBands){
    const mpLocal_s=mpLocal_band.spec;
    const mpLocal_hz=mpClamp(mpLocal_band.hz,mpLocal_s.low,mpLocal_s.high);
    const mpLocal_u=Math.log(mpLocal_hz/mpLocal_s.low)/Math.log(mpLocal_s.high/mpLocal_s.low);
    const mpLocal_cycles=mpLocal_s.minCycles+(mpLocal_s.maxCycles-mpLocal_s.minCycles)*mpLocal_u;
    const mpLocal_wavelength=MP_SIZE/mpLocal_cycles;
    const mpLocal_delta=2*Math.PI*MP_VISUAL_SPEED*mpLocal_dt/mpLocal_wavelength;
    // Keep UNWRAPPED phase for continuous interpolation in history.
    mpLocal_band.propagationPhase-=mpLocal_delta;
    mpLocal_band.history.push({t:mpElapsed,amp:mpLocal_band.amp,phase:mpLocal_band.propagationPhase});
    const mpLocal_cutoff=mpElapsed-MP_HISTORY_SECONDS;
    while(mpLocal_band.history.length>2 && mpLocal_band.history[1].t<mpLocal_cutoff)
      mpLocal_band.history.shift();
  }
}

// Historical interpolation only happens ~510 times per band per frame,
// rather than separately for every pixel. Missing history is silence.
function mpHistoryAt(mpLocal_band,mpLocal_when){
  const mpLocal_h=mpLocal_band.history;
  if(mpLocal_h.length===0 || mpLocal_when<mpLocal_h[0].t)return {amp:0,phase:0};
  if(mpLocal_when>=mpLocal_h[mpLocal_h.length-1].t)return mpLocal_h[mpLocal_h.length-1];
  let mpLocal_lo=0,mpLocal_hi=mpLocal_h.length-1;
  while(mpLocal_hi-mpLocal_lo>1){
    const mpLocal_mid=(mpLocal_lo+mpLocal_hi)>>1;
    if(mpLocal_h[mpLocal_mid].t<=mpLocal_when)mpLocal_lo=mpLocal_mid;else mpLocal_hi=mpLocal_mid;
  }
  const mpLocal_a=mpLocal_h[mpLocal_lo],mpLocal_b=mpLocal_h[mpLocal_hi];
  const mpLocal_u=(mpLocal_when-mpLocal_a.t)/(mpLocal_b.t-mpLocal_a.t);
  return {amp:mpLocal_a.amp+(mpLocal_b.amp-mpLocal_a.amp)*mpLocal_u,
          phase:mpLocal_a.phase+(mpLocal_b.phase-mpLocal_a.phase)*mpLocal_u};
}

function mpStates(){
  const mpLocal_radial=mpGeometry.value()==='radial';
  const mpLocal_cornerRadius=MP_SIZE*Math.SQRT2/2;
  const mpLocal_radius=mpLocal_cornerRadius*Number(mpRadialRadius.value());
  return mpBands.map(mpLocal_band=>{
    // Direction points INWARD, so the radial source lies 180° behind it.
    // 45° / 135° / 225° / 315° therefore put four sources on corners.
    const mpLocal_direction=Number(mpLocal_band.direction.value())*Math.PI/180;
    const mpLocal_dx=Math.cos(mpLocal_direction),mpLocal_dy=Math.sin(mpLocal_direction);
    const mpLocal_sourceX=MP_SIZE/2-mpLocal_radius*mpLocal_dx;
    const mpLocal_sourceY=MP_SIZE/2-mpLocal_radius*mpLocal_dy;
    const mpLocal_travelLookup=Array.from({length:MP_MAX_TRAVEL+1},(_,mpLocal_dist)=>{
      const mpLocal_past=mpElapsed-mpLocal_dist/MP_VISUAL_SPEED;
      return mpHistoryAt(mpLocal_band,mpLocal_past);
    });
    return {
      enabled:mpLocal_band.enabled.checked(), mpLocal_band,
      radial:mpLocal_radial,sourceX:mpLocal_sourceX,sourceY:mpLocal_sourceY,
      dx:mpLocal_dx,dy:mpLocal_dy,minProjection:-mpLocal_cornerRadius,sourceRadius:mpLocal_radius,cornerRadius:mpLocal_cornerRadius,
      travelLookup:mpLocal_travelLookup,
      userPhase:Number(mpLocal_band.phase.value())*Math.PI/180
    };
  });
}

function mpDistance(mpLocal_x,mpLocal_y,mpLocal_s){
  if(mpLocal_s.radial){
    // Distance from the point source determines history age, so circular
    // wavefronts carry source changes outward without instantaneous updates.
    // Subtract the source-circle radius before indexing wave history.
    // This keeps history distances bounded even when the sources are
    // thousands of pixels away, while retaining the correct curvature.
    // At radius = 1 corner radius this matches the original radial sketch.
    // At large radius, the distance differences converge to a plane wave.
    const mpLocal_fromSource=Math.hypot(mpLocal_x-mpLocal_s.sourceX,
      mpLocal_y-mpLocal_s.sourceY);
    return mpClamp(mpLocal_fromSource-mpLocal_s.sourceRadius+
      mpLocal_s.cornerRadius,0,MP_MAX_TRAVEL-1);
  }
  const mpLocal_projection=mpLocal_s.dx*(mpLocal_x-MP_SIZE/2)+
    mpLocal_s.dy*(mpLocal_y-MP_SIZE/2);
  return mpClamp(mpLocal_projection-mpLocal_s.minProjection,0,MP_MAX_TRAVEL-1);
}

function mpSample(mpLocal_x,mpLocal_y,mpLocal_s){
  const mpLocal_dist=mpDistance(mpLocal_x,mpLocal_y,mpLocal_s);
  const mpLocal_j=Math.floor(mpLocal_dist),mpLocal_u=mpLocal_dist-mpLocal_j;
  const mpLocal_a=mpLocal_s.travelLookup[mpLocal_j],mpLocal_b=mpLocal_s.travelLookup[mpLocal_j+1];
  const mpLocal_amp=mpLocal_a.amp+(mpLocal_b.amp-mpLocal_a.amp)*mpLocal_u;
  const mpLocal_phase=mpLocal_a.phase+(mpLocal_b.phase-mpLocal_a.phase)*mpLocal_u+mpLocal_s.userPhase;
  return {amp:mpLocal_amp,phase:mpLocal_phase,value:mpLocal_amp*Math.cos(mpLocal_phase)};
}

function mpPressure(mpLocal_x,mpLocal_y,mpLocal_states){
  let mpLocal_sum=0;
  for(const mpLocal_s of mpLocal_states){
    if(mpLocal_s.enabled)mpLocal_sum+=mpSample(mpLocal_x,mpLocal_y,mpLocal_s).value;
  }
  return mpLocal_sum;
}

function draw(){
  const mpLocal_now=millis();
  const mpLocal_dt=(mpPrev && mpRunning)?Math.min(0.1,(mpLocal_now-mpPrev)/1000):0;
  mpPrev=mpLocal_now;
  if(mpRunning){
    mpElapsed+=mpLocal_dt;
    mpUpdateSpectrum();
    mpUpdatePulse(mpLocal_dt);
    mpAdvancePropagation(mpLocal_dt);
  }
  const mpLocal_states=mpStates();
  background(255);
  mpReference(mpLocal_states);
  if(mpMode.value()==='pressure')mpDrawPressure(mpLocal_states);
  else mpDrawCrests(mpLocal_states);
}

// Envelopes are computed from the pair's delayed analytic signals.
// With time-varying wavelength these are visual envelope diagnostics,
// not a claim that the medium contains only two monochromatic waves.
function mpEnvelopeValue(mpLocal_x,mpLocal_states){
  const mpLocal_pair=mpPairMode.value().split(',').map(Number);
  const mpLocal_a=mpLocal_states[mpLocal_pair[0]],mpLocal_b=mpLocal_states[mpLocal_pair[1]];
  if(!mpLocal_a || !mpLocal_b || !mpLocal_a.enabled || !mpLocal_b.enabled)return 0;
  const mpLocal_aa=mpSample(mpLocal_x,MP_SIZE/2,mpLocal_a);
  const mpLocal_bb=mpSample(mpLocal_x,MP_SIZE/2,mpLocal_b);
  if(mpEnvelopeMode.value()==='spatial'){
    return Math.hypot(mpLocal_aa.amp*Math.cos(mpLocal_aa.phase)+mpLocal_bb.amp*Math.cos(mpLocal_bb.phase),
                      mpLocal_aa.amp*Math.sin(mpLocal_aa.phase)+mpLocal_bb.amp*Math.sin(mpLocal_bb.phase));
  }
  return (mpLocal_aa.amp+mpLocal_bb.amp)*Math.abs(Math.cos((mpLocal_aa.phase+mpLocal_bb.phase)/2));
}

function mpReference(mpLocal_states){
  noStroke();fill(246);rect(0,0,MP_SIZE,MP_REF_HEIGHT);
  const mpLocal_cy=MP_REF_HEIGHT/2,mpLocal_vertical=12;
  stroke(210);strokeWeight(1);line(0,mpLocal_cy,MP_SIZE,mpLocal_cy);
  for(const mpLocal_s of mpLocal_states){
    if(!mpLocal_s.enabled)continue;
    noFill();stroke(110,110,110,110);strokeWeight(1);
    beginShape();
    for(let mpLocal_px=0;mpLocal_px<=MP_SIZE;mpLocal_px++){
      const mpLocal_sample=mpSample(mpLocal_px,MP_SIZE/2,mpLocal_s);
      vertex(mpLocal_px,mpLocal_cy-mpLocal_sample.value*mpLocal_vertical);
    }
    endShape();
  }
  if(mpEnvelopeMode.value()!=='off'){
    noFill();stroke(205,110,45,210);strokeWeight(1.4);
    drawingContext.setLineDash([5,4]);
    for(const mpLocal_sign of [-1,1]){
      beginShape();
      for(let mpLocal_px=0;mpLocal_px<=MP_SIZE;mpLocal_px++)
        vertex(mpLocal_px,mpLocal_cy+mpLocal_sign*mpEnvelopeValue(mpLocal_px,mpLocal_states)*mpLocal_vertical);
      endShape();
    }
    drawingContext.setLineDash([]);
  }
  noFill();stroke(0);strokeWeight(2);
  beginShape();
  for(let mpLocal_px=0;mpLocal_px<=MP_SIZE;mpLocal_px++)
    vertex(mpLocal_px,mpLocal_cy-mpPressure(mpLocal_px,MP_SIZE/2,mpLocal_states)*mpLocal_vertical);
  endShape();
}

// Render crest peaks per pixel, since a wave's amplitude and wavelength
// now vary from one crest to the next. Each band contributes a transparent
// black layer. This preserves its individual historical line thickness.
// Pixel indices are allocated once, not once per animation frame.
// Typed-array forEach avoids the Web Editor's instrumented nested loops.
const mpCrestPixelIndices=Uint32Array.from({length:MP_SIZE*MP_SIZE},(_,i)=>i);

// Curated low-to-high frequency color sequences, not a hue-wheel rainbow.
const MP_PALETTES={
  spectral:['#183B58','#236781','#3A8C99','#83B7A4','#D4C5A0','#C88872','#9A536B','#653D67'],
  mineral:['#20374A','#405B66','#6B8588','#A3AF9E','#C8B89D','#C5A28A','#A98377','#745B60'],
  temperature:['#233D58','#426584','#7892A3','#BBC4C3','#E0D0AE','#C6A77D','#9B7658','#68535A']
};
function mpHexRGB(mpLocal_hex){
  return [parseInt(mpLocal_hex.slice(1,3),16),
          parseInt(mpLocal_hex.slice(3,5),16),
          parseInt(mpLocal_hex.slice(5,7),16)];
}
function mpBandColor(mpLocal_band,mpLocal_palette){
  const mpLocal_anchors=MP_PALETTES[mpLocal_palette];
  if(!mpLocal_anchors)return [0,0,0];
  // Fixed frequency mapping retains approximate color identity when band count changes.
  const mpLocal_center=Math.sqrt(mpLocal_band.spec.low*mpLocal_band.spec.high);
  const mpLocal_t=mpClamp(Math.log(mpLocal_center/80)/Math.log(6000/80),0,1)*7;
  const mpLocal_i=Math.min(6,Math.floor(mpLocal_t));
  const mpLocal_f=mpLocal_t-mpLocal_i;
  const mpLocal_a=mpHexRGB(mpLocal_anchors[mpLocal_i]);
  const mpLocal_b=mpHexRGB(mpLocal_anchors[mpLocal_i+1]);
  return mpLocal_a.map((mpLocal_v,mpLocal_k)=>mpLocal_v+(mpLocal_b[mpLocal_k]-mpLocal_v)*mpLocal_f);
}
function mpDrawCrests(mpLocal_states){
  const mpLocal_pulseMode=mpPulseMode.value();
  const mpLocal_pulseAmount=mpPulseEnvelope*Number(mpPulseDepth.value());
  const mpLocal_thicknessFactor=mpLocal_pulseMode==='thickness'?1+mpLocal_pulseAmount:1;
  const mpLocal_opacityFactor=mpLocal_pulseMode==='opacity'?1+mpLocal_pulseAmount:1;
  const mpLocal_palette=mpPaletteMode.value();
  const mpLocal_screen=mpLocal_palette!=='mono' && mpBlendMode.value()==='screen';
  const mpLocal_colorPulse=mpColorRms.value()==='on'
    ?mpPulseEnvelope*Number(mpColorDepth.value()):0;
  const mpLocal_active=mpLocal_states.filter(mpLocal_s=>mpLocal_s.enabled)
    .map(mpLocal_s=>({state:mpLocal_s,color:mpBandColor(mpLocal_s.mpLocal_band,mpLocal_palette)}));
  mpCrestImage.loadPixels();
  const mpLocal_pixels=mpCrestImage.pixels;
  // Retain typed-array traversal: conventional nested loops triggered the
  // p5 Web Editor's loop-protection false positives in previous versions.
  mpCrestPixelIndices.forEach(mpLocal_pixelIndex=>{
    const mpLocal_py=Math.floor(mpLocal_pixelIndex/MP_SIZE);
    const mpLocal_px=mpLocal_pixelIndex-mpLocal_py*MP_SIZE;
    const mpLocal_x=mpLocal_px+0.5,mpLocal_y=mpLocal_py+0.5;
    let mpLocal_r=mpLocal_screen?0:255;
    let mpLocal_g=mpLocal_r,mpLocal_b=mpLocal_r;
    mpLocal_active.forEach(mpLocal_layer=>{
      const mpLocal_s=mpLocal_layer.state;
      const mpLocal_sample=mpSample(mpLocal_x,mpLocal_y,mpLocal_s);
      if(mpLocal_sample.amp<0.01)return;
      const mpLocal_d=mpDistance(mpLocal_x,mpLocal_y,mpLocal_s);
      const mpLocal_i=Math.floor(mpLocal_d);
      const mpLocal_a=mpLocal_s.travelLookup[Math.max(0,mpLocal_i-1)];
      const mpLocal_nextHistory=mpLocal_s.travelLookup[Math.min(MP_MAX_TRAVEL,mpLocal_i+1)];
      const mpLocal_localK=Math.max(0.02,Math.abs(mpLocal_nextHistory.phase-mpLocal_a.phase)/2);
      const mpLocal_wrapped=Math.atan2(Math.sin(mpLocal_sample.phase),Math.cos(mpLocal_sample.phase));
      const mpLocal_crestDist=Math.abs(mpLocal_wrapped)/mpLocal_localK;
      const mpLocal_halfWidth=(0.35+6.5*mpLocal_sample.amp)*mpLocal_thicknessFactor;
      const mpLocal_coverage=mpClamp(mpLocal_halfWidth+0.65-mpLocal_crestDist,0,1);
      const mpLocal_opacity=mpClamp(0.93*Math.pow(mpLocal_sample.amp,0.8)*
        mpLocal_coverage*mpLocal_opacityFactor,0,1);
      // RMS luminosity changes pigment/light strength without changing hue.
      const mpLocal_strength=mpClamp(mpLocal_opacity*(1+mpLocal_colorPulse),0,1);
      const mpLocal_color=mpLocal_layer.color;
      if(mpLocal_screen){
        mpLocal_r=255*(1-(1-mpLocal_r/255)*(1-mpLocal_strength*mpLocal_color[0]/255));
        mpLocal_g=255*(1-(1-mpLocal_g/255)*(1-mpLocal_strength*mpLocal_color[1]/255));
        mpLocal_b=255*(1-(1-mpLocal_b/255)*(1-mpLocal_strength*mpLocal_color[2]/255));
      }else{
        mpLocal_r*=1-mpLocal_strength*(1-mpLocal_color[0]/255);
        mpLocal_g*=1-mpLocal_strength*(1-mpLocal_color[1]/255);
        mpLocal_b*=1-mpLocal_strength*(1-mpLocal_color[2]/255);
      }
    });
    const mpLocal_off=4*mpLocal_pixelIndex;
    mpLocal_pixels[mpLocal_off]=Math.round(mpLocal_r);
    mpLocal_pixels[mpLocal_off+1]=Math.round(mpLocal_g);
    mpLocal_pixels[mpLocal_off+2]=Math.round(mpLocal_b);
    mpLocal_pixels[mpLocal_off+3]=255;
  });
  mpCrestImage.updatePixels();
  image(mpCrestImage,0,MP_FIELD_TOP);
}

// Pressure sum keeps the original signed interference field. Color is assigned
// by the relative magnitude of each band's instantaneous contribution, while
// the signed SUM controls brightness. This avoids pretending pressure is a
// collection of independent colored crest overlays.
function mpDrawPressure(mpLocal_states){
  const mpLocal_palette=mpPaletteMode.value();
  const mpLocal_mono=mpLocal_palette==='mono';
  const mpLocal_screen=!mpLocal_mono && mpBlendMode.value()==='screen';
  const mpLocal_mode=mpPulseMode.value();
  const mpLocal_pulse=mpPulseEnvelope*Number(mpPulseDepth.value());
  const mpLocal_colorPulse=mpColorRms.value()==='on'
    ?mpPulseEnvelope*Number(mpColorDepth.value()):0;
  const mpLocal_active=mpLocal_states.filter(mpLocal_s=>mpLocal_s.enabled)
    .map(mpLocal_s=>({state:mpLocal_s,color:mpBandColor(mpLocal_s.mpLocal_band,mpLocal_palette)}));
  mpPressureImage.loadPixels();
  const mpLocal_pixels=mpPressureImage.pixels;
  // Reuse the typed-array traversal to avoid the editor's loop instrumentation.
  mpCrestPixelIndices.forEach(mpLocal_pixelIndex=>{
    const mpLocal_py=Math.floor(mpLocal_pixelIndex/MP_SIZE);
    const mpLocal_px=mpLocal_pixelIndex-mpLocal_py*MP_SIZE;
    const mpLocal_x=mpLocal_px+0.5,mpLocal_y=mpLocal_py+0.5;
    let mpLocal_sum=0,mpLocal_weight=0;
    let mpLocal_cr=0,mpLocal_cg=0,mpLocal_cb=0;
    mpLocal_active.forEach(mpLocal_layer=>{
      const mpLocal_sample=mpSample(mpLocal_x,mpLocal_y,mpLocal_layer.state);
      const mpLocal_value=mpLocal_sample.value;
      const mpLocal_weightHere=Math.abs(mpLocal_value);
      mpLocal_sum+=mpLocal_value;
      mpLocal_weight+=mpLocal_weightHere;
      mpLocal_cr+=mpLocal_weightHere*mpLocal_layer.color[0];
      mpLocal_cg+=mpLocal_weightHere*mpLocal_layer.color[1];
      mpLocal_cb+=mpLocal_weightHere*mpLocal_layer.color[2];
    });
    // Original monochrome pressure mapping when pulse is Off.
    const mpLocal_norm=mpClamp(mpLocal_sum/3,-1,1);
    let mpLocal_contrast=1;
    if(mpLocal_mode==='opacity')mpLocal_contrast+=mpLocal_pulse;
    // Pressure view has no stroke widths. Thickness therefore broadens
    // the high-contrast pressure regions by lowering their effective threshold.
    let mpLocal_mapped=mpLocal_norm;
    if(mpLocal_mode==='thickness'){
      const mpLocal_factor=1+mpLocal_pulse;
      mpLocal_mapped=Math.sign(mpLocal_norm)*
        (1-Math.pow(1-Math.abs(mpLocal_norm),mpLocal_factor));
    }else{
      mpLocal_mapped=mpClamp(mpLocal_norm*mpLocal_contrast,-1,1);
    }
    const mpLocal_gray=127.5+127.5*mpLocal_mapped;
    let mpLocal_r=mpLocal_gray,mpLocal_g=mpLocal_gray,mpLocal_b=mpLocal_gray;
    if(!mpLocal_mono){
      const mpLocal_rHue=mpLocal_weight>1e-8?mpLocal_cr/mpLocal_weight:127.5;
      const mpLocal_gHue=mpLocal_weight>1e-8?mpLocal_cg/mpLocal_weight:127.5;
      const mpLocal_bHue=mpLocal_weight>1e-8?mpLocal_cb/mpLocal_weight:127.5;
      // Brightness comes from the coherent pressure sum; band contribution
      // weights determine hue. Opposing waves can cancel to neutral gray.
      // Previous multiply mapped color through a small pressure-dependent
      // tint factor, making almost everything gray. Instead preserve pressure
      // luminance and apply the band-derived chroma at adjustable strength.
      const mpLocal_chroma=Number(mpPressureChroma.value());
      const mpLocal_rMix=mpLocal_rHue/255,mpLocal_gMix=mpLocal_gHue/255,mpLocal_bMix=mpLocal_bHue/255;
      const mpLocal_avg=(mpLocal_rMix+mpLocal_gMix+mpLocal_bMix)/3;
      const mpLocal_gain=1+mpLocal_colorPulse;
      if(mpLocal_screen){
        const mpLocal_light=mpClamp(Math.max(0,mpLocal_mapped)*mpLocal_gain,0,1);
        mpLocal_r=255*mpLocal_light*mpClamp(mpLocal_avg+(mpLocal_rMix-mpLocal_avg)*mpLocal_chroma,0,1);
        mpLocal_g=255*mpLocal_light*mpClamp(mpLocal_avg+(mpLocal_gMix-mpLocal_avg)*mpLocal_chroma,0,1);
        mpLocal_b=255*mpLocal_light*mpClamp(mpLocal_avg+(mpLocal_bMix-mpLocal_avg)*mpLocal_chroma,0,1);
      }else{
        const mpLocal_base=mpClamp(mpLocal_gray+(mpLocal_gray-127.5)*mpLocal_colorPulse,0,255);
        // Normalize color by its average so that signed pressure continues
        // to control overall brightness while chroma remains visible.
        const mpLocal_den=Math.max(0.15,mpLocal_avg);
        mpLocal_r=mpClamp(mpLocal_base*(1+mpLocal_chroma*(mpLocal_rMix/mpLocal_den-1)),0,255);
        mpLocal_g=mpClamp(mpLocal_base*(1+mpLocal_chroma*(mpLocal_gMix/mpLocal_den-1)),0,255);
        mpLocal_b=mpClamp(mpLocal_base*(1+mpLocal_chroma*(mpLocal_bMix/mpLocal_den-1)),0,255);
      }
    }else if(mpLocal_colorPulse>0){
      // Mono color luminosity pulse changes contrast, not hue.
      const mpLocal_v=mpClamp((mpLocal_gray-127.5)*(1+mpLocal_colorPulse)+127.5,0,255);
      mpLocal_r=mpLocal_v;mpLocal_g=mpLocal_v;mpLocal_b=mpLocal_v;
    }
    const mpLocal_off=4*mpLocal_pixelIndex;
    mpLocal_pixels[mpLocal_off]=Math.round(mpLocal_r);
    mpLocal_pixels[mpLocal_off+1]=Math.round(mpLocal_g);
    mpLocal_pixels[mpLocal_off+2]=Math.round(mpLocal_b);
    mpLocal_pixels[mpLocal_off+3]=255;
  });
  mpPressureImage.updatePixels();
  image(mpPressureImage,0,MP_FIELD_TOP);
}
