/**
 * Copy enablement files from Sales Docs/ → public/crm/docs/
 * and write catalog.json for the Documents panel + coach_knowledge.json for the AI Coach.
 *
 * Run: npm run sync-docs   (from floguard-crm/)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'Sales Docs');
const destDir = path.join(root, 'public', 'crm', 'docs');
const HREF_PREFIX = '/crm/docs/';

/** @type {{ file: string, title: string, category: string, description: string }[]} */
const MANIFEST = [
  {
    file: 'FloGuard_Drainage_Sales_Playbook.md',
    title: 'Drainage Sales Playbook',
    category: 'Playbook',
    description: 'The consultative cold-selling system: ROI reframe, triggers, assumptive close, real urgency, category discipline.',
  },
  {
    file: 'FloGuard_Pricing_and_Offers.md',
    title: 'Pricing & Offers (SSOT)',
    category: 'Pricing',
    description: 'The single source of truth for what reps may quote — the $4,500–$12,000 band, proof points, and the never-quote list.',
  },
  {
    file: 'FloGuard_Call_Scripts.md',
    title: 'Call Scripts',
    category: 'Scripts',
    description: 'First-call openers, sump/maintenance/B2B variants, voicemail, follow-up text, and the never-say list.',
  },
  {
    file: 'FloGuard_Objection_Encyclopedia.md',
    title: 'Objection Encyclopedia',
    category: 'Scripts',
    description: 'Validate → reframe → proof → assessment close, for every objection from "just regrade it" to the B2B approval chain.',
  },
  {
    file: 'FloGuard_System_Explainer.md',
    title: 'How the System Works',
    category: 'Product',
    description: 'Florida water physics, the five-step water path, what the system does and does NOT protect against, install story.',
  },
  {
    file: 'FloGuard_Quiz_Lead_Reading_Guide.md',
    title: 'Quiz Lead Reading Guide',
    category: 'Leads',
    description: 'How to read floguardfl.com quiz submissions as pre-done discovery and dial with speed.',
  },
  {
    file: 'DRAINAGE-NEED-SCORE.md',
    title: 'Drainage Need Score (DNS)',
    category: 'Leads',
    description: '0–100 sales-urgency score: wire format, scoring model, grades/bands, talk-track generation.',
  },
];

const trainingDir = path.join(srcDir, 'training');
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const TRAINING_EXTS = new Set([
  '.mp4', '.webm', '.mov', '.m4a', '.mp3', '.wav', '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

function copyFileSafe(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function titleFromFilename(name) {
  return path
    .basename(name, path.extname(name))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pushItem(items, { destName, title, category, description, type, stat }) {
  items.push({
    id: destName.replace(/\W+/g, '_').toLowerCase(),
    title,
    category,
    description,
    file: destName,
    href: `${HREF_PREFIX}${destName.replace(/\\/g, '/')}`,
    type,
    bytes: stat.size,
    updated_at: stat.mtime.toISOString(),
  });
}

/** Recursively collect training media under Sales Docs/training/ */
function collectTrainingAssets(dir, relBase = '') {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    if (ent.name.toLowerCase() === 'readme.md') continue;
    const abs = path.join(dir, ent.name);
    const rel = relBase ? path.join(relBase, ent.name) : ent.name;
    if (ent.isDirectory()) {
      out.push(...collectTrainingAssets(abs, rel));
    } else if (TRAINING_EXTS.has(path.extname(ent.name).toLowerCase())) {
      out.push({ abs, rel });
    }
  }
  return out;
}

function trainingDescription(ext) {
  if (VIDEO_EXTS.has(`.${ext}`) || ['mp4', 'webm', 'mov'].includes(ext)) {
    return 'Sales training video — watch or download.';
  }
  if (['m4a', 'mp3', 'wav'].includes(ext)) return 'Sales training audio — play or download.';
  if (ext === 'pdf') return 'Sales training PDF — open or download.';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
    return 'Sales training visual — open or download.';
  }
  return 'Sales training asset — open or download.';
}

function main() {
  ensureDir(destDir);
  ensureDir(path.join(destDir, 'training'));
  const items = [];
  let copied = 0;
  let missing = 0;

  for (const entry of MANIFEST) {
    const from = path.join(srcDir, entry.file);
    if (!fs.existsSync(from)) {
      console.warn('MISSING', entry.file);
      missing += 1;
      continue;
    }
    const base = path.basename(entry.file);
    const destName = base.replace(/\s+/g, '_');
    const to = path.join(destDir, destName);
    copyFileSafe(from, to);
    const stat = fs.statSync(to);
    const ext = path.extname(destName).toLowerCase().replace('.', '') || 'file';
    pushItem(items, {
      destName,
      title: entry.title,
      category: entry.category,
      description: entry.description,
      type: ext,
      stat,
    });
    copied += 1;
    console.log('OK', destName);
  }

  // Training assets: Sales Docs/training/** → public/crm/docs/training/
  const trainingAssets = collectTrainingAssets(trainingDir);
  for (const v of trainingAssets) {
    const safeRel = v.rel.replace(/\s+/g, '_').replace(/\\/g, '/');
    const destName = path.join('training', safeRel).replace(/\\/g, '/');
    const to = path.join(destDir, destName);
    copyFileSafe(v.abs, to);
    const stat = fs.statSync(to);
    const ext = path.extname(v.rel).toLowerCase().replace('.', '') || 'file';
    pushItem(items, {
      destName,
      title: titleFromFilename(path.basename(v.rel)),
      category: 'Training',
      description: trainingDescription(ext),
      type: ext === 'mov' ? 'mp4' : ext,
      stat,
    });
    copied += 1;
    console.log('OK training', destName);
  }

  if (!trainingAssets.length) {
    console.log('No training assets yet (drop .mp4/.pdf/.m4a into Sales Docs/training/)');
  }

  // AI coach knowledge pack (not listed in Documents UI — loaded by Coach runtime)
  const coachSrc = path.join(srcDir, 'intelligence', 'coach_knowledge.json');
  if (fs.existsSync(coachSrc)) {
    const coachDest = path.join(destDir, 'coach_knowledge.json');
    copyFileSafe(coachSrc, coachDest);
    console.log('OK coach_knowledge.json (AI Sales Coach pack)');
    copied += 1;
  } else {
    console.warn('MISSING intelligence/coach_knowledge.json');
    missing += 1;
  }

  const catalog = {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    source: 'Sales Docs/ + Sales Docs/training/',
    note: 'Synced for all authenticated FLOGUARD SALES REV users. Run npm run sync-docs after adding files.',
    categories: [...new Set(items.map((i) => i.category))],
    documents: items,
  };

  fs.writeFileSync(path.join(destDir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(destDir, 'README.md'),
    `# FloGuard sales library\n\nSynced from \`Sales Docs/\` (docs) and \`Sales Docs/training/\` (videos, audio, PDFs, images) via \`npm run sync-docs\`.\n\nDo not edit files here by hand — edit Sales Docs and re-sync.\n`,
    'utf8',
  );

  console.log(`\nCopied ${copied} files (${missing} missing) → public/crm/docs/`);
  console.log(`catalog.json: ${items.length} documents (${trainingAssets.length} training assets)`);
}

main();
