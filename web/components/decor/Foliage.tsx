/**
 * Decorative foliage silhouettes for the layered hero foreground.
 *
 * Pure inline SVG generated from a handful of leaf primitives — no imagery is
 * invented about the property; these are abstract tropical fronds used only as
 * a depth-of-field frame around the real photograph. Always `aria-hidden` and
 * `pointer-events-none` so they never intercept taps or the tutorial.
 */

/** A pointed lens-shaped leaflet of length `l` and half-width `w`, rooted at the origin. */
const lens = (l: number, w: number) => `M0 0 Q ${l * 0.45} ${-w} ${l} 0 Q ${l * 0.45} ${w} 0 0 Z`

function Frond({
  angle,
  length = 300,
  leaflets = 16,
  droop = 0.3,
}: {
  angle: number
  length?: number
  leaflets?: number
  droop?: number
}) {
  const parts: JSX.Element[] = []
  for (let i = 1; i <= leaflets; i++) {
    const t = i / leaflets
    const x = t * length
    const y = droop * length * t * t
    const len = 26 + 78 * (1 - t * 0.6)
    const w = 6.5 * (1 - t * 0.35)
    const tangent = Math.atan2(2 * droop * length * t, length) * (180 / Math.PI)
    parts.push(
      <path key={`u${i}`} d={lens(len, w)} transform={`translate(${x} ${y}) rotate(${tangent - 52 + t * 18})`} />,
      <path key={`d${i}`} d={lens(len * 0.92, w)} transform={`translate(${x} ${y}) rotate(${tangent + 48 - t * 8})`} />,
    )
  }
  return (
    <g transform={`rotate(${angle})`}>
      <path
        d={`M0 0 Q ${length * 0.55} ${droop * length * 0.25} ${length} ${droop * length}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={4.5}
        strokeLinecap="round"
      />
      {parts}
    </g>
  )
}

/** A broad banana-style leaf: two lobes around a midrib. */
function BroadLeaf({ angle, length = 240, width = 62 }: { angle: number; length?: number; width?: number }) {
  return (
    <g transform={`rotate(${angle})`}>
      <path d={`M0 0 Q ${length * 0.35} ${-width} ${length} ${-width * 0.15} L ${length * 0.98} 0 L ${length} ${width * 0.15} Q ${length * 0.35} ${width} 0 0 Z`} />
      <path d={`M0 0 L ${length * 0.97} 0`} stroke="rgba(255,255,255,0.08)" strokeWidth={2} fill="none" />
    </g>
  )
}

/**
 * A corner cluster. `side="left"` grows from the bottom-left corner toward the
 * upper right; `side="right"` is its mirror image.
 */
export function FoliageCorner({ side, className = '' }: { side: 'left' | 'right'; className?: string }) {
  return (
    <svg
      viewBox="0 0 640 560"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      preserveAspectRatio="xMinYMax meet"
    >
      <g transform={side === 'right' ? 'translate(640 0) scale(-1 1)' : undefined}>
        <g transform="translate(-40 600)">
          <Frond angle={-82} length={420} leaflets={18} droop={0.22} />
          <Frond angle={-58} length={470} leaflets={20} droop={0.28} />
          <Frond angle={-30} length={400} leaflets={17} droop={0.34} />
          <BroadLeaf angle={-68} length={300} width={70} />
          <BroadLeaf angle={-44} length={330} width={78} />
          <Frond angle={-12} length={330} leaflets={14} droop={0.3} />
        </g>
      </g>
    </svg>
  )
}

/** A slim hanging branch for the top edge of the hero (mirrors with `flip`). */
export function FoliageBranch({ flip = false, className = '' }: { flip?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 520 260"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
      preserveAspectRatio="xMaxYMin meet"
    >
      <g transform={flip ? 'translate(520 0) scale(-1 1)' : undefined}>
        <g transform="translate(540 -30)">
          <Frond angle={132} length={360} leaflets={15} droop={-0.16} />
          <Frond angle={156} length={300} leaflets={12} droop={-0.1} />
          <BroadLeaf angle={118} length={230} width={54} />
        </g>
      </g>
    </svg>
  )
}
