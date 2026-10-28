'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EMBED_PLAYER_ELEMENT_ID, seekEmbeddedPlayer } from '@/lib/utils/youtube-embed-control'
import type { TranscriptionViewModel } from '@/lib/view-models/transcription'

export interface VideoTranscriptLabels {
  title: string
  absent: string
  waitingForGeminiKey: string
  running: string
  runningNoProgress: string
  complete: string
  needsReview: string
  unavailable: string
  request: string
  requesting: string
  blockedGeminiKey: string
  integrationsLink: string
  doubtfulTime: string
  openOnYoutube: string
  jumpTo: string
  missingPartsOne: string
  missingPartsOther: string
  doubtfulOne: string
  doubtfulOther: string
  requestError: string
  noPhrases: string
}

interface VideoTranscriptPanelProps {
  videoId: string
  initial: TranscriptionViewModel
  labels: VideoTranscriptLabels
}

const POLL_INTERVAL_MS = 5_000
const MAX_AUTO_RESUMES = 3

/** Sostituisce i segnaposto `{nome}` di un testo già tradotto. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

/** Sceglie singolare/plurale di un testo con `{count}`. */
function plural(count: number, one: string, other: string): string {
  return fill(count === 1 ? one : other, { count })
}

/** Legge il view model dall'envelope API, o null se la risposta non è valida. */
async function readView(response: Response): Promise<{ view: TranscriptionViewModel | null; code: string | null }> {
  const body = await response.json().catch(() => null) as
    | { ok?: boolean; data?: unknown; error?: { code?: string } }
    | null
  return {
    view: body?.ok && body.data && typeof body.data === 'object' && 'state' in body.data ? body.data as TranscriptionViewModel : null,
    code: body?.error?.code ?? null,
  }
}

