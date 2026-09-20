# DPA — Catena del trattamento dati Utraya

> **Stato**: 🟡 bozza pre-launch — la versione "pubblica" (lista sub-processors da inserire nella Privacy Policy) deve essere validata legalmente (`tasks/SEC.md` PUBSEC-007).
> **Versione documento**: `2026-05-16-1`
> **Lingua sorgente**: italiano.
> **A cosa serve questo file**: documentare in modo unitario (a) il ruolo di Utraya nel GDPR, (b) i responsabili esterni del trattamento (sub-processors) con i rispettivi DPA, (c) i trasferimenti extra-UE e le relative garanzie, (d) il template DPA che Utraya offrirà ai clienti business quando aprirà la API.

---

## 1. Ruoli GDPR

| Soggetto | Ruolo | Riferimento normativo |
|---|---|---|
| `[NOMINATIVO TITOLARE]` (gestore di Utraya) | **Titolare del trattamento** dei dati degli utenti finali del servizio Utraya | GDPR art. 4 n. 7 |
| Supabase Inc. | **Responsabile del trattamento** (sub-processor) per hosting database e auth | GDPR art. 4 n. 8 + art. 28 |
| Vercel Inc. | **Responsabile del trattamento** per hosting applicazione | GDPR art. 4 n. 8 + art. 28 |
| Google LLC / Google Cloud | **Responsabile del trattamento** per OAuth login e (se l'utente non fornisce chiave propria) per chiamate Gemini | GDPR art. 4 n. 8 + art. 28 |
| Utente finale di Utraya | **Interessato** | GDPR art. 4 n. 1 |
| **Utenti business** (futuro, post-apertura API) | **Titolare del trattamento** per i dati dei propri utenti finali; Utraya è loro **Responsabile** | GDPR art. 4 n. 7-8 |

## 2. Sub-processors attuali (per Utraya in qualità di Titolare)

Tutti i sub-processors sotto sono soggetti a contratto di nomina ex GDPR art. 28 par. 3 (DPA), accettato da Utraya al momento dell'attivazione del servizio.

### 2.1 Supabase Inc.

| Voce | Valore |
|---|---|
| Ragione sociale | Supabase, Inc. |
| Sede | 970 Toa Payoh North #07-04, Singapore 318992 |
| Ruolo | Responsabile esterno (hosting database PostgreSQL + auth + storage) |
| Dati trattati | Tutti i dati account utente (vedi `DATA_MODEL.md`) inclusi: email, Google sub, watchlist, riassunti video associati all'utente, chiavi API cifrate, registrazioni accettazione TOS |
| Hosting fisico dei dati | Regione **EU (Frankfurt o Ireland)** — selezionata in fase di setup progetto |
| Trasferimento extra-UE | I dati a riposo restano in UE. Eventuali operazioni di supporto (es. log applicativi tecnici) possono comportare accesso temporaneo da personale Supabase USA: coperto da SCC 2021/914/UE Modulo 3 |
| DPA pubblicamente disponibile | <https://supabase.com/legal/dpa> |
| Termini di servizio | <https://supabase.com/legal/terms> |
| Certificazioni | SOC 2 Type II, HIPAA, ISO 27001 (vedi <https://supabase.com/security>) |
| Sub-processor di Supabase | AWS Inc. (host fisico, regioni EU); vedi <https://supabase.com/legal/subprocessors> |

### 2.2 Vercel Inc.

| Voce | Valore |
|---|---|
| Ragione sociale | Vercel, Inc. |
| Sede | 340 S Lemon Ave #4133, Walnut, CA 91789, USA |
| Ruolo | Responsabile esterno (hosting applicazione frontend Next.js + serverless functions + edge network) |
| Dati trattati | Log tecnici di accesso (IP, user agent, URL), contenuti di pagina servita (nessun PII strutturato), eventuali payload di Server Action prima di essere salvati su Supabase |
| Hosting | CDN globale; serverless functions configurate per regione `fra1` (Frankfurt) di default — verificare `vercel.json` |
| Trasferimento extra-UE | Sì (USA, dove ha sede Vercel). Garanzie: SCC 2021/914/UE Modulo 2 + Data Privacy Framework (Vercel è certificata DPF dal 2023) |
| DPA pubblicamente disponibile | <https://vercel.com/legal/dpa> |
| Termini di servizio | <https://vercel.com/legal/terms> |
| Sub-processor di Vercel | AWS, Cloudflare; vedi <https://vercel.com/legal/subprocessors> |

### 2.3 Google LLC

Google compare in due ruoli distinti che è importante separare.

#### 2.3.1 Google Identity Services — login OAuth

| Voce | Valore |
|---|---|
| Ruolo | Responsabile esterno per l'autenticazione utente |
| Dati trasmessi | Scope OAuth `openid email profile`. Utraya riceve: email, Google `sub` (id univoco), nome visualizzato, immagine profilo, locale |
| Trasferimento | USA; SCC + Data Privacy Framework |
| DPA | <https://cloud.google.com/terms/data-processing-addendum> |

#### 2.3.2 YouTube Data API v3 — metadati video pubblici

| Voce | Valore |
|---|---|
| Ruolo | Fornitore di dati pubblici (NON è trattamento di dati personali dell'utente Utraya) |
| Dati scambiati | Solo metadati pubblici dei video (titolo, descrizione, thumbnail, ID canale). Nessun PII dell'utente Utraya è trasmesso a YouTube API |
| Note | Utraya rispetta i [YouTube API Services Terms of Service](https://developers.google.com/youtube/terms/api-services-terms-of-service). |

#### 2.3.3 Gemini API — generazione riassunti AI

Esistono **due modalità operative**, da disambiguare con cura:

**Modalità A — chiave API utente (BYOK, default)**

L'utente fornisce la propria chiave API Gemini, cifrata AES-GCM e custodita su Supabase (vedi `SECURITY.md §4`). Quando l'utente richiede un riassunto, la chiamata a Gemini è effettuata **con la chiave dell'utente**. In questo caso:

- Il rapporto contrattuale per i dati inviati a Gemini è **tra utente e Google**, non tra Utraya e Google.
- Utraya è **responsabile del trattamento solo della chiave** (custodia cifrata).
- Utraya NON sigla il DPA Google per i contenuti AI in questa modalità.

**Modalità B — chiave applicativa di Utraya (per allowlist beta gratuita, fallback)**

Utraya usa una propria chiave Gemini per servire gratis i primi utenti. In questo caso:

- Il rapporto è **tra Utraya e Google** ex GDPR art. 28.
- Si applica il DPA Google Cloud: <https://cloud.google.com/terms/data-processing-addendum>.
- Dati trasmessi a Gemini: URL del video YouTube + trascrizione/sottotitoli del video. **Nessun dato identificativo dell'utente Utraya** è incluso nei prompt.
- Politica di non-training: Utraya configura le richieste con `prompt_logging: false` per evitare che Google usi i prompt per addestramento (vedi <https://ai.google.dev/gemini-api/terms>).

## 3. Gestione delle modifiche ai sub-processors

Quando Utraya cambia un sub-processor (es. migrazione hosting, aggiunta nuovo provider AI), gli utenti vengono informati:

1. **Comunicazione preventiva** via email (almeno 30 giorni prima del cambio) per tutti gli utenti registrati.
2. **Aggiornamento** della sezione "Sub-processors" della Privacy Policy con bump della versione e dell'hash.
3. **Diritto di opposizione**: l'utente può richiedere la cancellazione dell'account (vedi `legal-tos.md §10`) senza penali se non è d'accordo con il nuovo sub-processor.

## 4. Trasferimenti extra-UE — garanzie applicate

Per i trasferimenti di dati personali fuori dall'Unione Europea, Utraya applica le seguenti garanzie ai sensi del Capo V GDPR:

| Garanzia | Quando si applica | Documento |
|---|---|---|
| Decisione di adeguatezza UE → USA (Data Privacy Framework, 10/07/2023) | Quando il sub-processor è certificato DPF (Vercel, Google) | <https://www.dataprivacyframework.gov> |
| Clausole Contrattuali Standard (SCC) 2021/914/UE | Sempre, anche in concorso con DPF (come "belt and suspenders") | Allegato al DPA del fornitore |
| Misure tecniche supplementari (cifratura at-rest, cifratura in transit TLS 1.3) | Sempre | `SECURITY.md §3` |

## 5. Registro dei trattamenti (estratto)

Estratto del registro ex GDPR art. 30. Versione interna completa: `tasks/SEC.md` PUBSEC-008 (da creare).

| Finalità | Base giuridica | Categorie dati | Destinatari | Retention |
|---|---|---|---|---|
| Autenticazione utente | Art. 6 par. 1 lett. b GDPR (esecuzione contratto) | Email, Google sub, locale | Supabase, Google | Per durata account + 30gg post-cancellazione |
| Erogazione servizio (watchlist, riassunti) | Art. 6 par. 1 lett. b GDPR | Watchlist, stato video, riassunti | Supabase, Google (Gemini in modalità B) | Per durata account |
| Custodia chiavi API utente | Art. 6 par. 1 lett. b GDPR | Chiave API cifrata AES-GCM | Supabase (cifrato) | Per durata account |
| Comunicazioni di servizio | Art. 6 par. 1 lett. b GDPR | Email | Supabase, provider email (TBD) | Per durata account |
| Provabilità accettazione TOS | Art. 6 par. 1 lett. f GDPR (legittimo interesse — difesa giudiziale) | Email, IP, user agent, hash, timestamp | Supabase | **10 anni** (termine prescrizione ordinaria) — sopravvive alla cancellazione account previa anonimizzazione |
| Sicurezza e prevenzione abusi | Art. 6 par. 1 lett. f GDPR | Log accessi, IP | Supabase, Vercel | 12 mesi |
| Adempimento obblighi di legge (notifica breach, ordini autorità) | Art. 6 par. 1 lett. c GDPR | Variabile | Garante, autorità competenti | Secondo specifica norma applicabile |

## 6. Template DPA per utenti business (futuro)

Quando Utraya aprirà la propria API a utenti business (post-V1, vedi `ROADMAP.md`), si applicherà uno schema GDPR rovesciato:

- **Utente business** = Titolare del trattamento (dei propri utenti finali).
- **Utraya** = Responsabile del trattamento (su nomina ex art. 28).

In quel momento Utraya predisporrà:

1. **Template DPA** scaricabile da `https://utraya.com/legal/dpa-business`.
2. **Lista sub-processors** aggiornata, con possibilità per l'utente business di opporsi a modifiche.
3. **Modalità di esercizio dei diritti** dei dati subject business per il tramite di Utraya.
4. **Liability cap** specifico per la relazione B2B (separato da §15 TOS consumer).

Questa sezione è in stato `🔲 todo` fino all'apertura effettiva della API (vedi `PLAN.md`).

## 7. Esercizio diritti dell'interessato

Ogni utente Utraya può esercitare i diritti GDPR (artt. 15-22) scrivendo a `[email titolare]` con oggetto `[GDPR – natura della richiesta]`.

SLA Utraya:

- **Riscontro entro 30 giorni** dalla richiesta (GDPR art. 12 par. 3), estensibile di ulteriori 60 giorni in casi complessi con motivazione scritta.
- **Gratuità** per richieste non manifestamente infondate o eccessive.
- **Verifica identità** richiesta solo se ragionevolmente necessaria (es. login attivo è sufficiente per la maggior parte delle richieste).

## 8. Contatti per richieste DPA

Per ricevere copia firmata di un DPA con Utraya (per utenti business futuri) o per qualsiasi richiesta su questa documentazione:

- Email: `[email titolare]` con oggetto `[DPA]`
- Titolare del trattamento: `[NOMINATIVO TITOLARE]`, vedi `legal-tos.md §21`.

## 9. Riferimenti normativi e link utili

- Regolamento (UE) 2016/679 — GDPR — testo consolidato: <https://eur-lex.europa.eu/eli/reg/2016/679/oj>
- Decisione di adeguatezza UE-USA (Data Privacy Framework, 10 luglio 2023): <https://commission.europa.eu/news/data-protection-commission-adopts-new-adequacy-decision-sustainable-and-secure-data-flows-2023-07-10_en>
- Clausole Contrattuali Standard (SCC) 2021/914/UE: <https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj>
- Linee guida EDPB 07/2020 sui concetti di titolare e responsabile
- Provv. Garante 22 maggio 2024 n. 254 (responsabilità del titolare nella scelta dei sub-processor)

---

## Storia versioni

| Versione | Data | Modifiche principali |
|---|---|---|
| `2026-05-16-1` | 2026-05-16 | Prima versione operativa con sub-processors Supabase / Vercel / Google, distinzione BYOK vs chiave applicativa Gemini, registro trattamenti estratto |
