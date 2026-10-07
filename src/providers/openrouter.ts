import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";

type OpenRouterResponse={
 choices?:Array<{message?:{content?:string|null}}>;
 usage?:{prompt_tokens?:number;completion_tokens?:number};
 error?:{message?:string};
};

export class OpenRouterProvider implements ModelProvider{
 readonly name="openrouter";
 constructor(
  private apiKey:string,
  readonly model:string,
  private baseUrl="https://openrouter.ai/api/v1"
 ){}

 async generate(request:ModelRequest):Promise<ModelResponse>{
  const response=await fetch(this.baseUrl+"/chat/completions",{
   method:"POST",
   headers:{
    "authorization":"Bearer "+this.apiKey,
    "content-type":"application/json"
   },
   body:JSON.stringify({
    model:this.model,
    max_tokens:request.maxTokens,
    messages:[
     {role:"system",content:request.system},
     {role:"user",content:request.prompt}
    ]
   })
  });
  const body=await response.json() as OpenRouterResponse;
  if(!response.ok)throw new Error("OpenRouter request failed ("+response.status+"): "+(body.error?.message??"unknown error"));
  const text=body.choices?.[0]?.message?.content??"";
  if(!text)throw new Error("OpenRouter returned no text output");
  return {
   text,
   inputTokens:body.usage?.prompt_tokens??0,
   outputTokens:body.usage?.completion_tokens??0
  };
 }
}
