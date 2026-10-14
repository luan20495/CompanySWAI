import {access} from "node:fs/promises";
import {CompanyState} from "./state.js";
import {SafeId} from "./ids.js";
import {companyVersion} from "./company-version.js";
import {baselineClaims,buildScorecard,scorecardProjectIds} from "./scorecard.js";
import {renderBaseline,renderProject,renderScorecard} from "./scorecard-render.js";
import {redact,registerSecret} from "./secrets.js";

// Read-only owner view of what CompanySWAI is doing and has done. Usage: npm run scorecard -- [--project id] [--baseline] [--json]
const USAGE=[
 "Usage: npm run scorecard -- [--state-dir dir] [--project id] [--since ISO] [--until ISO] [--baseline] [--json] [--failed N]",
 "  (no flags)     company overview: running now, finished/failed and why, who, time, tokens, interventions, metrics",
 "  --project id   one project: every task with attempts, verdicts, wall time and failure reason",
 "  --baseline     the historical audit's claims recomputed from the state directory",
 "  --since/--until  only runs that started in [since, until) (ISO timestamps, UTC)",
 "  --json         machine-readable output (no raw prompts or agent output are ever included)",
 "Reads only; never writes to the state directory."
].join("\n");

const args=process.argv.slice(2),valued=["--state-dir","--project","--since","--until","--failed"],flags=["--baseline","--json","--help"];
const one=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
args.forEach((a,i)=>{if(!valued.includes(args[i-1]??"")&&!valued.includes(a)&&!flags.includes(a))throw new Error("Unknown argument "+a+"\n"+USAGE);});
if(args.includes("--help")){console.log(USAGE);process.exit(0);}
for(const name of valued)if(args.includes(name)&&(one(name)===undefined||one(name)!.startsWith("--")))throw new Error(name+" needs a value\n"+USAGE);
const iso=(name:string)=>{const v=one(name);if(v!==undefined&&Number.isNaN(Date.parse(v)))throw new Error(name+" must be an ISO timestamp");return v;};
const project=one("--project");
if(project!==undefined&&!SafeId.safeParse(project).success)throw new Error("Invalid project id");
const failed=one("--failed")?Number(one("--failed")):undefined;
if(failed!==undefined&&!(Number.isInteger(failed)&&failed>0))throw new Error("--failed needs a positive integer");
// Credentials from the environment are masked in everything printed.
for(const [name,value] of Object.entries(process.env))if(/(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name))registerSecret(value);

const state=new CompanyState(one("--state-dir")??".companyswai");
if(project&&!(await scorecardProjectIds(state.root)).includes(project))throw new Error("Unknown project '"+project+"' under "+state.root);
const programPath="docs/evolution/phases.json",hasProgram=await access(programPath).then(()=>true,()=>false);
const card=await buildScorecard(state,{since:iso("--since"),until:iso("--until"),projects:project?[project]:undefined,checkout:await companyVersion("."),programPath:hasProgram?programPath:undefined});

const out=args.includes("--baseline")
 ?(args.includes("--json")?JSON.stringify({generatedAt:card.generatedAt,stateDir:card.stateDir,window:card.window,totals:card.totals,claims:baselineClaims(card),coverage:card.coverage,metrics:card.metrics},null,2):renderBaseline(card,baselineClaims(card)))
 :args.includes("--json")?JSON.stringify(card,null,2)
 :project?renderProject(card,card.runs[0]):renderScorecard(card,{failedLimit:failed});
process.stdout.write(redact(out)+"\n");
