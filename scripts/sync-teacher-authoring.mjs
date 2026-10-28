// One implementation for mobile and the independently built admin repository.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const target=process.argv[2];if(!target)throw new Error('Usage: node scripts/sync-teacher-authoring.mjs /path/to/xiangqi-admin-private [--check]');
for(const name of ['authoringDomain.ts','AuthoringBoard.tsx','TeacherAuthoring.tsx','authoring.css']){
 const source=await readFile(new URL('../apps/endgame-training/src/'+name,import.meta.url));
 const destination=resolve(target,'apps/admin-web/src',name);
 if(process.argv.includes('--check')){if(!source.equals(await readFile(destination)))throw new Error('Authoring mirror differs: '+name)}else await writeFile(destination,source);
}
