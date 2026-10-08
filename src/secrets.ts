// Secret hygiene: redact credential-shaped strings before anything is persisted,
// and keep credentials out of the environment of agent-authored code.

const TOKEN_PATTERNS=[
 /sk-ant-[A-Za-z0-9_-]{10,}/g,
 /sk-or-[A-Za-z0-9_-]{10,}/g,
 /sk-[A-Za-z0-9]{20,}/g,
 /AKIA[0-9A-Z]{16}/g,
 /gh[pousr]_[A-Za-z0-9]{30,}/g,
 /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
 /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g
];
const SECRET_ENV_NAME=/(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
const MIN_REGISTERED_LENGTH=6;

const registered=new Set<string>();

/** Remember a live credential value so it is masked wherever it appears. */
export function registerSecret(value:string|undefined){
 if(value&&value.length>=MIN_REGISTERED_LENGTH)registered.add(value);
}
export function clearRegisteredSecrets(){registered.clear();}

export function redact(text:string):string{
 let out=text;
 for(const secret of registered)out=out.split(secret).join("[REDACTED]");
 for(const pattern of TOKEN_PATTERNS)out=out.replace(pattern,"[REDACTED]");
 return out;
}
export function containsSecret(text:string):boolean{
 for(const secret of registered)if(text.includes(secret))return true;
 return TOKEN_PATTERNS.some(pattern=>{pattern.lastIndex=0;const hit=pattern.test(text);pattern.lastIndex=0;return hit;});
}
export function redactError(error:unknown):string{return redact(error instanceof Error?error.message:String(error));}

/** Environment for deterministic checks: agent-written code must not see provider credentials. */
export function sanitizedEnv(env:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv{
 const out:NodeJS.ProcessEnv={};
 for(const [name,value] of Object.entries(env)){
  if(SECRET_ENV_NAME.test(name)||(value!=null&&registered.has(value)))continue;
  out[name]=value;
 }
 return out;
}