/** Pannello trascrizione: stato, pulsante "Trascrivi" e frasi con minuto. */
export default function VideoTranscriptPanel({ videoId, initial, labels }: VideoTranscriptPanelProps) {
  const [view, setView] = useState(initial)
  const [isRequesting, setIsRequesting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const resumes = useRef(0)
  const endpoint = `/api/videos/${videoId}/transcription`

  const requestTranscription = useCallback(async () => {
    setIsRequesting(true)
    setErrorMessage(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) {
        const { code } = await readView(response)
        setErrorMessage(code === 'GEMINI_KEY_REQUIRED' ? `${labels.blockedGeminiKey} ${labels.integrationsLink}` : labels.requestError)
        return
      }
      // Dopo la richiesta lo stato autorevole arriva dal GET (running oppure già disponibile se riusata).
      const statusResponse = await fetch(endpoint)
      const { view: next } = await readView(statusResponse)
      if (next) setView(next)
    } catch {
      setErrorMessage(labels.requestError)
    } finally {
      setIsRequesting(false)
    }
  }, [endpoint, labels.blockedGeminiKey, labels.integrationsLink, labels.requestError])

  const isRunning = view.state === 'running'
  const needsResume = view.needsResume

  useEffect(() => {
    if (!isRunning) return
    const timer = window.setInterval(async () => {
      try {
        const { view: next } = await readView(await fetch(endpoint))
        if (!next) return
        setView(next)
        // Un job fermo (lease scaduta) riprende con una nuova richiesta idempotente, per poche volte.
        if (next.state === 'running' && next.needsResume && resumes.current < MAX_AUTO_RESUMES) {
          resumes.current += 1
          await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        }
      } catch {
        // Il prossimo ciclo riprova.
      }
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isRunning, endpoint])

  useEffect(() => {
    if (isRunning && needsResume && resumes.current < MAX_AUTO_RESUMES) {
      resumes.current += 1
      void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined)
    }
  }, [isRunning, needsResume, endpoint])

  function jumpTo(seconds: number) {
    const frame = document.getElementById(EMBED_PLAYER_ELEMENT_ID) as HTMLIFrameElement | null
    if (seekEmbeddedPlayer(frame, seconds)) frame?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const statusText = view.state === 'waiting_for_key'
    ? labels.waitingForGeminiKey
    : view.state === 'running'
      ? view.progress
        ? fill(labels.running, { done: view.progress.doneParts, total: view.progress.totalParts })
        : labels.runningNoProgress
      : view.state === 'complete'
      ? labels.complete
      : view.state === 'needs_review'
        ? labels.needsReview
        : view.state === 'unavailable'
          ? labels.unavailable
          : labels.absent

  const blockedReason = view.requestBlockedReason === 'gemini_key_missing' ? labels.blockedGeminiKey : null

  return (
    <section className="bg-surface-container-lowest rounded-2xl p-5 sm:p-6 shadow-ambient space-y-4" aria-labelledby="video-transcript-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="video-transcript-title" className="font-headline text-lg font-bold text-on-surface">
          {labels.title}
          {view.languageCode ? <span className="ml-2 text-xs font-semibold uppercase text-on-surface-variant">{view.languageCode}</span> : null}
        </h2>
        {view.state === 'absent' && view.canRequest ? (
          <button
            type="button"
            onClick={requestTranscription}
            disabled={!view.canRequest || isRequesting}
            aria-describedby={blockedReason ? 'video-transcript-blocked' : undefined}
            className="min-h-11 px-5 rounded-full bg-on-surface text-surface font-semibold text-sm transition-all
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRequesting ? labels.requesting : labels.request}
          </button>
        ) : null}
      </div>

      <p className="text-sm text-on-surface-variant" role="status" aria-live="polite">{statusText}</p>
      {blockedReason ? (
        <p id="video-transcript-blocked" className="text-sm text-on-surface-variant">
          {blockedReason}{' '}
          <a href="/integrations" className="text-primary hover:underline">{labels.integrationsLink}</a>
        </p>
      ) : null}
      {errorMessage ? <p className="text-sm text-error" role="alert">{errorMessage}</p> : null}

      {view.state === 'needs_review' ? (
        <p className="text-xs text-on-surface-variant">
          {[
            view.doubtfulPhraseCount > 0 ? plural(view.doubtfulPhraseCount, labels.doubtfulOne, labels.doubtfulOther) : null,
            view.missingPartCount > 0 ? plural(view.missingPartCount, labels.missingPartsOne, labels.missingPartsOther) : null,
          ].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {(view.state === 'complete' || view.state === 'needs_review') ? (
        view.phrases.length === 0 ? (
          <p className="text-sm text-on-surface-variant">{labels.noPhrases}</p>
        ) : (
          <ol className="divide-y divide-transparent">
            {view.phrases.map((phrase) => (
              <li key={phrase.position} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3">
                <button
                  type="button"
                  onClick={() => jumpTo(phrase.startSeconds)}
                  aria-label={fill(labels.jumpTo, { time: phrase.timeLabel })}
                  className="min-h-11 min-w-14 text-left text-sm font-semibold tabular-nums text-secondary hover:underline"
                >
                  {phrase.timeLabel}
                  {phrase.isTimeDoubtful ? (
                    <span className="ml-0.5 text-on-surface-variant" title={labels.doubtfulTime} aria-label={labels.doubtfulTime}>?</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => jumpTo(phrase.startSeconds)}
                  className={`min-h-11 py-2.5 text-left text-sm leading-snug text-on-surface ${phrase.isTimeDoubtful ? 'italic opacity-80' : ''}`}
                >
                  {phrase.text}
                </button>
                <a
                  href={phrase.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={fill(labels.openOnYoutube, { time: phrase.timeLabel })}
                  title={fill(labels.openOnYoutube, { time: phrase.timeLabel })}
                  className="min-h-11 min-w-11 inline-flex items-center justify-center text-on-surface-variant hover:text-on-surface"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13.5 6H18v4.5M18 6l-7.5 7.5M10 6H7a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-3" />
                  </svg>
                </a>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  )
}
