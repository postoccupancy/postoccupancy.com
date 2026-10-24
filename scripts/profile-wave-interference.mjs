import {chromium} from '@playwright/test';

const base=process.env.WAVE_PROFILE_URL||'http://127.0.0.1:3001';
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
const context=await browser.newContext({permissions:['microphone'],viewport:{width:1440,height:900}});
const controller=await context.newPage();
await controller.goto(`${base}/instruments/wave-interference`);
await controller.getByRole('button',{name:'Plane Lines'}).click();
await controller.getByRole('button',{name:'Start audio'}).click();
await controller.getByText(/Audio active:/).waitFor();
await controller.waitForTimeout(1500);
const popupPromise=controller.waitForEvent('popup');
await controller.getByRole('button',{name:'Presentation'}).click();
const projector=await popupPromise;
await projector.getByLabel('Wave Interference visualization').waitFor();
await projector.bringToFront();
const controllerCountBefore=Number(await controller.getByLabel('Wave Interference visualization').getAttribute('data-render-count'));
const samples=[];
for(let index=0;index<20;index++){
  await projector.waitForTimeout(250);
  samples.push(await projector.getByLabel('Wave Interference visualization').evaluate(canvas=>({analysis:Number(canvas.dataset.analysisMs),render:Number(canvas.dataset.renderMs),interval:Number(canvas.dataset.presentationFrameIntervalMs)})));
}
const valid=key=>samples.map(sample=>sample[key]).filter(Number.isFinite).filter(value=>value>0);
const summary=key=>{const values=valid(key).sort((a,b)=>a-b);return{median:Number(values[Math.floor(values.length/2)]?.toFixed(2)),p95:Number(values[Math.floor(values.length*.95)]?.toFixed(2)),samples:values.length}};
const controllerMetrics=await controller.getByLabel('Wave Interference visualization').evaluate(canvas=>({render:Number(canvas.dataset.renderMs),interval:Number(canvas.dataset.presentationFrameIntervalMs),renderCount:Number(canvas.dataset.renderCount)}));
console.log(JSON.stringify({source:'Chromium fake media device through real Web Audio',controllerBackgrounded:true,projector:{analysisMs:summary('analysis'),renderMs:summary('render'),frameIntervalMs:summary('interval')},controllerRenderCountBefore:controllerCountBefore,controllerLastRender:controllerMetrics,duplicatePreviewRenders:controllerMetrics.renderCount-controllerCountBefore},null,2));
await browser.close();
