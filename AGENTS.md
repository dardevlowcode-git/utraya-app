# AGENTS.md — Utraya (utraya.com)

Repository pubblico del codice di Utraya, pubblicato per trasparenza.

- Non modificare questi file a mano: ogni modifica è applicata solo dall'agente AI.
- Non committare mai segreti: le variabili d'ambiente stanno negli ambienti
  segregati e `.env.example` contiene solo nomi/placeholder. I valori non vanno
  in chat, Git o log; provisioning e accesso DEV seguono la deroga privata in
  Utraya.doc.
- Branch operativo predefinito per lo sviluppo agente: `dev` (Vercel e Supabase
  DEV isolati). Ogni task DEV autorizza continuativamente tutti i test e le
  operazioni tecniche necessarie, incluse mutazioni/reset DB, migrazioni, fixture,
  credenziali DEV e deployment, senza chiedere conferme per singola operazione.
  Per deployment protetti usare Vercel CLI autenticata (`vercel curl`); non
  disabilitare Deployment Protection né gestire bypass secret. Usare il percorso
  credenziali e le regole correnti di Utraya.doc.
- Se uno strumento o una capability DEV manca, diagnosticarlo, proseguire le
  verifiche indipendenti e segnalare solo il test specifico bloccato; non chiedere
  autorizzazioni e non spostare il lavoro su `preprod`/`main`. Ripristino e
  cleanup DEV sono facoltativi e non precondizioni per i test.
- `preprod` (`preview.utraya.com`) è una fase di promozione autorizzata per le
  verifiche manuali di Dario; i difetti tecnici tornano su `dev`. Lavorare
  direttamente su `preprod` solo se Dario lo chiede esplicitamente all'inizio
  del task.
- `main` (`utraya.com`) si aggiorna solo dopo accettazione manuale di preprod e
  autorizzazione esplicita di Dario; mai push diretto in assenza di un hotfix
  esplicitamente richiesto.
- Dettaglio del flusso e del provisioning: runbook privato Utraya.doc
  (`flusso-sviluppo.md`, `env-procedura.md`).
- Nel run DOC tracciare ogni modifica DEV a codice, Supabase e Vercel con esito,
  classificazione `DEV-only`/`promuovi` ed eventuale cleanup/rollback (se non
  eseguito, dichiararlo; non è un gate DEV). Prima della
  promozione consegnare a Dario l'elenco preciso delle migrazioni e dei delta
  Vercel per gli ambienti condivisi: gli script DB preprod/main li applica
  Dario, salvo autorizzazione specifica diversa. Non portare strumenti o
  artefatti temporanei DEV nel candidato pulito.
- Contributi umani solo via issue sul repository privato `utraya-doc`.
