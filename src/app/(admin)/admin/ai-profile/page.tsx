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
