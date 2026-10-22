class DspMicrophoneCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(2048);this.write=0;}
  process(inputs,outputs){
    const input=inputs[0]?.[0],output=outputs[0]?.[0];
    if(output)output.fill(0);
    if(input?.length)for(const sample of input){this.buffer[this.write++]=sample;if(this.write===this.buffer.length){const block=this.buffer;this.port.postMessage(block,[block.buffer]);this.buffer=new Float32Array(2048);this.write=0;}}
    return true;
  }
}
registerProcessor('dsp-microphone-capture',DspMicrophoneCapture);
