import "dotenv/config";
import {writeFile} from "node:fs/promises";
import {runBenchmark} from "./benchmark.js";
import {loadRuntime} from "./runtime.js";

const args=process.argv.slice(2),flag=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const live=args.includes("--live"),out=flag("--out");
let options:Parameters<typeof runBenchmark>[0]={briefPath:flag("--brief"),stateDir:flag("--state-dir")};
if(live){
 const runtime=await loadRuntime(flag("--runtime")??"config/providers.json");
 options={...options,live:{selector:runtime.selector,label:runtime.profiles.map(p=>p.provider+"/"+p.model).join(", ")}};
}
const report=await runBenchmark(options);
const text=JSON.stringify(report,null,2);
console.log(text);
if(out)await writeFile(out,text+"\n","utf8");
if(!report.ok){console.error("BENCHMARK FAILED: "+report.failures.join("; "));process.exitCode=1;}
