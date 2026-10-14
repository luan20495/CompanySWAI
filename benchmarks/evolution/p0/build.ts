import {rm} from "node:fs/promises";
import {writeFile} from "node:fs/promises";
import {CompanyState} from "../../../src/state.js";
import {buildScorecard} from "../../../src/scorecard.js";
import {FIXTURE_NOW,RUNNING_PID,buildFixture} from "./fixture.js";

// Regenerates the committed Phase 0 fixture and its golden scorecard: npx tsx benchmarks/evolution/p0/build.ts
// test/scorecard.test.ts fails if either differs from what this produces.
export const FIXTURE_DIR="benchmarks/evolution/p0/state",EXPECTED="benchmarks/evolution/p0/expected-scorecard.json";
export async function goldenScorecard(stateDir:string){
 const card=await buildScorecard(new CompanyState(stateDir),{now:FIXTURE_NOW,isAlive:pid=>pid===RUNNING_PID});
 return JSON.stringify({...card,stateDir:"<fixture>"},null,2)+"\n";
}
if(process.argv[1]?.endsWith("build.ts")){
 await rm(FIXTURE_DIR,{recursive:true,force:true});
 const files=await buildFixture(FIXTURE_DIR);
 await writeFile(EXPECTED,await goldenScorecard(FIXTURE_DIR),"utf8");
 console.log("wrote "+files.length+" fixture file(s) under "+FIXTURE_DIR+" and "+EXPECTED);
}
