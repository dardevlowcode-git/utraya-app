# Security Policy — Utraya (utraya.com)

## API v1 — decisioni finding medi (2026-09-26, branch `preprod`)

### Token cancellazione account (`cancelUrl` / `cancelToken`)

- Il capability token HMAC (`ACCOUNT_DELETION_TOKEN_SECRET`, scadenza = fine grace
  period 30 giorni, verifica `timingSafeEqual`, transizione atomica
  `cancel_account_deletion`) viaggia nella **via preferita POST body**
  (`{ token }` su `/api/v1/account/cancel-deletion` e `/api/account/cancel-deletion`).
- Il client web first-party invia il token nel body; la risposta `DELETE /api/v1/account`
  espone anche `cancelToken` per i client mobili; le risposte del flusso hanno
  `Cache-Control: no-store`.
- Il token in **query string resta accettato per compatibilità legacy** (link già emessi,
  client esistenti): nessuna rottura di contratto a ridosso della verifica live.
- **Rischio residuo documentato**: i `cancelUrl` con token già emessi restano bearer fino a
  scadenza e possono finire in cronologia browser, access log o referrer se l'utente li apre
  o inoltra. Il token non è mai scritto in `app_logs`. Rimozione totale della query solo con
  migrazione client pianificata e finestra di deprecazione.

### Rate limiting API v1 e broker (best-effort, senza nuove dipendenze)

- `src/lib/security/rate-limit.ts`: finestra fissa in-memory per chiave, `429 RATE_LIMITED`
  con `Retry-After`. Copertura: broker OIDC per IP (12 req/min, prima della verifica
  crittografica) e mutazioni v1 per utente+route (60 req/min); le GET restano protette da
  Bearer + RLS/ownership.
- Su hosting serverless il contatore è per-istanza: è una protezione anti-burst, **non** un
  limite volumetrico distribuito.
- **Follow-up schedulato**: limite distribuito (Redis/Upstash o Edge) per broker OIDC/OTP,
  scan e integrazioni se l'abuso volumetrico diventa una minaccia osservata; motivazione:
  richiede infrastruttura fuori scope, nessuna dipendenza nuova è stata introdotta.

## Lingua / Language

Segnalazioni accettate in italiano e inglese.

## Versioni supportate

| Branch / Versione | Supportata |
| --- | --- |
| `main` (produzione, utraya.com) | Sì |
| `preprod` (preview.utraya.com) | Sì |
| Altri branch / vecchi tag | No — aggiornare a `main` prima di segnalare |

## Come segnalare una vulnerabilità (preferito)

Usa il **private vulnerability reporting** di GitHub:

1. Vai su `Security > Report a vulnerability` nel repo `dardevlowcode-git/utraya-app`.
2. Descrivi: URL coinvolto, passi per riprodurre, impatto, eventuale PoC.
3. Non aprire issue pubbliche, PR pubbliche o discussioni con dettagli della falla.

## Cosa includere

- Tipo di problema (XSS, open redirect, auth bypass, leak secret, ecc.)
- Dove (endpoint, file/riga se noto)
- Come riprodurlo in modo sicuro
- Impatto stimato (lettura dati, takeover account, ecc.)

## Cosa promettiamo

- Conferma di ricezione entro 3 giorni lavorativi.
- Valutazione iniziale entro 7 giorni lavorativi.
- Fix e disclosure coordinata: ti teniamo aggiornato, ti chiediamo di non
  divulgare prima del fix su `main`.
