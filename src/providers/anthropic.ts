import type Anthropic from "@anthropic-ai/sdk";
import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";

export class AnthropicProvider implements ModelProvider{
 readonly name="anthropic";
 constructor(private client:Anthropic,readonly model:string){}

 async generate(request:ModelRequest):Promise<ModelResponse>{
  const response=await this.client.messages.create({
   model:this.model,
   max_tokens:request.maxTokens,
   system:request.system,
   messages:[{role:"user",content:request.prompt}]
  });
  const text=response.content
   .filter(block=>block.type==="text")
   .map(block=>block.text)
   .join("\n");
  // The Messages API reports prompt-cache writes and reads separately from input_tokens. inputTokens keeps its pre-existing
  // meaning (uncached input only) because budgets price it; the cache parts are recorded separately, flagged as not included.
  const usage=response.usage,cacheCreation=usage.cache_creation_input_tokens??undefined,cacheRead=usage.cache_read_input_tokens??undefined;
  return {
   text,
   inputTokens:usage.input_tokens,
   outputTokens:usage.output_tokens,
   tokenSource:"reported",
   ...(cacheCreation!=null||cacheRead!=null?{cacheTokensInInput:false}:{}),
   ...(cacheCreation!=null?{cacheCreationInputTokens:cacheCreation}:{}),
   ...(cacheRead!=null?{cacheReadInputTokens:cacheRead}:{})
  };
 }
}
