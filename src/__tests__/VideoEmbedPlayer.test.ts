// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHydrated } from './client-render'
import VideoEmbedPlayer from '../app/(private)/video/[videoId]/VideoEmbedPlayer'

afterEach(() => {
  vi.useRealTimers()
})

describe('VideoEmbedPlayer', () => {
  it('avvia dal player privacy-enhanced per il video richiesto', () => {
    const markup = renderToStaticMarkup(createElement(VideoEmbedPlayer, {
      youtubeVideoId: 'video-123',
      title: 'Video di prova',
    }))

    expect(markup).toContain('src="https://www.youtube-nocookie.com/embed/video-123?enablejsapi=1"')
    expect(markup).toContain('title="Video di prova"')
  })

  it('resetta fallback e caricamento quando cambia video e ferma il timer dopo load', async () => {
    vi.useFakeTimers()
    const mounted = await renderHydrated(createElement(VideoEmbedPlayer, {
      youtubeVideoId: 'video-1',
      title: 'Video uno',
    }), { attachToDocument: false })

    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2200)
      })
      expect(mounted.container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube.com/embed/video-1?enablejsapi=1')

      await mounted.rerender(createElement(VideoEmbedPlayer, {
        youtubeVideoId: 'video-2',
        title: 'Video due',
      }))
      expect(mounted.container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/video-2?enablejsapi=1')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2200)
      })
      expect(mounted.container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube.com/embed/video-2?enablejsapi=1')

      await mounted.rerender(createElement(VideoEmbedPlayer, {
        youtubeVideoId: 'video-3',
        title: 'Video tre',
      }))
      const currentFrame = mounted.container.querySelector('iframe')!
      await act(async () => {
        currentFrame.dispatchEvent(new window.Event('load', { bubbles: true }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2200)
      })
      expect(mounted.container.querySelector('iframe')?.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/video-3?enablejsapi=1')
    } finally {
      await mounted.unmount()
    }
  })
})
