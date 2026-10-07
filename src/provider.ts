export type ModelRequest={system:string;prompt:string;maxTokens:number};
export type ModelResponse={text:string;inputTokens:number;outputTokens:number};
export interface ModelProvider{readonly name:string;readonly model:string;generate(request:ModelRequest):Promise<ModelResponse>;}
export type ProviderFactory=(model:string)=>ModelProvider;

export class ProviderRegistry{
 private factories=new Map<string,ProviderFactory>();
 register(id:string,factory:ProviderFactory){this.factories.set(id,factory);}
 create(id:string,model:string){
  const factory=this.factories.get(id);
  if(!factory)throw new Error("Provider not registered: "+id);
  return factory(model);
 }
 ids(){return [...this.factories.keys()];}
}
