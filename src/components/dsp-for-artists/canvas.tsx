'use client';
import { useEffect, useRef, type MutableRefObject } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useDspCourse } from './provider';
import type { DspParameters } from '@/lib/dsp-for-artists/course';
import type { DspAnalysisFrame } from '@/lib/dsp-for-artists/engine';
import { colorAt, WorkshopRenderer } from '@/lib/dsp-for-artists/renderer';

export { colorAt };

export function DspCanvas({presentation=false,external}:{presentation?:boolean;external?:{parameters:DspParameters;frameRef:MutableRefObject<DspAnalysisFrame|null>}}) {
  const course=useDspCourse(),parameters=external?.parameters??course.parameters;
  const externalFrameRef=external?.frameRef,passive=external!==undefined;
  const canvasRef=useRef<HTMLCanvasElement>(null),rendererRef=useRef<WorkshopRenderer|null>(null),parametersRef=useRef(parameters);

  useEffect(()=>{parametersRef.current=parameters;rendererRef.current?.setParameters(parameters)},[parameters]);
  useEffect(()=>{
    const canvas=canvasRef.current!;const renderer=new WorkshopRenderer(canvas,parametersRef.current);rendererRef.current=renderer;
    const unsubscribe=passive?()=>{}:course.engine.subscribe(frame=>renderer.pushFrame(frame));
    const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)renderer.resize(box.width,box.height,devicePixelRatio||1)});observer.observe(canvas);
    let animation=0,lastExternalSequence=-1;const draw=(now:number)=>{const frame=externalFrameRef?.current;if(frame&&frame.sequence!==lastExternalSequence){lastExternalSequence=frame.sequence;renderer.pushFrame(frame)}renderer.render(now);animation=requestAnimationFrame(draw)};animation=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(animation);observer.disconnect();unsubscribe();renderer.destroy();rendererRef.current=null};
  },[course.engine,externalFrameRef,passive]);

  return <Box sx={{position:'relative',width:'100%',height:'100%',minHeight:320,bgcolor:'#050919'}}>
    <canvas ref={canvasRef} aria-label={`${parameters.mode} audio visualization`} style={{display:'block',width:'100%',height:'100%'}}/>
    {!presentation&&<Box sx={{position:'absolute',left:12,bottom:12,display:'flex',alignItems:'center',gap:1,p:1,borderRadius:1,bgcolor:'rgba(255,255,255,.92)'}}>
      <Button size="small" variant="contained" onClick={()=>void course.startAudio()}>Start audio</Button>
      <Button size="small" onClick={()=>void course.enableMicrophone()}>Enable microphone</Button>
      <Typography variant="caption">{course.audioStatus.message}</Typography>
    </Box>}
  </Box>;
}
