# Termini di Servizio Utraya

> **Stato**: ✅ versione pubblicata
> **Versione documento**: `2026-05-16-1`
> **Data di entrata in vigore**: 2026-05-16
> **Hash canonico**: calcolato da `npm run legal:hash` su questo file (vedi §0).
> **Lingua sorgente**: italiano. Il testo italiano prevale in caso di discrepanza con la traduzione inglese.

---

## 0. Note operative (questa sezione non fa parte del TOS pubblico)

- Quando questo documento cambia, si genera un **nuovo hash SHA-256** sull'intero file e si bumpa il campo versione (formato `YYYY-MM-DD-N`).
- Le sezioni marcate **[VESSATORIA]** richiedono accettazione specifica separata ex art. 1341 c.c. comma 2 (vedi §22 "Approvazione specifica delle clausole vessatorie").
- Documento privo di riferimenti societari e dati identificativi aggiuntivi: il responsabile indicato è Dario Bonini con contatto privacy@utraya.com.

---

## 1. Preambolo e natura del servizio

Utraya è un servizio web **gratuito**, attualmente in fase **beta sperimentale ad accesso limitato (allowlist)**, offerto in **buona fede** e **senza finalità di lucro** da Dario Bonini, titolare indicato all'art. 21.

Lo scopo di Utraya è aiutare l'utente a tenere traccia di canali YouTube e leggere riassunti testuali generati con intelligenza artificiale dei video pubblicati. Il servizio **non sostituisce in alcun modo la consulenza professionale** di alcun tipo (legale, medica, finanziaria, tecnica) e i riassunti AI **possono contenere errori, omissioni o interpretazioni non corrette** del contenuto originale.

L'utilizzo del servizio è **volontario**. Se l'utente non condivide anche solo in parte questi Termini, **è invitato a non utilizzare Utraya** e a chiudere subito la propria sessione.

## 2. Accettazione e perfezionamento del contratto

L'accesso a Utraya richiede:

1. Autenticazione con un account Google (vedi §12 e §12-bis).
2. Lettura e accettazione di questi Termini di Servizio mediante apposita casella di spunta.
3. **Accettazione separata** delle clausole vessatorie elencate al §22, mediante una **seconda casella di spunta dedicata** (ex art. 1341 c.c. comma 2).

L'accettazione è registrata in database con: identificativo utente, versione del documento, hash SHA-256 del documento, timestamp, indirizzo IP e user agent del browser, lingua della versione accettata. Questa registrazione costituisce prova del consenso ai sensi dell'art. 2702 c.c. e del Reg. (UE) 910/2014 (eIDAS) per i contratti elettronici.

## 3. Età minima

Utraya è destinato a persone di età non inferiore a **14 anni** (limite italiano per il consenso autonomo al trattamento dati ai sensi del D.Lgs. 196/2003 art. 2-quinquies, in deroga al limite di 16 anni di GDPR art. 8 par. 1).

Per utenti di età inferiore è **richiesto il consenso del genitore o tutore**, manifestato attraverso l'account Google del minore (che a sua volta è regolato dalle policy di Google Family Link).

Se l'utente è minore di 14 anni **non deve registrarsi**.

## 4. Natura sperimentale del servizio — "as is"

Utraya è offerto **"as is" ("così com'è") e "as available" ("nella misura in cui è disponibile")**.

Il titolare:

- **non garantisce continuità del servizio**: il servizio può essere sospeso, modificato o terminato in qualsiasi momento, anche senza preavviso, soprattutto trattandosi di fase beta sperimentale;
- **non garantisce esattezza dei riassunti AI**: i contenuti generati dall'intelligenza artificiale sono soggetti a errori, allucinazioni, omissioni, fraintendimenti. L'utente è invitato a **verificare sempre i contenuti originali su YouTube** prima di basare qualsiasi decisione sui riassunti;
- **non garantisce sicurezza assoluta**: pur adottando misure tecniche e organizzative adeguate, nessun sistema informatico è invulnerabile.

## 5. Comportamenti consentiti

L'utente può:

- aggiungere canali YouTube alla propria watchlist personale;
- leggere riassunti dei video, nella lingua disponibile;
- nascondere video dalla propria interfaccia;
- richiedere in qualsiasi momento la cancellazione del proprio account (vedi §10).

