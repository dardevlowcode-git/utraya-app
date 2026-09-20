/* Commento didattico:
 * Scopo del file: definisce una pagina o layout amministrativo, usato per operazioni di controllo e gestione avanzata.
 * Moduli richiamati: `next`, `next-intl/server`
 * Flusso: Questa pagina/layout richiama componenti e servizi: i dati arrivano da API o funzioni server, poi vengono passati alla UI per il rendering.
 */

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = { title: 'Admin' }

export default async function AdminAiProfilePage() {
  const t = await getTranslations()
  // In V1 this is a static prompt editor — no dynamic profile yet
  const defaultPrompt = `Sei un assistente AI specializzato nell'analisi di video YouTube.

Dato il trascritto e i metadati del video, fornisci un'analisi strutturata in italiano con i seguenti campi:

**short_summary**: Una singola frase che cattura l'essenza del video (max 150 caratteri).

**full_summary**: Un riassunto completo e dettagliato del contenuto (300-500 parole). Includi il contesto, i punti principali, le argomentazioni dell'autore e le conclusioni.

**general_category**: La categoria principale del video (es. "Tecnologia", "Finanza", "Scienza").

**subcategory**: Una sottocategoria più specifica (es. "Intelligenza Artificiale", "Investimenti", "Fisica quantistica").

**highlights_text**: I 5 momenti chiave del video, ciascuno con timestamp indicativo, nel formato:
"[MM:SS] Descrizione del momento chiave"

Rispondi SOLO con un oggetto JSON valido contenente questi campi. Non aggiungere altro testo.`

  return (
    <div className="p-8 max-w-3xl">
      <header className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 gradient-ai rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <div>
            <h1 className="font-headline text-3xl font-extrabold tracking-tight text-on-surface">
              {t('admin.aiProfile.title')}
            </h1>
            <p className="text-on-surface-variant text-sm">
              {t('admin.aiProfile.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient space-y-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-label-caps text-on-surface-variant">System Prompt</label>
            <span className="text-xs text-on-surface-variant bg-surface-container px-2 py-1 rounded-lg">
              Gemini 1.5 Pro
            </span>
          </div>
          <textarea
            defaultValue={defaultPrompt}
            rows={20}
            className="w-full bg-surface-container-low rounded-xl px-4 py-3 font-mono text-sm text-on-surface
                       focus:ring-2 focus:ring-tertiary focus:outline-none resize-y transition-all"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-on-surface-variant">
            {t('admin.aiProfile.promptNote')}
          </p>
          <button
            className="gradient-ai text-on-tertiary px-6 py-2.5 rounded-xl font-bold text-sm
                       hover:shadow-tertiary-glow transition-all active:scale-95"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
