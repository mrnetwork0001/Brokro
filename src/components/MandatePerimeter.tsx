/**
 * The mandate perimeter.
 *
 * A continuously running picture of the only thing Brokro does: a boundary
 * the owner signed, a sweep that tests every merchant against it, authorized
 * requests travelling inward to the agent core, refused ones thrown back out.
 *
 * Node verdicts are driven by the REAL merchant probes passed in, so the
 * picture is a view of live state rather than decoration.
 */

export interface PerimeterNode {
  label: string;
  priceLabel: string;
  authorized: boolean;
  /** Bearing in degrees, 0 = due north, clockwise. */
  bearing: number;
}

const CENTER = 250;
const PERIMETER_R = 168;

function polar(bearingDeg: number, radius: number): { x: number; y: number } {
  const rad = ((bearingDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}

export function MandatePerimeter({ nodes }: { nodes: PerimeterNode[] }) {
  // One sweep revolution is 7s; a node flares when the beam reaches its bearing.
  const sweepPeriod = 7;

  return (
    <svg
      className="perimeter"
      /* Padded viewBox: node labels sit outside the 500px ring and were
         being clipped at the left and right edges. */
      viewBox="-62 -16 624 556"
      role="img"
      aria-label="Live mandate perimeter: merchants tested against a signed spending boundary"
    >
      <defs>
        <radialGradient id="sweepGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(168, 75, 32, 0.20)" />
          <stop offset="70%" stopColor="rgba(168, 75, 32, 0.07)" />
          <stop offset="100%" stopColor="rgba(168, 75, 32, 0)" />
        </radialGradient>
        <radialGradient id="coreGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(168, 75, 32, 0.26)" />
          <stop offset="100%" stopColor="rgba(168, 75, 32, 0)" />
        </radialGradient>
      </defs>

      {/* Concentric rings */}
      <circle className="ring" cx={CENTER} cy={CENTER} r={56} />
      <circle className="ring-dashed" cx={CENTER} cy={CENTER} r={104} />
      <circle className="ring" cx={CENTER} cy={CENTER} r={210} />

      {/* The mandate boundary — the signed line */}
      <circle className="ring-mandate" cx={CENTER} cy={CENTER} r={PERIMETER_R} />

      {/* Cross hairs */}
      <line
        className="ring"
        x1={CENTER - 210}
        y1={CENTER}
        x2={CENTER + 210}
        y2={CENTER}
      />
      <line
        className="ring"
        x1={CENTER}
        y1={CENTER - 210}
        x2={CENTER}
        y2={CENTER + 210}
      />

      {/* Rotating test sector */}
      <g className="sweep">
        <path
          className="sweep-fan"
          d={`M ${CENTER} ${CENTER} L ${CENTER} ${CENTER - 210} A 210 210 0 0 1 ${
            CENTER + 210 * Math.sin((52 * Math.PI) / 180)
          } ${CENTER - 210 * Math.cos((52 * Math.PI) / 180)} Z`}
        />
        <line
          className="sweep-edge"
          x1={CENTER}
          y1={CENTER}
          x2={CENTER}
          y2={CENTER - 210}
        />
      </g>

      {/* Agent core */}
      <circle className="core-glow" cx={CENTER} cy={CENTER} r={44} fill="url(#coreGrad)" />
      <circle className="core-ring" cx={CENTER} cy={CENTER} r={21} />
      <circle cx={CENTER} cy={CENTER} r={6} fill="var(--copper)" />
      <text className="perim-label" x={CENTER + 30} y={CENTER + 4}>
        AGENT
      </text>

      {/* Inbound authorized requests */}
      <circle className="inbound in-a" />
      <circle className="inbound in-b" />
      <circle className="inbound in-c" />

      {/* Merchant nodes on the perimeter */}
      {nodes.map((n, i) => {
        const p = polar(n.bearing, PERIMETER_R);
        // Delay each node's flare to the moment the sweep crosses its bearing.
        const delay = ((n.bearing % 360) / 360) * sweepPeriod;
        const out = polar(n.bearing, PERIMETER_R + 14);
        const labelRight = p.x >= CENTER;

        return (
          <g key={i}>
            <circle
              className={`node-halo ${n.authorized ? "node-halo-ok" : "node-halo-no"} flare`}
              cx={p.x}
              cy={p.y}
              r={4}
              style={{ animationDelay: `${delay}s` }}
            />
            <circle
              className={`node-core ${n.authorized ? "node-ok" : "node-no"} ${
                n.authorized ? "pulse" : "repel"
              }`}
              cx={p.x}
              cy={p.y}
              style={
                {
                  animationDelay: `${delay}s`,
                  "--rx": `${(out.x - p.x).toFixed(1)}px`,
                  "--ry": `${(out.y - p.y).toFixed(1)}px`,
                } as React.CSSProperties
              }
            />
            <text
              className={`perim-label ${n.authorized ? "perim-label-ok" : "perim-label-no"}`}
              x={labelRight ? p.x + 11 : p.x - 11}
              y={p.y + 3.5}
              textAnchor={labelRight ? "start" : "end"}
            >
              {n.label}
            </text>
            <text
              className="perim-label"
              x={labelRight ? p.x + 11 : p.x - 11}
              y={p.y + 15}
              textAnchor={labelRight ? "start" : "end"}
              opacity={0.55}
            >
              {n.priceLabel}
            </text>
          </g>
        );
      })}

      {/* Boundary callout */}
      <g>
        <rect
          className="perim-tag-box"
          x={CENTER - 92}
          y={CENTER + PERIMETER_R + 24}
          width={184}
          height={24}
          rx={4}
        />
        <text
          className="perim-tag"
          x={CENTER}
          y={CENTER + PERIMETER_R + 40}
          textAnchor="middle"
        >
          SIGNED MANDATE BOUNDARY
        </text>
      </g>
    </svg>
  );
}
