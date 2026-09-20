/* Commento didattico:
 * Scopo del file: componente presentazionale condiviso per pagine legali markdown con header metadata e stile coerente.
 * Moduli richiamati: `react-markdown`, `remark-gfm`.
 * Flusso: riceve markdown + metadata e rende documento legale senza hardcode contenutistico in JSX.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function LegalMarkdownDocument(props: {
  title: string
  version: string
  effectiveDate: string
  hash: string
  markdown: string
}) {
  const shortHash = props.hash.replace('sha256:', '').slice(0, 16)

  return (
    <div className="bg-surface px-6 pb-24 pt-14">
      <article className="mx-auto max-w-5xl rounded-3xl bg-surface-container-low p-7 md:p-10">
        <header className="border-b border-outline-variant/50 pb-6">
          <h1 className="text-section-title text-on-surface md:text-5xl">{props.title}</h1>
          <p className="mt-3 text-legal-note">
            Versione {props.version} · In vigore dal {props.effectiveDate}
          </p>
          <p className="mt-1 text-legal-note">Hash documento: {shortHash}… (SHA-256)</p>
        </header>

        <div className="mt-8 space-y-6 text-[15px] leading-7 text-on-surface">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2 className="text-3xl font-bold tracking-tight">{children}</h2>,
              h2: ({ children }) => <h3 className="text-2xl font-bold tracking-tight">{children}</h3>,
              h3: ({ children }) => <h4 className="text-xl font-semibold tracking-tight">{children}</h4>,
              p: ({ children }) => <p className="text-on-surface">{children}</p>,
              li: ({ children }) => <li className="ml-5 list-disc text-on-surface">{children}</li>,
              a: ({ href, children }) => (
                <a href={href} className="underline decoration-1 underline-offset-4 hover:text-light-signal-orange" target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">{children}</table>
                </div>
              ),
              th: ({ children }) => <th className="border border-outline-variant/70 bg-surface-container px-3 py-2 text-left font-semibold">{children}</th>,
              td: ({ children }) => <td className="border border-outline-variant/70 px-3 py-2 align-top">{children}</td>,
              blockquote: ({ children }) => <blockquote className="border-l-4 border-light-signal-orange pl-4 text-on-surface-variant">{children}</blockquote>,
              hr: () => <hr className="border-outline-variant/60" />,
            }}
          >
            {props.markdown}
          </ReactMarkdown>
        </div>
      </article>
    </div>
  )
}
