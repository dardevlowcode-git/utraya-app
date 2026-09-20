# Cookie Policy Utraya

> **Stato**: ✅ versione pubblicata
> **Versione documento**: `2026-05-16-1`
> **Data di entrata in vigore**: 2026-05-16
> **Hash canonico**: calcolato da `npm run legal:hash` su questo file.
> **Lingua sorgente**: italiano. Il testo italiano prevale in caso di discrepanza con la traduzione inglese.
> **Riferimenti normativi**: Reg. (UE) 2016/679 (GDPR), Direttiva 2002/58/CE (ePrivacy), D.Lgs. 196/2003 art. 122, Provv. Garante 10/06/2021 n. 231 ("Linee guida cookie e altri strumenti di tracciamento").

---

## 1. Cosa sono i cookie e gli strumenti di tracciamento

I cookie sono piccoli file di testo che un sito web salva sul tuo dispositivo (computer, smartphone, tablet) quando lo visiti. Alcuni cookie servono al sito per funzionare (es. mantenere la sessione di login), altri raccolgono informazioni su come navighi.

Oltre ai cookie, esistono **altri identificatori** simili (es. `localStorage`, `sessionStorage`, fingerprinting): per semplicità in questo documento parliamo di "cookie" come categoria generale, ma le stesse regole si applicano a tutti gli strumenti di tracciamento.

## 2. Tipologie di cookie usati su Utraya

In coerenza con il Provvedimento del Garante del 10 giugno 2021, classifichiamo i cookie in tre categorie:

- **Tecnici** — necessari per il funzionamento del sito. **Non richiedono consenso**.
- **Analitici** — raccolgono statistiche aggregate sull'uso del sito. Richiedono consenso, **salvo** quando completamente anonimizzati e gestiti dal titolare stesso (in quel caso possono essere assimilati ai tecnici).
- **Profilazione / marketing** — costruiscono profili dell'utente, sue preferenze, abitudini. **Richiedono sempre consenso esplicito**.

## 3. Cookie tecnici (essenziali e funzionali)

Sono i cookie senza i quali Utraya **non funziona**. Non richiedono consenso ai sensi dell'art. 122 D.Lgs. 196/2003.

| Nome cookie | Fornitore | Finalità | Durata |
|---|---|---|---|
| `sb-access-token` | Supabase (per conto del responsabile del trattamento) | Mantenere la sessione di login dell'utente | Sessione (fino a logout o scadenza JWT) |
| `sb-refresh-token` | Supabase (per conto del responsabile del trattamento) | Rinnovo automatico del token di accesso senza nuovo login | 7 giorni |
| `cf_consent` | Responsabile del trattamento | Memorizzare le tue scelte sul cookie banner (così non te lo mostriamo a ogni visita) | 6 mesi |
| `NEXT_LOCALE` | Responsabile del trattamento / next-intl | Ricordare la lingua scelta (italiano o inglese) | 1 anno |

**Nessuno di questi cookie** è usato per profilarti o tracciare il tuo comportamento al di fuori del sito.

## 4. Cookie analitici

**Stato attuale (versione `2026-05-16-1`)**: Utraya **non utilizza** cookie analitici di alcun tipo. Non è attivo Google Analytics, Plausible, Matomo o equivalenti.

Quando in futuro attiveremo strumenti analitici:

- preferiremo soluzioni **anonimizzate** che non richiedano consenso (es. anonimizzazione IP, no fingerprinting);
- se sarà necessario uno strumento che richiede consenso, lo aggiungeremo solo dopo il tuo opt-in esplicito sul cookie banner;
- aggiorneremo questa Cookie Policy bumpando la versione, e il cookie banner tornerà visibile per chiedere il nuovo consenso.

## 5. Cookie di profilazione e marketing

**Stato attuale (versione `2026-05-16-1`)**: Utraya **non utilizza** cookie di profilazione né strumenti di marketing/pubblicità. Nessun ritargeting, nessun pixel Facebook, nessuna integrazione adv.

Se in futuro introdurremo strumenti di questo tipo, sarà solo dopo il tuo **opt-in esplicito**, granulare per categoria, e potrai revocare il consenso in ogni momento.

## 6. Cookie di terze parti

