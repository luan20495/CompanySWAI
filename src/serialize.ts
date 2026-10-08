const tails=new Map<string,Promise<unknown>>();
/** Runs `fn` after every earlier call with the same key has settled (in-process mutex, keyed). */
export function serialised<T>(key:string,fn:()=>Promise<T>):Promise<T>{
 const next=(tails.get(key)??Promise.resolve()).catch(()=>undefined).then(fn);
 tails.set(key,next);
 return next;
}
