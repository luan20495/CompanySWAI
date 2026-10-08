import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";
import {redact} from "../secrets.js";

type ChatResponse={
 choices?:Array<{message?:{content?:string|null}}>;
 usage?:{prompt_tokens?:number;completion_tokens?:number};
 error?:{message?:string};
};

/** Any OpenAI-style /chat/completions endpoint. OpenRouter is this adapter with a fixed base URL. */
export class OpenAICompatibleProvider implements ModelProvider{
 constructor(
  readonly name:string,
  private apiKey:string,
  readonly model:string,
  private baseUrl:string,
  private timeoutMs=120_000
 ){}

 async generate(request:ModelRequest):Promise<ModelResponse>{
  const response=await fetch(this.baseUrl+"/chat/completions",{
   method:"POST",
   headers:{"authorization":"Bearer "+this.apiKey,"content-type":"application/json"},
   body:JSON.stringify({
    model:this.model,
    max_tokens:request.maxTokens,
    messages:[{role:"system",content:request.system},{role:"user",content:request.prompt}]
   }),
   signal:AbortSignal.timeout(this.timeoutMs)
  });
  const body=await response.json().catch(()=>({})) as ChatResponse;
  if(!response.ok)throw new Error(this.name+" request failed ("+response.status+"): "+redact(body.error?.message??"unknown error"));
  const text=body.choices?.[0]?.message?.content??"";
  if(!text)throw new Error(this.name+" returned no text output");
  return {text,inputTokens:body.usage?.prompt_tokens??0,outputTokens:body.usage?.completion_tokens??0};
 }
}
