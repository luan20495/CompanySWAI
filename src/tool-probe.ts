import {access,constants} from "node:fs/promises";
import {delimiter,join} from "node:path";

/**
 * Detects optional external binaries (scanners, browser tooling) by looking for an executable file on PATH.
 * It never runs the binary, never installs anything and never changes global configuration: a skill that wants a tool
 * only learns whether it exists, so the company degrades gracefully ("NOT RUN") instead of failing.
 */
export type ToolProbe={name:string;available:boolean;path?:string};

const SAFE_NAME=/^[A-Za-z0-9._-]+$/;

export async function probeBinaries(names:string[],pathEnv:string|undefined=process.env.PATH):Promise<ToolProbe[]>{
 const dirs=(pathEnv??"").split(delimiter).filter(Boolean);
 return Promise.all([...new Set(names)].sort().map(async name=>{
  if(!SAFE_NAME.test(name))return {name,available:false};
  for(const dir of dirs){
   const candidate=join(dir,name);
   try{await access(candidate,constants.X_OK);return {name,available:true,path:candidate};}catch{/* next directory */}
  }
  return {name,available:false};
 }));
}

/** Install hints are advice only; nothing here is ever executed. */
export const INSTALL_HINTS:Record<string,string>={
 gitleaks:"brew install gitleaks",semgrep:"brew install semgrep (or pipx install semgrep)",trufflehog:"brew install trufflehog",
 trivy:"brew install trivy",grype:"brew install grype","playwright-cli":"npm install -g @playwright/cli (pin a version)",opengrep:"see https://github.com/opengrep/opengrep"
};