I servizi di terze parti integrati in Utraya (vedi <https://utraya.com/legal/sub-processors>) possono impostare cookie propri:

- **Google Identity Services (login Google)**: quando clicchi "Accedi con Google", la pagina di Google può impostare i propri cookie tecnici di autenticazione. Sono cookie di Google, non di Utraya. Vedi <https://policies.google.com/technologies/cookies>.
- **YouTube embed**: Utraya **non** incorpora player YouTube nelle proprie pagine pubbliche. Se in futuro lo facessimo, useremmo la modalità `youtube-nocookie.com` per evitare cookie di terze parti senza consenso.
- **Vercel** (hosting): non imposta cookie identificativi di utenti finali.
- **Supabase** (auth): vedi sopra, sezione tecnici.

## 7. Come gestire e revocare il consenso

Puoi modificare le tue scelte in qualsiasi momento:

- Cliccando sul link **"Preferenze cookie"** nel footer di ogni pagina del sito. Si riapre il cookie banner e puoi cambiare le categorie attive.
- Cancellando manualmente i cookie dal tuo browser. La prossima visita ti verrà ripresentato il banner.
- Tramite le impostazioni del tuo browser (vedi link sotto). Ogni browser permette di bloccare in toto o selettivamente i cookie.

| Browser | Link guida ufficiale |
|---|---|
| Chrome | <https://support.google.com/chrome/answer/95647> |
| Firefox | <https://support.mozilla.org/it/kb/Gestione%20dei%20cookie> |
| Safari | <https://support.apple.com/it-it/HT201265> |
| Edge | <https://support.microsoft.com/it-it/microsoft-edge/eliminare-i-cookie-in-microsoft-edge-63947406-40ac-c3b8-57b9-2a946a29ae09> |

**Importante**: se blocchi tutti i cookie, **Utraya non potrà funzionare** (perché bloccheresti anche i cookie tecnici di autenticazione). Per impostazioni più fini, usa le preferenze nel banner.

## 8. Cosa succede se non accetti i cookie non essenziali

I cookie **tecnici** (vedi §3) sono indispensabili: senza di loro non puoi nemmeno fare login. Continueremo a impostarli perché non richiedono consenso normativo.

I cookie **non essenziali** (analitici non anonimi, profilazione, marketing) NON saranno impostati se non hai dato consenso. Puoi usare Utraya normalmente senza accettarli. Nessuna funzionalità di base ne dipende.

## 9. Modifiche alla Cookie Policy

Possiamo aggiornare questa Cookie Policy in qualsiasi momento, in particolare se introduciamo nuovi strumenti di terze parti o se cambia la normativa.

Quando l'aggiornamento è sostanziale (nuove categorie di cookie, nuovi fornitori, cambi di finalità), il **cookie banner tornerà visibile** e ti chiederà nuovamente il consenso prima di applicare le modifiche. Le tue scelte precedenti restano valide finché non viene chiesto nuovo consenso.

Versione corrente: vedi intestazione del documento.

## 10. Contatti

Per esercitare i tuoi diritti GDPR (accesso, rettifica, cancellazione, portabilità) o per qualsiasi domanda sulla gestione dei cookie:

- Email: privacy@utraya.com
- Responsabile del trattamento: Dario Bonini

Per reclami all'autorità di controllo:

- **Garante per la protezione dei dati personali**, Piazza Venezia 11, 00187 Roma — <https://www.garanteprivacy.it>.

## 11. Riferimenti normativi

- Regolamento (UE) 2016/679 (GDPR), in particolare artt. 6, 7, 13.
- Direttiva 2002/58/CE (ePrivacy).
- D.Lgs. 30 giugno 2003 n. 196 (Codice in materia di protezione dei dati personali), come modificato dal D.Lgs. 101/2018, art. 122.
- Provvedimento del Garante 10 giugno 2021 n. 231 ("Linee guida cookie e altri strumenti di tracciamento").
- Linee guida EDPB 05/2020 sul consenso.

---

# English version (best effort — non-binding)

> Italian text above prevails in case of discrepancy.

## 1. What cookies are

Cookies are small text files that a website saves on your device when you visit it. Some cookies are needed for the website to function (e.g. keeping you logged in), others collect data about your browsing behavior.

## 2. Categories of cookies used on Utraya

In line with the Italian Data Protection Authority's guidelines (10 June 2021), we classify cookies in three categories:

- **Technical** — required for the service to function. No consent required.
- **Analytics** — aggregate usage statistics. Consent required, unless fully anonymized.
- **Profiling / marketing** — build user profiles, track preferences, habits. Always require explicit consent.

## 3. Technical cookies (essential and functional)

| Cookie | Provider | Purpose | Duration |
|---|---|---|---|
| `sb-access-token` | Supabase (on behalf of the data processing responsible person) | Maintain user login session | Session |
| `sb-refresh-token` | Supabase (on behalf of the data processing responsible person) | Auto-renew access token | 7 days |
| `cf_consent` | Data processing responsible person | Remember your cookie banner choices | 6 months |
| `NEXT_LOCALE` | Data processing responsible person / next-intl | Remember your language preference | 1 year |

## 4. Analytics cookies

**Current status (version `2026-05-16-1`)**: Utraya does **not** use any analytics cookies.

## 5. Profiling and marketing cookies

**Current status (version `2026-05-16-1`)**: Utraya does **not** use profiling or marketing cookies.

## 6. Third-party cookies

Third-party services integrated in Utraya may set their own cookies. See <https://utraya.com/legal/sub-processors> for the full sub-processor list.

## 7. How to manage and revoke consent

You can change your choices anytime via the "Cookie preferences" link in the footer, or by clearing cookies in your browser settings.

## 8-11. (See Italian version above)

---

## Storia versioni

| Versione | Data | Modifiche principali |
|---|---|---|
| `2026-05-16-1` | 2026-05-16 | Prima versione pubblicata. Titolare: Dario Bonini Stato cookie: solo tecnici. No analytics, no profilazione. |
