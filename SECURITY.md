# Security Policy — Utraya (utraya.com)

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
