import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'plate-exchanger-'));
try { const out=join(dir,'test.mjs'); await build({entryPoints:['scripts/verify-plate-exchanger.ts'],bundle:true,platform:'node',format:'esm',outfile:out,logLevel:'silent'}); await import(pathToFileURL(out).href); } finally { await rm(dir,{recursive:true,force:true}); }
