/** Descriptive metadata about the step being run. Remote providers never receive it; local fixtures (dry-run) use it to emit valid structured output. */
export type RequestMeta={taskId:string;kind:"maker"|"review";sections:string[];validators:string[];params:Record<string,unknown>;requirementIds?:string[];ownerCandidates?:string[];slot?:number;retrieved?:Array<{url:string;title:string;retrieved:string;authority:string;published?:string}>};
export type ModelRequest={system:string;prompt:string;maxTokens:number;signal?:AbortSignal;meta?:RequestMeta};
/** `model` is the model that actually answered, when the provider reports it (aliases like "sonnet" resolve to a concrete id). */
/**
 * `tokenSource` says where the token counts came from: "reported" by the provider, "estimated" by a fixture, or absent when the
 * provider gave no usage (the counts are then 0 but mean unknown). Cache figures are prompt-cache creation/reads as the provider
 * reported them. `cacheTokensInInput` says whether `inputTokens` already contains them: true for claude-code (its CLI total),
 * false for the Anthropic Messages API (its input_tokens excludes cache). `inputTokens` keeps each provider's pre-existing
 * meaning because budgets and approvals price it; physical input is inputTokens plus the cache parts when they are excluded.
 */
export type TokenSource="reported"|"estimated";
export type ModelResponse={text:string;inputTokens:number;outputTokens:number;model?:string;tokenSource?:TokenSource;cacheCreationInputTokens?:number;cacheReadInputTokens?:number;cacheTokensInInput?:boolean};
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
