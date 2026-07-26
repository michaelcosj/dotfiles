import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { buildFdArgs, buildRgArgs, FD_MAX_DEPTH_LIMIT, FD_MAX_LIMIT, RG_MAX_CONTEXT, RG_MAX_COUNT_LIMIT } from "./src/args.ts";
import { currentTarget, liveBinaryEnv, repositoryBinDir, resolveBinary, TOOL_SPECS, type BinaryEnv, type BinarySource, type PlatformTarget, type ResolvedBinary } from "./src/binaries.ts";
import { formatCapturedOutput, type CapturedOutput } from "./src/output.ts";
import { FD_PARAMETER_DESCRIPTIONS, FD_PROMPT_GUIDELINES, FD_PROMPT_SNIPPET, FD_TOOL_DESCRIPTION, RG_PARAMETER_DESCRIPTIONS, RG_PROMPT_GUIDELINES, RG_PROMPT_SNIPPET, RG_TOOL_DESCRIPTION } from "./src/prompt.ts";
import { discardCapturedOutput, executeSearchProcess } from "./src/process.ts";

export function makeBinaryInitializers(binDir:string,target:PlatformTarget,env:BinaryEnv){return{fd:resolveBinary(TOOL_SPECS.fd,binDir,target,env),rg:resolveBinary(TOOL_SPECS.rg,binDir,target,env)}}
export function installNotifications(binaries:readonly ResolvedBinary[]){return binaries.filter(b=>b.source==="installed").map(b=>`file-search: no system ${b.tool} found — downloaded ${b.tool} ${b.version??""}`.trimEnd()+` to ${repositoryBinDir()}`)}
interface SearchOutcome{output:CapturedOutput;noMatches:boolean;binarySource:BinarySource}
export interface FdToolDetails{binarySource:BinarySource;matchCount:number;truncated:boolean;fullOutputPath?:string}
export interface RgToolDetails{binarySource:BinarySource;outputLines:number;truncated:boolean;fullOutputPath?:string}
function message(error:unknown){return error instanceof Error?error.message:String(error)}
export function registerFileSearchExtension(pi:ExtensionAPI){
 let notified=false;const initializers=makeBinaryInitializers(repositoryBinDir(),currentTarget(),liveBinaryEnv);
 pi.on("session_start",async(_event,ctx)=>{const settled=await Promise.allSettled([initializers.fd,initializers.rg]);if(!ctx.hasUI||notified)return;notified=true;(["fd","rg"] as const).forEach((tool,i)=>{const result=settled[i]!;if(result.status==="fulfilled")for(const notice of installNotifications([result.value]))ctx.ui.notify(notice,"info");else ctx.ui.notify(`file-search ${tool} setup failed: ${message(result.reason)}`,"error")})});
 async function runSearch(tool:"fd"|"rg",args:string[],ctx:ExtensionContext,signal?:AbortSignal):Promise<SearchOutcome>{const binary=await initializers[tool];const timeout=AbortSignal.timeout(60_000);const combined=signal?AbortSignal.any([signal,timeout]):timeout;let result;try{result=await executeSearchProcess({command:binary.command,args,cwd:ctx.cwd,tempPrefix:`pi-${tool}-`,signal:combined})}catch(error){if(combined.aborted)throw new Error(signal?.aborted?`${tool} search was cancelled.`:`${tool} timed out.`);throw error}if(tool==="rg"&&result.code===1&&result.output.lineCount===0)return{output:result.output,noMatches:true,binarySource:binary.source};if(result.code!==0){await discardCapturedOutput(result.output);throw new Error(`${tool} failed: ${result.stderr.trim()||`exit code ${result.code}`}`)}return{output:result.output,noMatches:result.output.lineCount===0,binarySource:binary.source}}
 pi.registerTool<ReturnType<typeof fdParameters>,FdToolDetails>({name:"fd",label:"Find Files",description:FD_TOOL_DESCRIPTION,promptSnippet:FD_PROMPT_SNIPPET,promptGuidelines:FD_PROMPT_GUIDELINES,parameters:fdParameters(),async execute(_id,params,signal,_update,ctx){const out=await runSearch("fd",buildFdArgs(params),ctx,signal);if(out.noMatches)return{content:[{type:"text",text:"No files found"}],details:{binarySource:out.binarySource,matchCount:0,truncated:false}};const f=formatCapturedOutput(out.output);return{content:[{type:"text",text:f.text}],details:{binarySource:out.binarySource,matchCount:f.lineCount,truncated:f.truncated,fullOutputPath:f.fullOutputPath}}},renderCall(args,theme){let text=theme.fg("toolTitle",theme.bold("fd "))+theme.fg("accent",args.pattern?`"${args.pattern}"`:"(all)");if(args.path)text+=theme.fg("muted",` in ${args.path}`);return new Text(text,0,0)},renderResult(result,{expanded,isPartial},theme){if(isPartial)return new Text(theme.fg("warning","Searching..."),0,0);const d=result.details;if(!d||d.matchCount===0)return new Text(theme.fg("dim","No files found"),0,0);let text=theme.fg("success",`${d.matchCount} ${d.matchCount===1?"entry":"entries"}`);if(d.truncated)text+=theme.fg("warning"," (truncated)");if(expanded)text+=expandedPreview(result,d.fullOutputPath,theme);return new Text(text,0,0)}});
 pi.registerTool<ReturnType<typeof rgParameters>,RgToolDetails>({name:"rg",label:"Search Content",description:RG_TOOL_DESCRIPTION,promptSnippet:RG_PROMPT_SNIPPET,promptGuidelines:RG_PROMPT_GUIDELINES,parameters:rgParameters(),async execute(_id,params,signal,_update,ctx){const out=await runSearch("rg",buildRgArgs(params),ctx,signal);if(out.noMatches)return{content:[{type:"text",text:"No matches found"}],details:{binarySource:out.binarySource,outputLines:0,truncated:false}};const f=formatCapturedOutput(out.output);return{content:[{type:"text",text:f.text}],details:{binarySource:out.binarySource,outputLines:f.lineCount,truncated:f.truncated,fullOutputPath:f.fullOutputPath}}},renderCall(args,theme){let text=theme.fg("toolTitle",theme.bold("rg "))+theme.fg("accent",`"${args.pattern}"`);if(args.path)text+=theme.fg("muted",` in ${args.path}`);return new Text(text,0,0)},renderResult(result,{expanded,isPartial},theme){if(isPartial)return new Text(theme.fg("warning","Searching..."),0,0);const d=result.details;if(!d||d.outputLines===0)return new Text(theme.fg("dim","No matches found"),0,0);let text=theme.fg("success",`${d.outputLines} output ${d.outputLines===1?"line":"lines"}`);if(d.truncated)text+=theme.fg("warning"," (truncated)");if(expanded)text+=expandedPreview(result,d.fullOutputPath,theme);return new Text(text,0,0)}})
}