## 6. Comportamenti vietati

L'utente **non deve**:

1. utilizzare Utraya per finalità illegali o lesive di diritti di terzi;
2. tentare di accedere ad aree del servizio per le quali non è autorizzato;
3. effettuare scraping, scraping automatizzato o reverse engineering del servizio;
4. caricare o tentare di iniettare codice malevolo, malware, prompt injection mirati a esfiltrare dati di altri utenti;
5. impersonare altri utenti o creare account multipli per aggirare limiti di servizio o l'allowlist;
6. ridistribuire i riassunti generati dal servizio come prodotto proprio o commerciale;
7. utilizzare il servizio per addestrare modelli AI di terze parti senza autorizzazione esplicita.

La violazione di queste regole comporta la **sospensione o chiusura immediata dell'account** (vedi §11 — clausola vessatoria).

## 7. Proprietà intellettuale

- I **contenuti dei video YouTube** appartengono ai rispettivi titolari (creatori dei canali). Utraya non rivendica alcun diritto su di essi e non li ridistribuisce.
- I **riassunti generati dall'AI** sono prodotti derivati a uso personale dell'utente che ne ha richiesto la generazione. L'utente può usarli per i propri scopi personali e non commerciali; non può rivenderli, ridistribuirli pubblicamente o usarli per scopi commerciali senza esplicito consenso scritto.
- Il **software, design, marchio "Utraya" e database della piattaforma** sono di proprietà di Dario Bonini

## 8. Servizi e fornitori di terze parti

Utraya utilizza servizi di terze parti per funzionare:

