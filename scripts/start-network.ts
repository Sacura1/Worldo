import {readFile} from 'node:fs/promises';
import {networkProfileEnvironment} from '../server/environment-profile';

const network=process.argv[2];
if(network!=='testnet'&&network!=='mainnet')throw new Error('Choose the testnet or mainnet profile.');
const file=`.env.${network}`;
let contents:string;
try{contents=await readFile(file,'utf8');}
catch{throw new Error(`Create ${file} from config/${network}.env.example before starting this network.`);}
const env=networkProfileEnvironment(contents,network);
for(const name of Object.keys(process.env))delete process.env[name];
Object.assign(process.env,env);
console.log(`Starting Worldo on NEAR ${network} using ${file}.`);
// The environment is resolved before modules initialize database or provider clients.
const entry='./start.mjs';
await import(entry);
