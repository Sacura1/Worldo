import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
const exitCode=Number(process.argv[2]||1);
let report;
try{report=JSON.parse(await readFile('qa-report.json','utf8'));}catch{report={errors:[{message:'The browser runner did not produce a JSON report.'}]};}
const tests=[];
function visit(suites){for(const suite of suites||[]){for(const spec of suite.specs||[])for(const test of spec.tests||[])tests.push({title:spec.title,project:test.projectName,status:test.status,results:test.results?.map(r=>({status:r.status,duration:r.duration,error:r.error?.message?.slice(0,5000)}))});visit(suite.suites);}}
visit(report.suites);
console.log(`WORLDO_QA_REPORT:${JSON.stringify({exitCode,stats:report.stats,errors:report.errors,tests})}`);
const files=[];
async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){const file=path.join(folder,entry.name);if(entry.isDirectory())await walk(file);else if(/\.(png|jpe?g)$/i.test(entry.name))files.push(file);}}
await walk('test-results');
// Compact tour images come first, so one large failure PNG cannot consume the
// entire artifact allowance before the desktop and portrait views are emitted.
files.sort((a,b)=>Number(/\.png$/i.test(a))-Number(/\.png$/i.test(b))||a.localeCompare(b));
let emitted=0,encodedBytes=0;
for(const file of files){
 const info=await stat(file);if(info.size>1024*1024||emitted>=10)continue;
 const base64=(await readFile(file)).toString('base64');if(encodedBytes+base64.length>2*1024*1024)continue;
 const name=path.relative('test-results',file).replace(/[^a-zA-Z0-9_.-]/g,'_'),total=Math.ceil(base64.length/32768);
 console.log(`WORLDO_QA_ARTIFACT:${JSON.stringify({name,mimeType:/\.png$/i.test(file)?'image/png':'image/jpeg',parts:total,bytes:info.size})}`);
 for(let index=0;index<total;index++){
  console.log(`WORLDO_QA_ARTIFACT_PART:${JSON.stringify({name,index,total,data:base64.slice(index*32768,(index+1)*32768)})}`);
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 encodedBytes+=base64.length;emitted++;
}