| Fornitore | Funzione | Dati che riceve |
|---|---|---|
| Google Identity (OAuth) | Autenticazione utente | Vedi §12-bis |
| YouTube Data API v3 | Lettura metadati pubblici dei video | Nessun dato utente trasmesso |
| Google Gemini (o equivalente AI dell'utente) | Generazione riassunti | URL/trascrizione video, non dati utente |
| Supabase (hosting DB UE) | Storage e auth backend | Tutti i dati account utente cifrati a riposo |
| Vercel (hosting) | Erogazione applicazione | Log tecnici di accesso (IP, user agent) |

L'elenco completo e aggiornato dei sub-processors è disponibile a <https://utraya.com/legal/sub-processors>.

Il titolare **non è responsabile** del funzionamento, della disponibilità o delle policy di questi fornitori. Eventuali disservizi causati esclusivamente da fornitori terzi non danno diritto a risarcimento (vedi §15 — clausola vessatoria).

## 9. Gratuità e modello economico

Utraya è oggi **completamente gratuito**. **Non esistono pacchetti, crediti, abbonamenti né acquisti in-app**.

Il titolare si riserva il diritto, in futuro, di introdurre piani a pagamento per funzionalità avanzate; in tal caso:

- le funzionalità oggi disponibili gratuitamente **rimarranno gratuite**;
- l'utente sarà avvisato con almeno **30 giorni di anticipo** prima dell'attivazione di qualsiasi opzione a pagamento;
- nessun addebito potrà mai avvenire senza esplicito consenso dell'utente.

## 10. Cancellazione dell'account e portabilità dei dati

L'utente può, in qualsiasi momento:

- **cancellare il proprio account** scrivendo a privacy@utraya.com o usando la funzione in-app quando disponibile;
- **revocare l'accesso di Utraya** dal proprio account Google: <https://myaccount.google.com/permissions>;
- **richiedere una copia dei propri dati** in formato leggibile (diritto alla portabilità, GDPR art. 20);
- **richiedere la rettifica o cancellazione di specifici dati** (GDPR artt. 16-17).

La cancellazione è **irreversibile** e comporta la rimozione dei dati entro **30 giorni** dalla richiesta, salvo obblighi di legge che impongano una conservazione più lunga (es. log di sicurezza per accertamenti di sicurezza informatica, conservati per 12 mesi; registrazioni probatorie di accettazione TOS in forma anonimizzata, conservate per il termine di prescrizione ordinaria di 10 anni ex art. 17 par. 3 lett. e GDPR).

## 11. [VESSATORIA] Sospensione e chiusura dell'account su iniziativa del titolare

Il titolare può sospendere o chiudere l'account dell'utente, **anche senza preavviso**, nei seguenti casi:

- violazione delle regole di cui al §6;
- comportamenti che mettono a rischio la sicurezza, stabilità o integrità del servizio o dei dati di altri utenti;
- ordini di autorità competenti;
- chiusura totale o parziale del servizio.

La chiusura su iniziativa del titolare per i motivi sopra **non dà diritto a indennizzo né risarcimento di alcun tipo**, salvo i casi di dolo o colpa grave (art. 1229 c.c.).

## 12. Trattamento dei dati personali (rimando)

Il trattamento dei dati personali è disciplinato dalla **Privacy Policy** di Utraya, disponibile a <https://utraya.com/legal/privacy>, conforme al Reg. (UE) 2016/679 (GDPR) e al D.Lgs. 196/2003 come modificato.

Riferimenti GDPR utili:

- Diritti dell'interessato: artt. 12-22 GDPR.
- Reclami all'autorità: Garante per la protezione dei dati personali, <https://www.garanteprivacy.it>.

## 12-bis. Dati raccolti tramite Google Sign-In

Per accedere a Utraya devi autenticarti con un account Google. Durante l'autenticazione raccogliamo **esclusivamente i dati minimi necessari al funzionamento del servizio**:

- il tuo **indirizzo email Google**, usato come identificativo univoco dell'account e per comunicazioni di servizio (avvisi di sicurezza, conferme operative);
- l'**identificativo univoco del tuo account Google** (Google `sub`/`uid`), per associare la tua identità in modo persistente senza dover memorizzare una password Utraya;
- opzionalmente il **nome visualizzato** e l'**immagine profilo**, ove utilizzati nell'interfaccia (avatar, saluto);
- la tua **preferenza di lingua** (per impostare la lingua dell'interfaccia Utraya);
- i **timestamp** di prima registrazione e di ultimo accesso;
- il **token di refresh OAuth** (se necessario al mantenimento della sessione), conservato cifrato.

**Non chiediamo e non accediamo** ai tuoi contatti Google, calendario, Drive, Gmail, cronologia ricerche o qualsiasi altro dato non strettamente necessario al login. L'unico scope OAuth richiesto è quello standard per l'identificazione: `openid email profile`.

I dati sono conservati su database **Supabase con hosting nell'Unione Europea**.

Puoi **revocare l'accesso di Utraya** al tuo account Google in qualsiasi momento da <https://myaccount.google.com/permissions> e richiedere la cancellazione completa dei tuoi dati come da §10.

## 13. [VESSATORIA] Modifica unilaterale dei Termini

Il titolare può modificare in qualsiasi momento questi Termini, in particolare per adeguarli a nuove norme, nuovi servizi o nuovi rischi di sicurezza.

In caso di modifica:

- l'utente verrà avvisato al successivo accesso a Utraya con una notifica visibile;
- sarà richiesta **nuova accettazione esplicita** della versione aggiornata e delle clausole vessatorie aggiornate;
- in mancanza di nuova accettazione, l'accesso al servizio sarà sospeso fino a regolarizzazione o richiesta di cancellazione account.

Per modifiche sostanziali che peggiorano la posizione dell'utente (es. introduzione di nuove clausole vessatorie, cambio condizioni economiche), il titolare fornirà preavviso di almeno **30 giorni** e darà all'utente diritto di recesso senza penali (cancellazione account ex §10).

La versione corrente in vigore è sempre disponibile a <https://utraya.com/legal/termini> ed è identificata dalla versione documento e dall'hash SHA-256.

## 14. Sicurezza, segnalazione vulnerabilità e notifica breach

Il titolare adotta misure tecniche e organizzative ragionevoli per proteggere i dati: cifratura a riposo dei dati sensibili, RLS su database Supabase, accesso amministratore vincolato a MFA, audit log applicativi.

In caso di **violazione di dati personali** che comporti rischio per i diritti dell'utente, il titolare:

- notifica l'evento al **Garante** entro 72 ore dalla scoperta (GDPR art. 33);
- notifica gli **utenti coinvolti** senza ingiustificato ritardo quando il rischio è elevato (GDPR art. 34);
- documenta l'evento nei propri registri interni.

Per segnalare una vulnerabilità di sicurezza in modo responsabile, contattare privacy@utraya.com con oggetto `[SECURITY]`. La policy di responsible disclosure è disponibile a <https://utraya.com/.well-known/security.txt>.

## 15. [VESSATORIA] Limitazione di responsabilità

**Nei limiti massimi consentiti dalla legge applicabile**, il titolare:

1. **non risponde** di danni indiretti, consequenziali, perdita di profitti, perdita di dati derivante da disservizi del servizio, errori dei riassunti AI, indisponibilità di fornitori terzi (Google, Supabase, Vercel, Gemini), interruzioni di connettività, eventi di forza maggiore;
2. **non risponde** di decisioni prese dall'utente sulla base dei riassunti generati: i riassunti AI **non costituiscono consulenza** né sostituiscono la consultazione del contenuto originale;
3. limita comunque la propria responsabilità per danni diretti — nei casi in cui la legge consenta tale limitazione — a un importo simbolico di **un (1) Euro**, in considerazione della **natura gratuita del servizio** e dell'**assenza di scambio economico** con l'utente.

**Resta ferma la responsabilità del titolare**:

- per **dolo o colpa grave** (art. 1229 c.c.), in nessun caso limitabile;
- per **danni alla persona** dell'utente, in nessun caso limitabile;
- per **violazione di obblighi GDPR** che causi danno risarcibile ex art. 82 GDPR, secondo le norme inderogabili applicabili;
- per **violazioni di norme imperative** del Codice del Consumo (D.Lgs. 206/2005) e di altre norme di tutela del consumatore.

## 16. [VESSATORIA] Indennizzo a favore del titolare

L'utente accetta di **manlevare e tenere indenne** il titolare da qualsiasi pretesa di terzi derivante da:

- uso illecito del servizio da parte dell'utente;
- contenuti caricati o inseriti dall'utente in violazione di diritti di terzi;
- violazione da parte dell'utente delle regole di cui al §6.

La manleva non opera in caso di dolo o colpa grave del titolare.

## 17. [VESSATORIA] Legge applicabile e foro competente

Questi Termini sono regolati dalla **legge italiana**.

Per le controversie:

- se l'utente è **consumatore residente nell'Unione Europea**, è competente il **foro del luogo di residenza o domicilio dell'utente**, ai sensi del Reg. (UE) 1215/2012 (Bruxelles I-bis) artt. 17-19 — norma inderogabile a tutela del consumatore;
- in tutti gli altri casi (utenti professionali, B2B), è competente **in via esclusiva il Foro di `[CITTÀ FORO]`** (foro contrattuale indicato in questo documento).

L'utente consumatore può, in alternativa al foro giudiziario, attivare procedure di risoluzione alternativa delle controversie (ADR/ODR) tramite la piattaforma europea: <https://ec.europa.eu/consumers/odr>.

## 18. [VESSATORIA] Forza maggiore e cause sopravvenute

Il titolare **non risponde** di ritardi o inadempimenti causati da eventi di forza maggiore o cause sopravvenute non imputabili, inclusi a titolo esemplificativo: guasti di infrastrutture di terzi (cloud provider, registrar DNS, certificati SSL), attacchi cibernetici nonostante misure adeguate, ordini di autorità, blackout di rete, eventi naturali, conflitti armati.

## 19. Comunicazioni

Tutte le comunicazioni di servizio (avvisi di sicurezza, modifiche TOS, conferme operative) sono inviate all'**indirizzo email Google** con cui l'utente si è registrato. L'utente è tenuto a mantenere quell'indirizzo attivo e a controllarlo periodicamente.

Comunicazioni di natura legale possono essere inviate a privacy@utraya.com indicando in oggetto `[LEGAL]`.

## 20. Cessione del contratto

L'utente non può cedere i propri diritti e obblighi derivanti da questi Termini senza il consenso scritto del titolare.

Il titolare può cedere il contratto in caso di operazioni straordinarie (cessione del ramo d'azienda, fusione, incorporazione) **previa informativa** all'utente, che potrà comunque richiedere la cancellazione dell'account (§10) se non gradisce il subentro.

## 21. Responsabile del servizio

- **Responsabile del servizio e del trattamento dati**: Dario Bonini
- **Email di contatto per ogni richiesta di informazioni**: privacy@utraya.com

## 22. Approvazione specifica delle clausole vessatorie (art. 1341 c.c. comma 2)

L'utente, ai sensi e per gli effetti dell'**art. 1341 c.c. comma 2** e dell'**art. 1342 c.c.**, dichiara di aver letto, compreso e di approvare specificamente le seguenti clausole:

- **§11** — Sospensione e chiusura dell'account su iniziativa del titolare
- **§13** — Modifica unilaterale dei Termini
- **§15** — Limitazione di responsabilità (compreso il tetto di 1 Euro per danni diretti)
- **§16** — Indennizzo a favore del titolare
- **§17** — Legge applicabile e foro competente
- **§18** — Forza maggiore e cause sopravvenute

L'accettazione di queste clausole avviene mediante **apposita casella di spunta separata** rispetto a quella generica di accettazione dei Termini, presentata all'utente al primo accesso al servizio.

In assenza di accettazione specifica di queste clausole, **l'accesso al servizio non è consentito**.

---

## Sintesi giuridica (non parte del TOS pubblico)

| Tutela | Norma | Effetto pratico |
|---|---|---|
| Esclusione dolo/colpa grave | art. 1229 c.c. | Limitazioni di responsabilità mai valide per condotte intenzionali o gravemente colpose |
| Danno da trattamento dati | GDPR art. 82 | Risarcimento inderogabile per violazioni GDPR |
| Foro del consumatore UE | Reg. 1215/2012 artt. 17-19 | Foro competente sempre quello dell'utente consumatore UE |
| Clausole vessatorie B2C | D.Lgs. 206/2005 artt. 33-36 | Alcune clausole sono nulle de iure anche con accettazione |
| Approvazione specifica B2B/generica | art. 1341 c.c. comma 2 | Clausole vessatorie efficaci solo con accettazione separata (doppio click) |
| Buona fede contrattuale | art. 1175 + art. 1375 c.c. | Standard di valutazione del comportamento titolare |

---

# English version (best effort — non-binding translation)

> Italian text above prevails in case of discrepancy.

## 1. Preamble and nature of the service

Utraya is a **free** web service, currently in **experimental beta with limited access (allowlist)**, offered in **good faith** and **with no profit motive** by Dario Bonini, the controller indicated in section 21.

The purpose of Utraya is to help users track YouTube channels and read AI-generated text summaries of published videos. The service **does not replace professional advice** of any kind (legal, medical, financial, technical) and AI summaries **may contain errors, omissions, or misinterpretations** of original content.

Use of the service is **voluntary**. If you do not agree with these Terms, even in part, **you are invited not to use Utraya** and to close your session immediately.

## 2. Acceptance and contract formation

Access to Utraya requires:

1. Authentication with a Google account (see §12 and §12-bis).
2. Reading and acceptance of these Terms of Service via checkbox.
3. **Separate acceptance** of the unfair clauses listed in §22, via a **second dedicated checkbox** (per art. 1341 of the Italian Civil Code, paragraph 2).

Acceptance is recorded in the database including: user identifier, document version, document SHA-256 hash, timestamp, IP address, browser user agent, and accepted language version.

## 12-bis. Data collected via Google Sign-In

To access Utraya you must authenticate with a Google account. During sign-in we collect **only the minimum data required for the service to function**:

- your **Google email address**, used as account identifier and for service communications;
- your **Google account unique identifier** (`sub`/`uid`), to persistently link your identity without requiring a Utraya password;
- optionally your **display name** and **profile picture**, where shown in the interface;
- your **language preference**;
- **first registration and last access timestamps**;
- the **OAuth refresh token** (where required for session continuity), stored encrypted.

**We do not request or access** your Google contacts, calendar, Drive, Gmail, search history, or any other data from your Google account. The only OAuth scope requested is the standard authentication scope: `openid email profile`.

Data is stored on **Supabase databases hosted in the European Union**.

You can **revoke Utraya's access** to your Google account at any time at <https://myaccount.google.com/permissions> and request full data deletion as per §10.

[Sections 3-22 follow the structure of the Italian version above. Italian text prevails for legal interpretation.]

---

## Storia versioni

| Versione | Data | Modifiche principali |
|---|---|---|
| `2026-05-16-1` | 2026-05-16 | Prima versione pubblicata. Titolare: Dario Bonini Vessatorie marcate (§11, §13, §15, §16, §17, §18). §12-bis su dati Google. Tetto risarcimento simbolico 1€ per natura gratuita del servizio. |
