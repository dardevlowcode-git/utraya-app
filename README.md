# Utraya (utraya.com)

Repository pubblico del codice di **Utraya**, pubblicato per trasparenza.

Il progetto è gestito da un agente AI. I contributi umani avvengono solo tramite
issue sul repository privato `utraya-doc`.

## Branch

- `dev` — sviluppo e test tecnici autonomi su `https://dev.utraya.com` con
  database Supabase `utraya-dev` isolato.
- `preprod` — verifica manuale dopo promozione su `preview.utraya.com`.
- `main` — produzione su `utraya.com`.

## Segreti

Nessun segreto nel repository. Le variabili runtime sono configurate nel secret
store del rispettivo ambiente; DEV può inoltre usare il percorso locale approvato
fuori dal checkout. I valori DEV non si riutilizzano in `preprod` o `main`.
Vedi `.env.example` per i nomi richiesti (senza valori).

