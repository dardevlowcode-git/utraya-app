# Informativa Privacy Utraya

> **Stato**: ✅ versione pubblicata
> **Versione documento**: `2026-05-16-1`
> **Data di entrata in vigore**: 2026-05-16
> **Hash canonico**: calcolato da `npm run legal:hash` su questo file.
> **Lingua sorgente**: italiano. Il testo italiano prevale in caso di discrepanza con la traduzione inglese.
> **Riferimenti normativi**: Reg. (UE) 2016/679 (GDPR), in particolare artt. 6, 12-22, 28, 30, 32-34, 44-49, 82; D.Lgs. 196/2003 come modificato dal D.Lgs. 101/2018; Reg. (UE) 910/2014 (eIDAS); Provv. Garante 10/06/2021 n. 231; Linee guida EDPB.

---

## 1. Chi è il responsabile del trattamento

Il responsabile del trattamento dei dati personali raccolti tramite il servizio Utraya è:

- **Responsabile del trattamento**: Dario Bonini
- **Email di contatto per qualsiasi richiesta**: privacy@utraya.com

Per ogni richiesta di informazioni o per l'esercizio dei diritti privacy, gli interessati possono scrivere esclusivamente all'indirizzo indicato sopra.

## 2. A chi si rivolge questa informativa

Questa informativa è rivolta a **tutti gli utenti finali** del servizio Utraya, cioè le persone fisiche che:

- accedono al sito <https://utraya.com> e/o si registrano al servizio;
- utilizzano le funzionalità di watchlist canali YouTube e riassunti AI di video.

