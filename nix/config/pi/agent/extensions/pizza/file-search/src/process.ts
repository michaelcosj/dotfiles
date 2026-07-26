import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { CapturedOutput } from "./output.ts";

const STDERR_MAX_BYTES = 64 * 1024;
interface PreviewState { decoder:TextDecoder; preview:string; totalBytes:number; lineBreaks:number; trailingLineBreaks:number; truncated:boolean }
function makePreviewState():PreviewState{return{decoder:new TextDecoder(),preview:"",totalBytes:0,lineBreaks:0,trailingLineBreaks:0,truncated:false}}
function observe(state:PreviewState,chunk:Buffer){state.totalBytes+=chunk.byteLength;for(const byte of chunk){if(byte===10){state.lineBreaks++;state.trailingLineBreaks++}else state.trailingLineBreaks=0}if(state.truncated)return;state.preview+=state.decoder.decode(chunk,{stream:true});const cut=truncateHead(state.preview,{maxLines:DEFAULT_MAX_LINES,maxBytes:DEFAULT_MAX_BYTES});if(cut.truncated){state.preview=cut.content;state.truncated=true}}
function finish(state:PreviewState,path:string):CapturedOutput{if(!state.truncated)state.preview+=state.decoder.decode();const bytes=state.totalBytes-state.trailingLineBreaks;return{preview:state.preview,lineCount:bytes===0?0:state.lineBreaks-state.trailingLineBreaks+1,totalBytes:bytes,truncated:state.truncated,fullOutputPath:state.truncated?path:undefined}}
export async function executeSearchProcess(options:{command:string;args:readonly string[];cwd:string;tempPrefix:string;signal?:AbortSignal}){
 const directory=await mkdtemp(join(tmpdir(),options.tempPrefix));const path=join(directory,"output.txt");let retain=false;
 try{return await new Promise<{code:number;stderr:string;output:CapturedOutput}>((resolve,reject)=>{const child=spawn(options.command,[...options.args],{cwd:options.cwd,stdio:["ignore","pipe","pipe"],signal:options.signal});const state=makePreviewState();const file=createWriteStream(path);const stderr:Buffer[]=[];let stderrBytes=0;child.stdout.on("data",(chunk:Buffer)=>{observe(state,chunk);file.write(chunk)});child.stderr.on("data",(chunk:Buffer)=>{if(stderrBytes<STDERR_MAX_BYTES){const part=chunk.subarray(0,STDERR_MAX_BYTES-stderrBytes);stderr.push(part);stderrBytes+=part.length}});child.once("error",reject);child.once("close",code=>file.end(()=>{const output=finish(state,path);retain=output.truncated;resolve({code:code??-1,stderr:Buffer.concat(stderr).toString("utf8"),output})}))})}finally{if(!retain)await rm(directory,{recursive:true,force:true})}
}
export async function discardCapturedOutput(output:CapturedOutput){if(output.fullOutputPath)await rm(dirname(output.fullOutputPath),{recursive:true,force:true})}
