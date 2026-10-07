export class KeyedSemaphore{
 private active=new Map<string,number>();
 private queues=new Map<string,Array<()=>void>>();
 async use<T>(key:string,limit:number,fn:()=>Promise<T>):Promise<T>{
  if(limit<1)throw new Error("Concurrency limit must be positive");
  if((this.active.get(key)??0)>=limit)await new Promise<void>(resolve=>{const q=this.queues.get(key)??[];q.push(resolve);this.queues.set(key,q);});
  this.active.set(key,(this.active.get(key)??0)+1);
  try{return await fn();}
  finally{
   this.active.set(key,Math.max(0,(this.active.get(key)??1)-1));
   const next=this.queues.get(key)?.shift();if(next)next();
  }
 }
}