Se in futuro Utraya aprirà la propria API a **utenti business** (clienti B2B), i loro utenti finali saranno coperti da un'informativa fornita dall'utente business stesso, che in quel rapporto sarà Titolare del trattamento, mentre Dario Bonini assumerà il ruolo di Responsabile esterno ex art. 28 GDPR (vedi <https://utraya.com/legal/sub-processors> §6).

## 3. Dati personali trattati

### 3.1 Dati raccolti automaticamente al login (Google Sign-In)

Per accedere a Utraya è richiesta l'autenticazione tramite account Google. Tramite lo scope OAuth standard `openid email profile` riceviamo:

| Dato | Esempio | Finalità |
|---|---|---|
| Indirizzo email Google | `utente@example.com` | Identificativo univoco account, comunicazioni di servizio |
| Identificativo Google `sub` | `1093847562837465` | Collegamento persistente identità senza password Utraya |
| Nome visualizzato (opzionale) | `Utente` | Visualizzazione interfaccia (saluto, avatar) |
| Immagine profilo (opzionale) | URL CDN Google | Visualizzazione avatar |
| Locale | `it`, `en` | Lingua interfaccia |
| Token di refresh OAuth | (opaco) | Mantenimento sessione, conservato cifrato |
| Timestamp prima registrazione | `2026-05-16T10:23:00Z` | Audit |
| Timestamp ultimo accesso | `2026-05-17T08:01:00Z` | Sicurezza, audit |

**Non chiediamo e non accediamo a**: contatti Google, calendario, Drive, Gmail, cronologia di ricerca, YouTube history personale, o qualsiasi altro scope al di fuori di `openid email profile`.

### 3.2 Dati creati dall'uso del servizio

| Dato | Esempio | Finalità |
|---|---|---|
| Watchlist canali YouTube | ID canale `UC...`, data aggiunta | Erogazione servizio core |
| Stato video (visto / nascosto) | Booleano per video | Personalizzazione interfaccia utente |
| Riassunti AI generati | Testo + lingua + timestamp | Erogazione servizio |
| Chiave API Gemini personale (BYOK, opzionale) | Cifrata AES-GCM | Custodia per generazione riassunti con chiave utente |
| Preferenze utente | Lingua, tema | Personalizzazione |

### 3.3 Dati tecnici di sicurezza e audit

| Dato | Esempio | Finalità |
|---|---|---|
| Indirizzo IP | `1.2.3.4` | Sicurezza, prevenzione abusi, registrazione probatoria accettazione TOS |
| User agent | `Mozilla/5.0 ...` | Sicurezza, registrazione probatoria accettazione TOS |
| Log di accesso applicativo | Endpoint, status code, timestamp | Sicurezza, debug, audit |
| Registrazione accettazione TOS | user_id, versione documento, hash, timestamp, IP, user agent, locale, email | Prova del consenso ex art. 2702 c.c. + Reg. eIDAS |

### 3.4 Categorie particolari di dati (art. 9 GDPR)

Utraya **non raccoglie volontariamente** categorie particolari di dati (origine razziale, opinioni politiche, convinzioni religiose, dati sanitari, vita sessuale, dati biometrici, ecc.). Se un utente, di propria iniziativa, includesse contenuti di questo tipo nei testi che il servizio elabora (es. richiedendo il riassunto di un video con tema sanitario), il trattamento avviene per **esecuzione del contratto** e non per finalità di profilazione su tali categorie.

### 3.5 Dati di minori

Utraya è destinato a persone di età non inferiore a **14 anni** (D.Lgs. 196/2003 art. 2-quinquies, in deroga al limite di 16 anni di GDPR art. 8 par. 1). Non raccogliamo consapevolmente dati di minori sotto i 14 anni. Se un genitore o tutore venisse a conoscenza che un minore di 14 anni si è registrato, può richiederne la cancellazione immediata scrivendo a privacy@utraya.com.

## 4. Finalità del trattamento e basi giuridiche

Ogni trattamento ha una finalità specifica e una **base giuridica** ai sensi dell'art. 6 GDPR.

| Finalità | Base giuridica (art. 6 GDPR) | Conseguenze del rifiuto |
|---|---|---|
| Autenticazione utente e creazione account | Lett. b (esecuzione del contratto) | Senza questi dati non è possibile usare il servizio |
| Erogazione delle funzionalità (watchlist, riassunti, chiavi API) | Lett. b (esecuzione del contratto) | Senza questi dati il servizio non funziona |
| Comunicazioni di servizio (avvisi sicurezza, conferme operative) | Lett. b (esecuzione del contratto) | Non disattivabili finché l'account è attivo |
| Sicurezza, prevenzione abusi, audit log | Lett. f (legittimo interesse del Titolare a tutelare il servizio e gli utenti) | Non disattivabile — bilanciamento favorevole al Titolare |
| Registrazione probatoria accettazione TOS | Lett. f (legittimo interesse alla difesa giudiziale) | Non disattivabile — necessaria per provabilità contrattuale |
| Adempimenti di legge (notifiche breach, ordini autorità) | Lett. c (obbligo legale) | Non disattivabile |
| Cessione contratto in operazioni straordinarie | Lett. f (legittimo interesse alla continuità aziendale) | L'utente può chiudere account in caso di disaccordo |

**Allo stato attuale Utraya NON tratta dati per finalità di marketing, profilazione commerciale o pubblicità.** Se in futuro queste finalità venissero introdotte, sarà richiesto **consenso esplicito e granulare** (art. 6 par. 1 lett. a GDPR), revocabile in qualsiasi momento.

## 5. Tempi di conservazione

Conserviamo i dati solo per il tempo strettamente necessario alle finalità.

| Categoria dati | Durata di conservazione |
|---|---|
| Dati account (email, sub, watchlist, riassunti, chiavi API cifrate) | Per la durata dell'account, + 30 giorni dopo richiesta di cancellazione (finestra tecnica di esecuzione cancellazione) |
| Log applicativi di sicurezza (IP, accessi) | **12 mesi** dal generazione |
| Registrazione accettazione TOS (audit probatorio) | **10 anni** dal momento dell'accettazione (termine ordinario di prescrizione ex art. 2946 c.c.) — sopravvive alla cancellazione account in forma anonimizzata (user_id rimosso, ma rimangono versione documento, hash, timestamp, email denormalizzata, IP, user agent) |
| Backup database (cifrati, snapshot Supabase) | Fino a 30 giorni di rolling retention; oltre questo termine i backup contenenti dati cancellati vengono purgati naturalmente |
| Dati per adempimenti di legge | Secondo la specifica norma applicabile (fiscale, antiriciclaggio, ecc.) |

La conservazione prolungata di 10 anni dei registri di accettazione TOS è giustificata da legittimo interesse alla **difesa giudiziale** (art. 17 par. 3 lett. e GDPR) ed è proporzionata: vengono conservati solo i metadati di accettazione, non i contenuti generati dall'utente.

## 6. Sub-processor e destinatari dei dati

I dati personali possono essere trattati dai seguenti Responsabili esterni (sub-processor), nominati ex art. 28 GDPR. L'elenco completo, sempre aggiornato, è disponibile a <https://utraya.com/legal/sub-processors>.

| Fornitore | Funzione | Sede / hosting |
|---|---|---|
| Supabase, Inc. | Hosting database PostgreSQL + autenticazione + storage | Hosting dati a riposo: UE (Frankfurt o Ireland) |
| Vercel, Inc. | Hosting applicazione web + CDN + serverless functions | CDN globale; serverless region default `fra1` (Frankfurt) |
| Google LLC | OAuth (login Google); eventualmente Gemini API per riassunti (vedi §7) | USA, con garanzie DPF + SCC |

Tutti i sub-processor hanno sottoscritto con Dario Bonini un Data Processing Agreement (DPA) conforme all'art. 28 GDPR.

Comunichiamo dati personali a destinatari diversi dai sub-processor **solo nei seguenti casi**:

- **Autorità competenti** (Garante, Forze dell'Ordine, autorità giudiziarie) in risposta a richieste legali legittime;
- **Consulenti legali** del Titolare in caso di contenzioso, sotto vincolo di riservatezza professionale;
- **Acquirenti del ramo d'azienda** in caso di operazioni straordinarie (fusione, cessione), previa informativa preventiva agli utenti.

**Non vendiamo, non affittiamo e non scambiamo i dati degli utenti con terze parti per finalità di marketing.**

## 7. Generazione riassunti AI — modalità BYOK vs applicativa

Il servizio di riassunto AI ha due modalità operative che hanno **implicazioni privacy diverse**:

### 7.1 Modalità A — chiave API utente (BYOK, predefinita)

L'utente fornisce la propria chiave API Google Gemini, che Utraya custodisce cifrata (AES-GCM) su Supabase. Quando l'utente richiede un riassunto:

- La richiesta a Gemini viene effettuata **con la chiave dell'utente**, non con quella di Utraya.
- Il **rapporto contrattuale** sui dati inviati a Gemini è **direttamente tra utente e Google**, regolato dai termini Gemini accettati dall'utente al momento della generazione della propria chiave.
- Dario Bonini è **responsabile solo della custodia cifrata della chiave**, non del contenuto trasmesso a Gemini in quel flusso.

### 7.2 Modalità B — chiave applicativa di Utraya (allowlist beta gratuita, fallback)

Per la beta gratuita, Dario Bonini usa una propria chiave Gemini per servire un numero limitato di utenti senza richiedere BYOK. In questa modalità:

- Il rapporto è **tra Dario Bonini e Google** ex art. 28 GDPR (DPA Google Cloud: <https://cloud.google.com/terms/data-processing-addendum>).
- I dati trasmessi a Gemini sono: **URL del video YouTube + trascrizione/sottotitoli pubblici del video**. **Nessun dato identificativo dell'utente Utraya** (email, sub, IP, watchlist) viene mai incluso nei prompt.
- Le richieste sono configurate con `prompt_logging: false` per evitare che Google usi i prompt per addestrare i propri modelli (politica di non-training).

## 8. Trasferimenti extra-UE

Alcuni sub-processor hanno sede negli Stati Uniti (Vercel, Google). I trasferimenti di dati personali fuori dall'Unione Europea avvengono nel rispetto del Capo V GDPR, con le seguenti garanzie:

1. **Decisione di adeguatezza UE → USA (Data Privacy Framework)**, adottata dalla Commissione europea il 10 luglio 2023, per i sub-processor certificati DPF (Vercel e Google sono certificati). Riferimento: <https://www.dataprivacyframework.gov>.
2. **Clausole Contrattuali Standard (SCC) 2021/914/UE**, applicate in concorso ("belt and suspenders") anche dove esiste decisione di adeguatezza, allegate ai rispettivi DPA.
3. **Misure tecniche supplementari**: cifratura at-rest dei dati sensibili, TLS 1.3 in transito, segregazione regionale dei dati a riposo (UE per Supabase).

I dati a riposo conservati su Supabase **restano fisicamente in Unione Europea** (Frankfurt o Ireland). Operazioni di supporto tecnico da parte di personale Supabase USA, ove necessarie, sono coperte da SCC Modulo 3.

Dettaglio completo per ciascun fornitore: <https://utraya.com/legal/sub-processors>.

## 9. Diritti dell'interessato

Ai sensi degli artt. 15-22 GDPR, ogni utente può esercitare i seguenti diritti scrivendo a **privacy@utraya.com** con oggetto `[GDPR – natura della richiesta]`:

| Diritto | Riferimento | Cosa significa |
|---|---|---|
| Accesso | Art. 15 | Sapere se trattiamo i tuoi dati e ricevere una copia |
| Rettifica | Art. 16 | Correggere dati inesatti o incompleti |
| Cancellazione ("oblio") | Art. 17 | Chiedere la rimozione dei tuoi dati, salvo i casi di conservazione obbligatoria |
| Limitazione | Art. 18 | Sospendere temporaneamente il trattamento in casi specifici |
| Portabilità | Art. 20 | Ricevere i tuoi dati in formato strutturato leggibile (JSON) e trasferirli ad altro titolare |
| Opposizione | Art. 21 | Opporti a trattamenti basati su legittimo interesse |
| Revoca del consenso | Art. 7 par. 3 | Quando il trattamento si basa su consenso, revocarlo senza pregiudicare la liceità del passato |
| Non subire decisioni automatizzate | Art. 22 | Utraya non adotta decisioni automatizzate con effetti giuridici sull'utente |

**SLA Utraya per riscontro**:

- **Entro 30 giorni** dalla richiesta (art. 12 par. 3 GDPR), estensibili di ulteriori 60 giorni in casi complessi con motivazione scritta.
- **Gratuità** per richieste non manifestamente infondate o eccessive.
- **Verifica identità** richiesta solo se ragionevolmente necessaria; per la maggior parte delle richieste la sessione di login attiva è sufficiente.

### 9.1 Reclamo all'autorità di controllo

Se ritieni che il trattamento violi il GDPR, hai diritto di proporre reclamo (art. 77 GDPR) al:

- **Garante per la protezione dei dati personali**
- Piazza Venezia 11, 00187 Roma
- Sito web: <https://www.garanteprivacy.it>
- Email: garante@gpdp.it / protocollo@pec.gpdp.it

Puoi anche rivolgerti all'autorità di controllo dello Stato UE in cui risiedi abitualmente.

## 10. Modalità di esercizio diritti e cancellazione

### 10.1 Cancellazione account

Puoi richiedere la cancellazione completa del tuo account in qualsiasi momento:

- via email a privacy@utraya.com con oggetto `[GDPR – Cancellazione account]`;
- usando la funzione in-app di "Cancella account" quando disponibile;
- revocando l'accesso di Utraya dal tuo account Google: <https://myaccount.google.com/permissions> (in questo caso ti contatteremo per confermare la cancellazione lato Utraya).

La cancellazione comporta:

- rimozione definitiva di email, nome, immagine, locale, watchlist, riassunti, chiavi API cifrate, refresh token entro **30 giorni** dalla richiesta;
- conservazione, in forma anonimizzata, della riga di accettazione TOS (vedi §5) per il termine di prescrizione ordinaria di 10 anni;
- conservazione dei log di sicurezza per 12 mesi dalla loro generazione;
- conservazione tecnica nei backup cifrati per ulteriori 30 giorni (rolling retention), oltre i quali i dati cancellati spariscono naturalmente.

La cancellazione è **irreversibile**.

### 10.2 Portabilità

Puoi richiedere un export completo dei tuoi dati in formato JSON strutturato (account, watchlist, riassunti generati, preferenze) scrivendo a privacy@utraya.com con oggetto `[GDPR – Portabilità]`. Il file ti sarà fornito entro 30 giorni.

## 11. Sicurezza

Adottiamo misure tecniche e organizzative ragionevoli per proteggere i dati, in coerenza con l'art. 32 GDPR:

- **Cifratura at-rest** dei dati sensibili (chiavi API utente in AES-GCM);
- **Cifratura in transito** con TLS 1.3 obbligatorio;
- **Row Level Security** (RLS) su tutte le tabelle Supabase: ogni utente vede solo i propri dati;
- **MFA obbligatoria** per accesso amministratore;
- **Audit log applicativi** delle azioni amministrative;
- **Principio del minimo privilegio** per service account e API key;
- **Backup cifrati** con retention 30 giorni;
- **Segregazione ambienti** (preprod separato da produzione, dati di test sintetici).

Nessun sistema informatico è invulnerabile. In caso di **violazione di dati personali** che comporti rischio per i diritti degli interessati:

- notifichiamo l'evento al **Garante entro 72 ore** dalla scoperta (art. 33 GDPR);
- notifichiamo gli **utenti coinvolti** senza ingiustificato ritardo quando il rischio è elevato (art. 34 GDPR);
- documentiamo internamente l'evento, le valutazioni di impatto e le azioni di rimedio.

Per segnalare responsabilmente una vulnerabilità: privacy@utraya.com con oggetto `[SECURITY]`. La policy di responsible disclosure è disponibile a <https://utraya.com/.well-known/security.txt>.

## 12. Cookie e tracciamento

L'uso di cookie e altri identificatori è disciplinato da un documento separato, la **Cookie Policy**, disponibile a <https://utraya.com/legal/cookie>.

In sintesi (stato versione `2026-05-16-1`):

- Utraya usa **esclusivamente cookie tecnici** (sessione di login, scelta lingua, memoria preferenze cookie).
- **Nessun cookie analitico, di profilazione, di marketing o di terze parti** è attualmente in uso.
- Se in futuro introdurremo strumenti analitici o di profilazione, sarà richiesto consenso esplicito tramite cookie banner, revocabile in qualsiasi momento.

## 13. Decisioni automatizzate e profilazione

Utraya **non adotta decisioni automatizzate** con effetti giuridici o significativi sull'utente ai sensi dell'art. 22 GDPR. I riassunti AI sono uno strumento informativo, non incidono su diritti, obblighi o status dell'utente.

Utraya **non effettua profilazione** finalizzata a costruire un profilo predittivo dell'utente per scopi di marketing, ranking commerciale o targeting pubblicitario.

## 14. Modifiche all'informativa

Possiamo aggiornare questa Informativa Privacy in qualsiasi momento, in particolare se:

- cambiano le finalità del trattamento;
- vengono introdotti o sostituiti sub-processor;
- cambia il quadro normativo applicabile.

Per **modifiche sostanziali** (nuove finalità, nuovi destinatari critici, cambi di basi giuridiche) avviseremo gli utenti registrati via email con almeno **30 giorni di preavviso**. Per modifiche minori (correzioni redazionali, aggiornamenti link), pubblicheremo la nuova versione su <https://utraya.com/legal/privacy> con bump della versione documento.

La versione corrente è sempre disponibile online ed è identificata da numero di versione e data di entrata in vigore in testa al documento.

## 15. Contatti

Per qualsiasi questione relativa al trattamento dei tuoi dati personali o per l'esercizio dei diritti GDPR:

- **Email**: privacy@utraya.com (oggetto `[GDPR]` per richieste di esercizio diritti)
- **Reclami autorità**: Garante per la protezione dei dati personali, Piazza Venezia 11, 00187 Roma, <https://www.garanteprivacy.it>

---

# English version (best effort — non-binding)

> Italian text above prevails in case of discrepancy.

## 1. Data Controller

The data processing responsible person for personal data collected through the Utraya service is:

- **Data processing responsible person**: Dario Bonini
- **Contact email for all requests**: privacy@utraya.com

For any information request or privacy-rights exercise, data subjects can contact only the address above.

## 2. Personal data we process

### 2.1 Data collected via Google Sign-In

To access Utraya you must authenticate with a Google account. Via the OAuth scope `openid email profile` we receive: your Google email, Google `sub` ID, display name (optional), profile picture (optional), locale, OAuth refresh token (encrypted), first registration timestamp, last access timestamp.

**We do not request or access**: Google contacts, calendar, Drive, Gmail, search history, YouTube personal history, or any scope beyond `openid email profile`.

### 2.2 Service-generated data

Watchlist (YouTube channel IDs), video state (seen/hidden), AI-generated summaries, personal Gemini API key (encrypted, optional), user preferences.

### 2.3 Technical security and audit data

IP address, user agent, application access logs, TOS acceptance records (user_id, document version, hash, timestamp, IP, user agent, locale, email).

## 3. Purposes and legal bases (GDPR art. 6)

- **Authentication and service delivery** — art. 6(1)(b) contract performance.
- **Service communications** — art. 6(1)(b) contract performance.
- **Security, fraud prevention, audit logs** — art. 6(1)(f) legitimate interest.
- **TOS acceptance record (evidentiary)** — art. 6(1)(f) legitimate interest (judicial defense).
- **Legal compliance (breach notification, authority orders)** — art. 6(1)(c) legal obligation.

We do **not** currently process data for marketing, commercial profiling, or advertising. If introduced in the future, explicit granular consent will be required.

## 4. Retention

- Account data: for the lifetime of the account, plus 30 days after deletion request.
- Security logs: 12 months.
- TOS acceptance records: 10 years (ordinary statute of limitations); survive account deletion in anonymized form.
- Encrypted backups: rolling 30-day retention.

## 5. Sub-processors and recipients

Supabase, Inc. (database, auth — EU hosting); Vercel, Inc. (web hosting, CDN); Google LLC (OAuth, optionally Gemini API). All sub-processors are bound by GDPR art. 28 DPA. Full list: <https://utraya.com/legal/sub-processors>.

We do not sell, rent, or trade user data for marketing purposes.

## 6. Extra-EU transfers

Some sub-processors are based in the United States. Transfers are safeguarded by:

- EU-US Data Privacy Framework (adequacy decision, 10 July 2023);
- Standard Contractual Clauses (SCC 2021/914/EU);
- Supplementary technical measures (at-rest encryption, TLS 1.3, EU-region data residency on Supabase).

## 7. Your rights (GDPR arts. 15-22)

You have the right to: access, rectification, erasure, restriction, portability, objection, withdrawal of consent (where applicable), not to be subject to automated decision-making.

Exercise your rights at **privacy@utraya.com** (subject `[GDPR – nature of request]`). Response within 30 days (extendable to 90 in complex cases), free of charge unless manifestly unfounded or excessive.

You may also lodge a complaint with the Italian Data Protection Authority (Garante) at <https://www.garanteprivacy.it> or with the supervisory authority of the EU Member State where you reside.

## 8. Cookies

See separate Cookie Policy at <https://utraya.com/legal/cookie>. Current status: only technical cookies; no analytics, profiling, or marketing cookies.

## 9. Automated decision-making

Utraya does not engage in automated decision-making with legal or similarly significant effects (GDPR art. 22). AI summaries are informational tools and do not affect users' rights or obligations.

## 10. Changes to this Privacy Notice

We may update this Privacy Notice. For substantial changes, registered users are notified by email at least 30 days in advance. The current version is always available at <https://utraya.com/legal/privacy>.

## 11. Contact

Email: privacy@utraya.com.

---

## Storia versioni

| Versione | Data | Modifiche principali |
|---|---|---|
| `2026-05-16-1` | 2026-05-16 | Prima versione pubblicata. Titolare: Dario Bonini Scope OAuth `openid email profile`. Solo cookie tecnici. No marketing, no profilazione. Conservazione 10 anni per registri TOS. Trasferimenti extra-UE coperti da DPF + SCC. |
