/* Commento didattico:
 * Scopo del file: pagina admin del profilo di trascrizione (sostituisce la vecchia pagina AI profile statica).
 * Moduli richiamati: client Supabase admin, service transcription-profile e relativo editor client.
 * Flusso: la pagina protetta dall'AdminLayout legge profilo ed elenco modelli server-side e li passa all'editor.
 */

import type { Metadata } from 'next'
import AdminTranscriptionProfileClient from '@/components/admin/AdminTranscriptionProfileClient'
import { createAdminClient } from '@/lib/supabase/admin'
import { GEMINI_PRICING_URL, getTranscriptionProfile, listGeminiModels } from '@/lib/services/transcription-profile'

export const metadata: Metadata = { title: 'Admin — Profilo di trascrizione' }

export default async function AdminAiProfilePage() {
  const admin = createAdminClient()
  const [profile, models] = await Promise.all([getTranscriptionProfile(admin), listGeminiModels(admin)])
  return <AdminTranscriptionProfileClient profile={profile} models={models} pricingUrl={GEMINI_PRICING_URL} />
}
