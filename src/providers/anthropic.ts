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
  return {
   text,
   inputTokens:response.usage.input_tokens,
   outputTokens:response.usage.output_tokens
  };
 }
}
