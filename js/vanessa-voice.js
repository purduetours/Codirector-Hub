/* Browser dictation. Transcription is reviewed; it never sends a chat message. */
let recognizer=null,generation=0,timer=null;
let current={phase:'idle',text:'',message:'Your browser may send audio to its speech service. Review the transcript before using it.'};
const listeners=new Set();
const API=()=>globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
export const voiceSupported=()=>typeof API()==='function';
export const voiceState=()=>({...current});
export const onVoiceChange=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const publish=patch=>{current={...current,...patch};listeners.forEach(fn=>fn());};
export function setVoiceText(text){if(current.phase!=='recording')current.text=String(text).slice(0,12000);}
export function startVoice(){
  if(recognizer)return;
  if(!voiceSupported()){publish({phase:'error',message:'Dictation is not supported in this browser. You can still type your notes.'});return;}
  if(globalThis.isSecureContext===false){publish({phase:'error',message:'Open the hub over HTTPS to use the microphone.'});return;}
  const ticket=++generation;
  let instance;
  try{
    instance=new (API())();recognizer=instance;
    instance.lang='en-US';instance.continuous=true;instance.interimResults=true;
    publish({phase:'recording',text:'',message:'Listening… press Stop when you are finished.'});
    instance.onresult=event=>{
      if(ticket!==generation)return;
      const parts=[];
      for(let i=0;i<event.results.length;i++)parts.push(event.results[i][0]?.transcript||'');
      publish({text:parts.join(' ').trim().slice(0,12000)});
    };
    instance.onerror=event=>{
      if(ticket!==generation)return;
      const messages={'not-allowed':'Microphone permission was denied. Allow it in browser settings or type your notes.',
        'service-not-allowed':'The browser speech service is unavailable. Type your notes instead.',
        'audio-capture':'No microphone was available. Check the microphone connection.',
        network:'Dictation could not reach the browser speech service. Check your connection.',
        'no-speech':'No speech was detected. Try recording again.'};
      clearTimeout(timer);recognizer=null;generation++;
      try{instance.abort();}catch{}
      publish({phase:'error',message:messages[event.error]||'Dictation stopped. Review any captured text or try again.'});
    };
    instance.onend=()=>{
      if(ticket!==generation)return;
      clearTimeout(timer);recognizer=null;
      publish({phase:'review',message:current.text?'Review and edit your transcript, then choose Use transcript.':'No speech was captured. Try again or type your notes.'});
    };
    instance.start(); // direct user gesture; microphone permission belongs to the browser
    timer=setTimeout(()=>stopVoice(),90000);
  }catch{
    if(instance){try{instance.abort();}catch{}}
    generation++;recognizer=null;clearTimeout(timer);
    publish({phase:'error',message:'The microphone could not start. Check permissions or type your notes.'});
  }
}
export function stopVoice(){
  if(!recognizer)return;
  clearTimeout(timer);
  publish({phase:'stopping',message:'Finishing the transcript…'});
  try{recognizer.stop();}catch{resetVoice();}
  // Some engines fail to emit end. Release capture rather than listening forever.
  if(recognizer)timer=setTimeout(()=>{
    const old=recognizer;generation++;recognizer=null;try{old?.abort();}catch{}
    publish({phase:'review',message:'Review the captured transcript before using it.'});
  },5000);
}
export function resetVoice(){
  const old=recognizer;generation++;recognizer=null;clearTimeout(timer);
  try{old?.abort();}catch{}
  publish({phase:'idle',text:'',message:'Your browser may send audio to its speech service. Review the transcript before using it.'});
}
