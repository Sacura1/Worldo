import {mkdir,chown} from 'node:fs/promises';
import path from 'node:path';

// A Fly volume hides the image's /data ownership. Prepare only the configured
// game directory, then drop privileges before loading the application.
if(process.getuid?.()===0){
 const directory=path.resolve(process.env.LOCAL_DATA_DIR??'/data/worlds');
 if(directory!=='/data/worlds')throw new Error('The container data directory must be /data/worlds.');
 await mkdir(directory,{recursive:true});
 await chown(directory,1000,1000);
 process.setgroups([]);
 process.setgid(1000);
 process.setuid(1000);
}
await import('./start.mjs');
