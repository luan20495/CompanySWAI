import {OpenAICompatibleProvider} from "./openai-compatible.js";

export const OPENROUTER_BASE_URL="https://openrouter.ai/api/v1";

export class OpenRouterProvider extends OpenAICompatibleProvider{
 constructor(apiKey:string,model:string,baseUrl=OPENROUTER_BASE_URL,timeoutMs?:number){
  super("openrouter",apiKey,model,baseUrl,timeoutMs);
 }
}
