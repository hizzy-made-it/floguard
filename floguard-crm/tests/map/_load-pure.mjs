// Loads public/crm/js/19a-map-pure.js (a classic browser script) in a node:vm context and returns
// its two globals. No DOM is provided on purpose: the file must not touch it at load time.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PURE_FILE = path.resolve(here, '../../public/crm/js/19a-map-pure.js');

export function loadPure() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(PURE_FILE, 'utf8'), ctx, { filename: PURE_FILE });
  return { FSI_SCORE: ctx.FSI_SCORE, P: ctx.FSI_PURE };
}
