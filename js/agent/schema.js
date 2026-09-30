export class ToolError extends Error {constructor(code,message){super(message);this.code=code;}}
export const field={string:(max=160)=>({type:'string',max}),id:()=>({type:'string',max:80,pattern:/^[a-zA-Z0-9_-]+$/}),date:()=>({type:'date'}),bool:()=>({type:'boolean'}),integer:(min=0,max=100)=>({type:'integer',min,max}),enum:values=>({type:'enum',values}),array:(item,max=50)=>({type:'array',item,max})};
export function validate(schema,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ToolError('input','Tool parameters must be an object.');
 for(const key of Object.keys(input))if(!Object.hasOwn(schema,key))throw new ToolError('input','Unknown parameter: '+key);
 const check=(spec,value,key)=>{
  if(value===null&&spec.nullable)return;
  if(value===undefined){if(spec.required)throw new ToolError('input','Missing '+key);return;}
  let ok=false;
  if(spec.type==='string')ok=typeof value==='string'&&value.length>0&&value.length<=spec.max&&(!spec.pattern||spec.pattern.test(value));
  if(spec.type==='boolean')ok=typeof value==='boolean';
  if(spec.type==='integer')ok=Number.isInteger(value)&&value>=spec.min&&value<=spec.max;
  if(spec.type==='enum')ok=spec.values.includes(value);
  if(spec.type==='date')ok=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  if(spec.type==='array'){ok=Array.isArray(value)&&value.length<=spec.max;if(ok)value.forEach(x=>check(spec.item,x,key));}
  if(!ok)throw new ToolError('input','Invalid '+key+'.');
 };
 for(const [key,spec] of Object.entries(schema))check(spec,input[key],key);
 return input;
}
