#!/usr/bin/env node
/**
 * Split-integrity check for public/crm.
 *
 * Verifies that concatenating the classic scripts referenced by public/crm/index.html
 * (in load order, ignoring vendor/) reproduces the inline <script> of index.html at a
 * given git ref byte-for-byte, and that public/crm/css/app.css equals the old inline <style>.
 *
 *   node tests/ui/check-split.mjs [ref]      (default ref: be167fd, the last single-file commit)
 *
 * This proves the mechanical split (step 1). After the redesign (step 2) the JS/CSS
 * legitimately differ, so run it against the split commit's tree: `git stash` or
 * `git worktree` at the split commit, or pass --at <commit> to read the split files from git.
 *   node tests/ui/check-split.mjs be167fd --at <split-commit>
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const crmRoot = path.resolve(here, '../..');
const args = process.argv.slice(2);
const ref = args[0] && !args[0].startsWith('--') ? args[0] : 'be167fd';
const atIdx = args.indexOf('--at');
const at = atIdx >= 0 ? args[atIdx + 1] : null;

const git = (...a) => execFileSync('git', a, { cwd: crmRoot, encoding: 'utf8', maxBuffer: 64 << 20 });
const repoRel = (p) => path.relative(git('rev-parse', '--show-toplevel').trim(), path.join(crmRoot, p)).split(path.sep).join('/');
const readAt = (p) => (at ? git('show', `${at}:${repoRel(p)}`) : fs.readFileSync(path.join(crmRoot, p), 'utf8'));

const oldHtml = git('show', `${ref}:${repoRel('public/crm/index.html')}`);
const oldJs = oldHtml.slice(oldHtml.indexOf('<script>\n') + '<script>'.length, oldHtml.lastIndexOf('</script>'));
const oldCss = oldHtml.slice(oldHtml.indexOf('<style>\n') + '<style>\n'.length, oldHtml.indexOf('</style>\n'));

const html = readAt('public/crm/index.html');
const srcs = [...html.matchAll(/<script src="(js\/[^"?]+)(?:\?v=[^"]*)?"><\/script>/g)].map((m) => m[1]);
if (!srcs.length) { console.error('no js/ script tags found'); process.exit(1); }
const joined = srcs.map((s) => readAt('public/crm/' + s)).join('');

let ok = true;
if (joined === oldJs) console.log(`JS  OK  ${srcs.length} files, ${joined.length} chars == inline script at ${ref}`);
else {
  ok = false;
  let i = 0; while (i < joined.length && joined[i] === oldJs[i]) i++;
  console.error(`JS  MISMATCH at char ${i}: ...${JSON.stringify(oldJs.slice(i, i + 60))} vs ${JSON.stringify(joined.slice(i, i + 60))}`);
}
let css = null;
try { css = readAt('public/crm/css/app.css'); } catch (e) { /* ignore */ }
if (css === oldCss) console.log(`CSS OK  css/app.css == inline style at ${ref}`);
else { ok = false; console.error('CSS MISMATCH (css/app.css differs from the inline <style>)'); }
process.exit(ok ? 0 : 1);
