import type {ModelProvider,ModelRequest,ModelResponse} from "../provider.js";

export class EchoProvider implements ModelProvider{
 readonly name="echo";
 constructor(readonly model="dry-run"){}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const text="[DRY RUN]\n"+request.prompt;
  return {text,inputTokens:request.prompt.length,outputTokens:text.length};
 }
}
