/* Commento didattico:
 * Scopo del file: visual hero orbitale per il marketing site, costruito in SVG + CSS senza dipendenze esterne.
 * Moduli richiamati: nessun import esterno: il file usa logica locale o sole primitive del linguaggio.
 * Flusso: il componente riceve etichette localizzate e renderizza una composizione orbitale con fallback statico.
 */

type HeroOrbitalProps = {
  ariaLabel: string
  centerLabel: string
  nodes: string[]
}

const NODE_POSITIONS = [
  { x: 280, y: 58 },
  { x: 430, y: 120 },
  { x: 502, y: 280 },
  { x: 430, y: 438 },
  { x: 280, y: 502 },
  { x: 130, y: 438 },
  { x: 58, y: 280 },
  { x: 130, y: 120 },
]

export default function HeroOrbital({ ariaLabel, centerLabel, nodes }: HeroOrbitalProps) {
  return (
    <figure className="relative mx-auto hidden w-full max-w-[560px] lg:block" role="img" aria-label={ariaLabel}>
      <svg viewBox="0 0 560 560" className="h-auto w-full">
        <defs>
          <radialGradient id="orbitalBg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--color-surface-container-lowest))" />
            <stop offset="100%" stopColor="rgb(var(--color-surface))" />
          </radialGradient>
        </defs>

        <circle cx="280" cy="280" r="264" fill="url(#orbitalBg)" />
        <circle cx="280" cy="280" r="220" fill="none" stroke="rgb(var(--color-inverse-primary))" strokeOpacity="0.25" strokeWidth="1.5" />
        <circle cx="280" cy="280" r="156" fill="none" stroke="rgb(var(--color-inverse-primary))" strokeOpacity="0.18" strokeWidth="1.25" />

        <g className="orbital-spin-slow origin-center">
          {NODE_POSITIONS.map((position, index) => (
            <g key={position.x + position.y}>
              <line
                x1="280"
                y1="280"
                x2={position.x}
                y2={position.y}
                stroke="rgb(var(--color-inverse-primary))"
                strokeOpacity="0.2"
                strokeWidth="1"
              />
              <circle cx={position.x} cy={position.y} r="24" fill="rgb(var(--color-surface-container-lowest))" />
              <circle cx={position.x} cy={position.y} r="23" fill="none" stroke="rgb(var(--color-outline-variant))" strokeWidth="1.5" />
              <text
                x={position.x}
                y={position.y + 36}
                textAnchor="middle"
                className="fill-on-surface-variant text-[11px] font-semibold"
              >
                {nodes[index]}
              </text>
            </g>
          ))}
        </g>

        <g>
          <circle cx="280" cy="280" r="56" fill="rgb(var(--color-primary))" />
          <circle cx="280" cy="280" r="54" fill="none" stroke="rgb(var(--color-inverse-primary))" strokeOpacity="0.5" strokeWidth="1.5" />
          <text x="280" y="286" textAnchor="middle" className="fill-white text-[16px] font-bold tracking-wide">
            {centerLabel}
          </text>
        </g>
      </svg>
    </figure>
  )
}