const PREVIEW_LINES = 20;

interface ThemeLike {
  fg(color: string, text: string): string;
}

function expandedPreview(
  result: { content: { type: string; text?: string }[] },
  fullOutputPath: string | undefined,
  theme: ThemeLike,
) {
  let text = "";
  const content = result.content[0];
  if (content?.type === "text" && content.text) {
    const lines = content.text.split("\n");
    for (const line of lines.slice(0, PREVIEW_LINES)) {
      text += `\n${theme.fg("dim", line)}`;
    }
    if (lines.length > PREVIEW_LINES) {
      text += `\n${theme.fg("muted", `... ${lines.length - PREVIEW_LINES} more lines`)}`;
    }
  }
  if (fullOutputPath) {
    text += `\n${theme.fg("dim", `Full output: ${fullOutputPath}`)}`;
  }
  return text;
}

function fdParameters() {
  return Type.Object({
    pattern: Type.Optional(
      Type.String({ description: FD_PARAMETER_DESCRIPTIONS.pattern }),
    ),
    path: Type.Optional(
      Type.String({ description: FD_PARAMETER_DESCRIPTIONS.path }),
    ),
    type: Type.Optional(
      StringEnum(["file", "directory", "symlink"] as const, {
        description: FD_PARAMETER_DESCRIPTIONS.type,
      }),
    ),
    extension: Type.Optional(
      Type.String({ description: FD_PARAMETER_DESCRIPTIONS.extension }),
    ),
    glob: Type.Optional(
      Type.Boolean({ description: FD_PARAMETER_DESCRIPTIONS.glob }),
    ),
    hidden: Type.Optional(
      Type.Boolean({ description: FD_PARAMETER_DESCRIPTIONS.hidden }),
    ),
    max_depth: Type.Optional(
      Type.Integer({
        description: FD_PARAMETER_DESCRIPTIONS.max_depth,
        minimum: 1,
        maximum: FD_MAX_DEPTH_LIMIT,
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        description: FD_PARAMETER_DESCRIPTIONS.limit,
        minimum: 1,
        maximum: FD_MAX_LIMIT,
      }),
    ),
  });
}

function rgParameters() {
  return Type.Object({
    pattern: Type.String({ description: RG_PARAMETER_DESCRIPTIONS.pattern }),
    path: Type.Optional(
      Type.String({ description: RG_PARAMETER_DESCRIPTIONS.path }),
    ),
    glob: Type.Optional(
      Type.String({ description: RG_PARAMETER_DESCRIPTIONS.glob }),
    ),
    file_type: Type.Optional(
      Type.String({ description: RG_PARAMETER_DESCRIPTIONS.file_type }),
    ),
    case_sensitive: Type.Optional(
      Type.Boolean({ description: RG_PARAMETER_DESCRIPTIONS.case_sensitive }),
    ),
    fixed_strings: Type.Optional(
      Type.Boolean({ description: RG_PARAMETER_DESCRIPTIONS.fixed_strings }),
    ),
    hidden: Type.Optional(
      Type.Boolean({ description: RG_PARAMETER_DESCRIPTIONS.hidden }),
    ),
    context: Type.Optional(
      Type.Integer({
        description: RG_PARAMETER_DESCRIPTIONS.context,
        minimum: 0,
        maximum: RG_MAX_CONTEXT,
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        description: RG_PARAMETER_DESCRIPTIONS.limit,
        minimum: 1,
        maximum: RG_MAX_COUNT_LIMIT,
      }),
    ),
  });
}
