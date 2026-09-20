/* Commento didattico:
 * Scopo del file: renderizzare un player YouTube resiliente con fallback host embed.
 * Moduli richiamati: `react`.
 * Flusso: prova prima `youtube-nocookie`, se il player non risulta caricato passa a `youtube.com`.
 */

'use client'

import { useEffect, useMemo, useState } from 'react'

interface VideoEmbedPlayerProps {
  youtubeVideoId: string
  title: string
}

/**
 * Mostra iframe YouTube con fallback automatico tra host embed per mitigare blocchi browser/privacy.
 */
export default function VideoEmbedPlayer({ youtubeVideoId, title }: VideoEmbedPlayerProps) {
  const sources = useMemo(
    () => [
      `https://www.youtube-nocookie.com/embed/${youtubeVideoId}`,
      `https://www.youtube.com/embed/${youtubeVideoId}`,
    ],
    [youtubeVideoId]
  )
  const [sourceIndex, setSourceIndex] = useState(0)
  const [hasLoaded, setHasLoaded] = useState(false)

  useEffect(() => {
    setSourceIndex(0)
    setHasLoaded(false)
  }, [youtubeVideoId])

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
      key={sources[sourceIndex]}
      src={sources[sourceIndex]}
      title={title}
      className="w-full h-full"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerPolicy="strict-origin-when-cross-origin"
      allowFullScreen
      onLoad={() => setHasLoaded(true)}
    />
  )
}
