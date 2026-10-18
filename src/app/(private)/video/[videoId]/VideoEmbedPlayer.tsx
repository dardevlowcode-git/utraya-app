/* Commento didattico:
 * Scopo del file: renderizzare un player YouTube resiliente con fallback host embed.
 * Moduli richiamati: `react`.
 * Flusso: prova prima `youtube-nocookie`, se il player non risulta caricato passa a `youtube.com`.
 */

'use client'

import { useEffect, useMemo, useState } from 'react'
import { EMBED_LISTENING_MESSAGE, EMBED_PLAYER_ELEMENT_ID } from '@/lib/utils/youtube-embed-control'

interface VideoEmbedPlayerProps {
  youtubeVideoId: string
  title: string
}

/**
 * Mostra iframe YouTube con fallback automatico tra host embed per mitigare blocchi browser/privacy.
 */
export default function VideoEmbedPlayer({ youtubeVideoId, title }: VideoEmbedPlayerProps) {
  return <VideoEmbedPlayerInstance key={youtubeVideoId} youtubeVideoId={youtubeVideoId} title={title} />
}

/** Mantiene lo stato del fallback limitato all'identificativo YouTube corrente. */
function VideoEmbedPlayerInstance({ youtubeVideoId, title }: VideoEmbedPlayerProps) {
  const sources = useMemo(
    () => [
      `https://www.youtube-nocookie.com/embed/${youtubeVideoId}?enablejsapi=1`,
      `https://www.youtube.com/embed/${youtubeVideoId}?enablejsapi=1`,
    ],
    [youtubeVideoId]
  )
  const [sourceIndex, setSourceIndex] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    if (hasLoaded) return
    if (sourceIndex >= sources.length - 1) return

    const timer = window.setTimeout(() => {
      setSourceIndex((current) => Math.min(current + 1, sources.length - 1))
    }, 2200)

    return () => window.clearTimeout(timer)
  }, [hasLoaded, sourceIndex, sources.length])

  return (
    <iframe
      id={EMBED_PLAYER_ELEMENT_ID}
      key={sources[sourceIndex]}
      src={sources[sourceIndex]}
      title={title}
      className="w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      onLoad={(event) => {
        setHasLoaded(true)
        // Handshake per accettare i comandi postMessage (salto al secondo dalle frasi).
        const frame = event.currentTarget
        try {
          frame.contentWindow?.postMessage(EMBED_LISTENING_MESSAGE, new URL(frame.src).origin)
        } catch {
          // Il player resta usabile anche senza controllo dalla pagina.
        }
      }}
    />
  )
}
