export type ModelRequest={system:string;prompt:string;maxTokens:number;signal?:AbortSignal};
/** `model` is the model that actually answered, when the provider reports it (aliases like "sonnet" resolve to a concrete id). */
export type ModelResponse={text:string;inputTokens:number;outputTokens:number;model?:string};
export interface ModelProvider{readonly name:string;readonly model:string;generate(request:ModelRequest):Promise<ModelResponse>;}
/** Everything a factory needs to build a provider; the apiKey is resolved from the profile's credentialEnv at call time. */
export type ProviderContext={model:string;apiKey?:string;baseUrl?:string;timeoutMs?:number;command?:string};
export type ProviderFactory=(context:ProviderContext)=>ModelProvider;

export class ProviderRegistry{
 private factories=new Map<string,ProviderFactory>();
 register(id:string,factory:ProviderFactory){this.factories.set(id,factory);return this;}
 has(id:string){return this.factories.has(id);}
 create(id:string,context:ProviderContext){
  const factory=this.factories.get(id);
  if(!factory)throw new Error("Provider not registered: "+id);
  return factory(context);
 }
 ids(){return [...this.factories.keys()];}
}
