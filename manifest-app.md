# Manifest — costruzione Utraya.app (pubblica, da source in sola lettura)

Data: 2026-09-20

Source (sola lettura, mai modificata):
`C:\Users\darde\OneDrive\Progetti\ContentFlixRoot\ContentFlix\app\`
+ `C:\Users\darde\OneDrive\Progetti\ContentFlixRoot\ContentFlix\.github\`

Target (solo creazioni/scritture qui):
`C:\Users\darde\OneDrive\Progetti\Utraya.app\` (progetto a root)

## File copiati

- Da `app\*` a root `Utraya.app\`: 166 file (stessi nomi e struttura relativa).
- Da `.github\`: 5 file (`dependabot.yml` + `workflows/ci.yml`,
  `workflows/security.yml`, `workflows/secret-scan.yml`,
  `workflows/dependency-review.yml`).
- Totale copiati: 171.
- File nuovi/creati nel target: `.gitignore` (sovrascritto, vedi dubbi),
  `README.md`, `AGENTS.md`, `SECURITY.md` (+ questo `manifest-app.md`).
- Totale file nel target a fine lavoro (incluso manifest): 175.

## File esclusi (29) con motivo

- `.env.vercel.local` — segreto locale, vietato copiarlo.
- `.env.prod.temp` — segreto locale, vietato copiarlo.
- `.vercel/project.json`, `.vercel/README.txt` — stato locale Vercel, escluso.
- `supabase/.temp/*` (9 file) — cache/stato CLI Supabase locale, esclusa.
- `supabase/_old migration/*` (10 file) — vecchie migrazioni, escluse.
- `supabase/.2026-05-01-Avvisi.txt` — nota locale, esclusa.
- `tsconfig.tsbuildinfo` — artefatto build, escluso.
- `next-env.d.ts` — generato da Next, escluso.
- `Dockerfile` — non più pubblicato nel repo pubblico, escluso.
- `.dockerignore` — legato al Dockerfile, escluso.
- `scripts/generate-admin-password-hash.mjs` — tool con segreti, escluso.

## Adattamenti workflow (.github, solo nel target)

- `dependabot.yml`: directory npm `/app` → `/`; eliminato intero blocco `docker`;
  riscritto header (progetto alla root, niente Dockerfile).
- `workflows/ci.yml`: rimosso `defaults.run.working-directory: app`;
  `cache-dependency-path: app/package-lock.json` → `package-lock.json`;
  header `app/package.json` → `package.json (progetto alla root)`.
- `workflows/security.yml`: header `ContentFlix` → `utraya-app`, struttura
  root (niente `app/`, niente Dockerfile), 4 controlli (tolto config Dockerfile);
  job `npm-audit`: tolto `working-directory: app`, cache-path → `package-lock.json`,
  artifact path → `npm-audit-report.json`; job `semgrep`: tolto `cd app`,
  scansione root, output `semgrep-results.sarif` (era `../...`);
  `trivy-fs` scan-ref `'app'` → `'.'`; eliminato job `trivy-config` + rimosso
  da `needs[]` e dal riepilogo; rinumerati commenti JOB 4/5.
- `workflows/secret-scan.yml`: solo commento `non solo app/` →
  `(root inclusa, progetto alla root)`, resto invariato.
- `workflows/dependency-review.yml`: invariato (nessun riferimento `app/`).
- Nessun altro `ContentFlix` nei workflow: solo header security.yml toccato.

## Pulizie brand (solo queste, nient'altro)

- `src/app/(admin)/admin/users/page.tsx`: `app/supabase/migrations` →
  `supabase/migrations`.
- `src/app/api/auth/callback/route.test.ts`: `https://app.contentflix.test` →
  `https://app.utraya.test` (12 occorrenze).

## File nuovi

- `.gitignore`: contenuto minimale richiesto (node_modules, .pnp*, .next, out,
  build, .vercel, .env/.env.* con eccezioni example, log, tsbuildinfo,
  next-env.d.ts, .DS_Store, Thumbs.db, pem/key).
- `.env.example`: copia invariata (solo placeholder, nessun valore).
- `README.md`: pubblico minimale italiano (prodotto, trasparenza, agente AI,
  issue su utraya-doc, preprod/main, niente segreti/Vercel).
- `AGENTS.md`: stesse regole in forma istruzioni.
- `SECURITY.md`: titolo Utraya, reporting via private vulnerability reporting
  su `dardevlowcode-git/utraya-app`, branch main/preprod supportati.

## Dubbi residui

1. `.gitignore` della source (63 righe, con sezioni editor/codex) è stato
   sovrascritto dal minimale richiesto: voluto, ma comporta perdita di voci
   come `.vscode/`, `.idea/`, `.codex/`, `.venv/`, `*.p12/.pfx/.crt`.
2. `.env.example` era sia "copiato" sia "file nuovo": identico, nessun conflitto.
3. `src/app/(private)/traker/page.tsx` (refuso `traker`) lasciato invariato come
   richiesto ("solo queste, nient'altro").
4. Nessun `git init` / commit eseguito come richiesto.
