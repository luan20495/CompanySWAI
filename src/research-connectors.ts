import {readFile} from "node:fs/promises";
import {z} from "zod";

/**
 * Pluggable research connectors. Core orchestration only knows this interface: a connector turns a query into retrieved
 * documents. The orchestrator fetches documents before a research task runs and hands exactly those to the agent, so
 * citations point at material that was really retrieved (no URLs recalled from model memory).
 */
export type ResearchDocument={url:string;title:string;excerpt:string;retrieved:string;authority:"HIGH"|"MEDIUM"|"LOW";published?:string;connector:string};
export interface ResearchConnector{
 readonly name:string;
 search(query:string,options:{maxResults:number;signal?:AbortSignal}):Promise<Array<Omit<ResearchDocument,"retrieved"|"connector"|"authority"> & {authority?:"HIGH"|"MEDIUM"|"LOW"}>>;
}

export const ConnectorConfig=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("static"),path:z.string().min(1)}),
 z.object({kind:z.literal("http-json"),url:z.string().url(),timeoutMs:z.number().int().positive().default(15_000),/** name of an environment variable holding a bearer token; the token itself never appears in config */tokenEnv:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional()})
]);
export type ConnectorConfigValue=z.infer<typeof ConnectorConfig>;

const Doc=z.object({url:z.string().url(),title:z.string().min(1),excerpt:z.string().default(""),published:z.string().optional(),authority:z.enum(["HIGH","MEDIUM","LOW"]).optional(),keywords:z.array(z.string()).optional()});
const words=(text:string)=>text.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>2);

/** A local corpus: a JSON array of documents, matched to queries by keyword overlap. Deterministic and offline. */
export class StaticConnector implements ResearchConnector{
 readonly name="static";
 constructor(private path:string){}
 async search(query:string,options:{maxResults:number}){
  const docs=z.array(Doc).parse(JSON.parse(await readFile(this.path,"utf8"))),q=new Set(words(query));
  return docs.map(doc=>({doc,score:[...words(doc.title+" "+doc.excerpt),...(doc.keywords??[]).flatMap(words)].filter(w=>q.has(w)).length})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.doc.url.localeCompare(b.doc.url)).slice(0,options.maxResults).map(x=>x.doc);
 }
}

/** Any HTTP endpoint answering GET <url>?q=<query> with {"results":[{url,title,excerpt,published?,authority?}]}. */
export class HttpJsonConnector implements ResearchConnector{
 readonly name="http-json";
 constructor(private url:string,private timeoutMs=15_000,private token?:string){}
 async search(query:string,options:{maxResults:number;signal?:AbortSignal}){
  const target=new URL(this.url);target.searchParams.set("q",query);target.searchParams.set("limit",String(options.maxResults));
  const signals=[AbortSignal.timeout(this.timeoutMs),...(options.signal?[options.signal]:[])];
  const response=await fetch(target,{headers:{accept:"application/json",...(this.token?{authorization:"Bearer "+this.token}:{})},signal:AbortSignal.any(signals)});
  if(!response.ok)throw new Error("research connector http-json failed ("+response.status+")");
  const body=await response.json() as {results?:unknown};
  return z.array(Doc).parse(body.results??[]).slice(0,options.maxResults);
 }
}

export type ConnectorFactory=(config:ConnectorConfigValue)=>ResearchConnector;
export class ConnectorRegistry{
 private factories=new Map<string,ConnectorFactory>();
 register(kind:string,factory:ConnectorFactory){this.factories.set(kind,factory);return this;}
 create(config:ConnectorConfigValue){
  const factory=this.factories.get(config.kind);
  if(!factory)throw new Error("Research connector kind not registered: "+config.kind);
  return factory(config);
 }
 kinds(){return [...this.factories.keys()];}
}
export function defaultConnectorRegistry(){
 return new ConnectorRegistry()
  .register("static",config=>new StaticConnector((config as {path:string}).path))
  .register("http-json",config=>{const c=config as {url:string;timeoutMs:number;tokenEnv?:string};return new HttpJsonConnector(c.url,c.timeoutMs,c.tokenEnv?process.env[c.tokenEnv]:undefined);});
}

/** Fetches documents for every query from every connector; duplicates by URL are dropped, results are capped and ordered deterministically. */
export async function gatherResearch(connectors:ResearchConnector[],queries:string[],options:{maxDocuments?:number;perQuery?:number;now?:Date;signal?:AbortSignal}={}):Promise<ResearchDocument[]>{
 const retrieved=(options.now??new Date()).toISOString().slice(0,10),seen=new Map<string,ResearchDocument>();
 for(const connector of connectors)for(const query of queries){
  let found;
  try{found=await connector.search(query,{maxResults:options.perQuery??5,signal:options.signal});}
  catch(error){throw new Error("research connector '"+connector.name+"' failed for query '"+query.slice(0,60)+"': "+(error instanceof Error?error.message:String(error)));}
  for(const doc of found)if(!seen.has(doc.url))seen.set(doc.url,{...doc,authority:doc.authority??"MEDIUM",retrieved,connector:connector.name});
 }
 return [...seen.values()].sort((a,b)=>a.url.localeCompare(b.url)).slice(0,options.maxDocuments??12);
}

/** The retrieved material as the agent sees it, with the source IDs it must cite. */
export function renderRetrieved(documents:ResearchDocument[]){
 if(!documents.length)return "";
 return "--- RETRIEVED SOURCES (cite only these for external facts; reuse these IDs in ## Sources) ---\n"+documents.map((d,i)=>"[S"+(i+1)+"] "+d.title+" | "+d.url+" | retrieved: "+d.retrieved+" | authority: "+d.authority+(d.published?" | published: "+d.published:"")+"\n"+d.excerpt.slice(0,800)).join("\n\n");
}
