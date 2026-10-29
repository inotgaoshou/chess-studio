#!/usr/bin/env node
// Verify the page actually loaded by Capacitor, not a matching orphaned asset.
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, relative, join} from 'node:path';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2);
function option(name) { const i=args.indexOf(name); return i<0 ? undefined : args[i+1]; }
const app=option('--app'), expected=option('--expected-web');
assert(app && expected,'Usage: verify-ios-web-bundle.mjs --app App.app --expected-web fresh-dist [--expect-js text] [--expect-css text]');
const root=resolve(app,'public'), web=resolve(expected);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(directory,prefix='') {
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const name=join(prefix,entry.name);
    if(entry.isDirectory())result.push(...await files(join(directory,entry.name),name));
    else if(entry.isFile())result.push(name);
  }
  return result.sort();
}
const html=await readFile(join(root,'index.html'),'utf8');
assert.equal(html,await readFile(join(web,'index.html'),'utf8'),'Packaged index.html differs from the isolated web build');
const expectedAssets=await files(join(web,'assets'));
assert.deepEqual(await files(join(root,'assets')),expectedAssets,'Packaged assets contain missing or stale files');
for(const name of await files(web)) {
  assert.equal(digest(await readFile(join(root,name))),digest(await readFile(join(web,name))),`Packaged web file differs: ${name}`);
}
const references=[...html.matchAll(/<(script|link)\b[^>]*\b(?:src|href)="([^"#]+)"/g)].map(([,tag,url])=>({tag,url}));
let js='',css='';
for(const {tag,url} of references) {
  assert(!/^(?:[a-z]+:|\/\/)/i.test(url),'Native entry must load bundled assets');
  const path=resolve(root,url.split(/[?#]/,1)[0]);
  assert(!relative(root,path).startsWith('..'),'Entry asset escapes public directory');
  const source=await readFile(path,'utf8');
  if(tag==='script')js+=source;
  if(tag==='link'&&url.endsWith('.css'))css+=source;
}
if(option('--expect-js'))assert(js.includes(option('--expect-js')),'Active entry JavaScript lacks expected feature');
if(option('--expect-css'))assert(css.includes(option('--expect-css')),'Active entry stylesheet lacks expected rule');
console.log(JSON.stringify({verified:true,entryAssets:references.map(r=>r.url),assetFiles:expectedAssets.length,indexSha256:digest(html)}));
