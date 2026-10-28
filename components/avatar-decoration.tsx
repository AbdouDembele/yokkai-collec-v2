import type { CSSProperties, ReactNode } from "react";

// Matching path commands let CSS interpolate the filaments rather than rotate
// the whole frame. Coordinates are deterministic so server/client markup agrees.
const shadowTendrils = Array.from({ length: 32 }, (_, i) => {
  const angle = (i * Math.PI) / 16;
  const point = (radius: number, offset: number) =>
    `${(50 + Math.cos(angle + offset) * radius).toFixed(2)} ${(50 + Math.sin(angle + offset) * radius).toFixed(2)}`;
  const shape = (curl: number) =>
    `M${point(37.5, -0.035)} C${point(43 + (i % 3), -0.15 * curl)} ${point(46 + (i % 5), 0.2 * curl)} ${point(47 + ((i * 7) % 9), -0.08 * curl)} Q${point(43, 0.21 * curl)} ${point(38.5, 0.045)} Z`;
  return (
    <path
      key={i}
      className="yk-avatar-tendril"
      d={shape(1)}
      style={
        {
          "--tendril-rest": `path("${shape(1)}")`,
          "--tendril-curl": `path("${shape(-1.2)}")`,
          "--part-duration": `${2.1 + (i % 7) * 0.23}s`,
          "--part-delay": `${-i * 0.29}s`
        } as CSSProperties
      }
      fill={i % 5 === 0 ? "#26313b" : "#080b11"}
      stroke={i % 3 === 0 ? "#c3ced5" : "#62717e"}
      strokeWidth={i % 3 === 0 ? ".45" : ".3"}
    />
  );
});

function DecorationMotes({ frame }: { frame: string }) {
  const falling = ["bloom", "sakura", "roses"].includes(frame);
  const rising = ["flame", "fox", "bloodmoon", "electric"].includes(frame);
  if (
    !falling &&
    !rising &&
    !["royal", "crystal", "lunar", "pixel", "ocean"].includes(frame)
  )
    return null;
  return (
    <g
      className={`yk-avatar-motes ${falling ? "yk-avatar-petals" : rising ? "yk-avatar-embers" : "yk-avatar-stars"}`}
    >
      {Array.from({ length: 6 }, (_, i) => {
        const angle = (i * Math.PI) / 3 + 0.3;
        const x = 50 + Math.cos(angle) * 42;
        const y = 50 + Math.sin(angle) * 42;
        return (
          <path
            key={i}
            className="yk-avatar-mote"
            d={
              falling
                ? `M${x} ${y}q-5-4-3-7 6 0 6 4 0 3-3 3Z`
                : `M${x} ${y - 2.5}l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z`
            }
            fill="currentColor"
            style={
              {
                "--part-delay": `${-i * 0.73}s`,
                "--part-duration": `${3.2 + (i % 3) * 0.6}s`
              } as CSSProperties
            }
          />
        );
      })}
    </g>
  );
}

const petal = (x: number, y: number, size: number, angle: number) => (
  <g
    transform={`translate(${x} ${y}) rotate(${angle}) scale(${size})`}
    style={
      {
        "--decoration-shape-transform": `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${size})`
      } as CSSProperties
    }
  >
    {[0, 72, 144, 216, 288].map(a => (
      <ellipse
        key={a}
        cx="0"
        cy="-5"
        rx="3.8"
        ry="5.5"
        transform={`rotate(${a})`}
        style={
          { "--decoration-shape-transform": `rotate(${a}deg)` } as CSSProperties
        }
        fill="#ffb8d8"
        stroke="#d969a4"
        strokeWidth=".6"
      />
    ))}
    <circle r="2.5" fill="#ffe4a3" />
  </g>
);
const decorations: Record<string, ReactNode> = {
  orbit: (
    <>
      <circle
        cx="50"
        cy="50"
        r="39"
        stroke="#a7c8ff"
        strokeWidth="1.5"
        strokeDasharray="80 14 6 14"
      />
      <ellipse
        cx="50"
        cy="50"
        rx="45"
        ry="37"
        stroke="#c4d9ff"
        strokeWidth="1"
        strokeDasharray="10 9"
      />
      <circle cx="88" cy="28" r="3" fill="#e5f0ff" />
      <circle cx="18" cy="76" r="2" fill="#abcaff" />
    </>
  ),
  crystal: (
    <>
      <path
        d="m50 5 28 10 17 35-17 35-28 10-28-10L5 50l17-35Z"
        stroke="#9dcfff"
        strokeWidth="1.8"
      />
      <path
        d="m50 5 4 7-4 7-4-7Zm40 38 5 7-5 7-4-7ZM50 81l4 7-4 7-4-7ZM10 43l5 7-5 7-5-7Z"
        fill="#d4eeff"
      />
      <circle cx="50" cy="50" r="40" stroke="#80b6ed" strokeWidth="1" />
    </>
  ),
  bloom: (
    <>
      <circle cx="50" cy="50" r="40" stroke="#f398c9" strokeWidth="1.6" />
      {petal(21, 22, 0.65, 12)}
      {petal(83, 72, 0.65, 25)}
      {petal(31, 88, 0.5, 0)}
      <path d="m74 12 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#ffcee6" />
    </>
  ),
  flame: (
    <>
      <path
        d="M22 14q-8 15-7 24L7 31q-5 19 8 31l-8-2q8 29 34 32-15-11-18-20M77 15q8 14 7 24l9-9q5 20-8 32l9-3q-7 29-34 33 16-11 18-20"
        fill="#df8e58"
        fillOpacity=".5"
        stroke="#ffca97"
        strokeWidth="1.8"
      />
      <path
        d="M13 46q-3 20 12 30m62-30q3 20-12 30"
        stroke="#ffe5b2"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </>
  ),
  cat: (
    <>
      <path
        d="M18 30 13 3Q30 5 37 18M63 18Q70 5 87 3L82 30"
        fill="#374155"
        stroke="#a7b5cf"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="m19 11 3 14 9-7M81 11l-3 14-9-7"
        fill="#f7a9c8"
        stroke="#d878a6"
        strokeWidth="1"
      />
      <path
        d="M18 31a39 39 0 1 0 64 0"
        fill="none"
        stroke="#697a9c"
        strokeWidth="3"
      />
      <path
        d="M19 80q12 13 30 11M81 80Q69 93 51 91"
        fill="none"
        stroke="#ffb8d8"
        strokeWidth="4"
      />
      <path
        d="M49 91c-14-14-18-4-16 1s10 6 16 1m2-2c14-14 18-4 16 1s-10 6-16 1"
        fill="#f49ac1"
        stroke="#ffcee5"
        strokeWidth="1.5"
      />
      <circle cx="50" cy="91" r="4" fill="#ffe0ec" />
    </>
  ),
  royal: (
    <>
      <circle
        cx="50"
        cy="52"
        r="39"
        fill="none"
        stroke="#e4b95d"
        strokeWidth="3"
      />
      <circle
        cx="50"
        cy="52"
        r="42"
        fill="none"
        stroke="#f7e3aa"
        strokeWidth=".8"
        strokeDasharray="2 4"
      />
      <path
        d="m28 19-3-15 13 9L50 0l12 13 13-9-3 15-4 8H32Z"
        fill="#edc56a"
        stroke="#fff0b9"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M33 21h34" stroke="#b77937" strokeWidth="2" />
      <path d="m50 8 4 6-4 6-4-6Z" fill="#ee86b0" />
      <path
        d="m10 49 4 6-4 6-4-6m84-12 4 6-4 6-4-6M50 88l4 6-4 6-4-6"
        fill="#f3ce7e"
        stroke="#fff1c5"
        strokeWidth="1"
      />
    </>
  ),
  sakura: (
    <>
      <path
        d="M24 20C0 42 8 73 30 86M76 20c24 22 16 53-6 66"
        fill="none"
        stroke="#937297"
        strokeWidth="2.5"
      />
      <path
        d="m12 37-9-2q2 10 10 10m72 19 12-1q-4 10-12 7M29 87l-7 10q12-1 16-8"
        fill="#8bbda7"
        stroke="#bce3c8"
        strokeWidth="1"
      />
      {petal(20, 22, 1, 10)}
      {petal(8, 58, 0.7, 35)}
      {petal(77, 21, 0.8, 15)}
      {petal(87, 66, 1, 35)}
      {petal(53, 92, 0.7, 0)}
    </>
  ),
  wings: (
    <>
      <circle
        cx="50"
        cy="49"
        r="38"
        fill="none"
        stroke="#b0c8ef"
        strokeWidth="1.5"
      />
      <g
        fill="#dae7fc"
        stroke="#95b4de"
        strokeWidth="1.2"
        strokeLinejoin="round"
      >
        <path
          className="yk-avatar-wing-left"
          d="M20 70Q2 56 1 34q16 5 19 23L8 47q1 17 18 24L11 61q5 15 20 17Z"
        />
        <path
          className="yk-avatar-wing-right"
          d="M80 70q18-14 19-36-16 5-19 23l12-10q-1 17-18 24l15-10q-5 15-20 17Z"
        />
      </g>
      <ellipse
        cx="50"
        cy="9"
        rx="18"
        ry="5"
        fill="none"
        stroke="#ffe6a0"
        strokeWidth="2.5"
      />
      <path d="m50 82 3 7 8 2-8 2-3 7-3-7-8-2 8-2Z" fill="#fff0ba" />
    </>
  ),
  electric: (
    <>
      <circle
        className="yk-avatar-energy-ring"
        cx="50"
        cy="50"
        r="41"
        fill="none"
        stroke="#b5a0ff"
        strokeWidth="2"
        strokeDasharray="48 10 7 10"
      />
      <path
        d="m21 12-9 20 10-3-7 22M80 8l5 18-9-1 10 20M82 77l-4 12-17 5M22 79l-9-8-3-13"
        fill="none"
        stroke="#dcceff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m85 46 8 7-7 6 9 6M35 8l8-5 10 3M46 94l8 3 8-5"
        fill="none"
        stroke="#aa82ff"
        strokeWidth="2"
      />
      <path d="m29 86 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#e5d7ff" />
    </>
  ),
  fox: (
    <>
      <path
        d="M18 34 6 3q24 4 32 18M62 21Q70 7 94 3L82 34"
        fill="#dd843e"
        stroke="#ffd2a0"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="m13 12 9 16 8-5M87 12l-9 16-8-5" fill="#493442" />
      <path
        d="M15 37a40 40 0 0 0 64 44Q98 66 91 48q-4 16-15 20 1 17-22 22-25 7-36-18"
        fill="none"
        stroke="#e99c56"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M91 48q-4 16-15 20"
        stroke="#ffecd7"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path d="m10 54 2-5 3 5-3 4m77 26 2-5 3 5-3 4" fill="#a3d9f2" />
      <path d="M45 7q5-9 10 0-5 10-10 0Z" fill="#ffd598" />
    </>
  ),
  roses: (
    <>
      <path
        d="M17 26Q-3 56 25 83m58-57q20 30-8 57M25 83q25 17 50 0"
        stroke="#7ca889"
        strokeWidth="2"
      />
      <path
        d="m12 41-9-5q0 12 10 13m74 18 10-7q0 14-10 15M34 88l-8 9q13 1 16-8"
        fill="#83b89c"
        stroke="#c4ddac"
        strokeWidth="1"
      />
      {[
        { x: 18, y: 23 },
        { x: 82, y: 23 },
        { x: 16, y: 75 },
        { x: 84, y: 75 },
        { x: 50, y: 93 }
      ].map(({ x, y }) => (
        <g key={x + ":" + y}>
          <path
            d={`M${x - 8} ${y}q-3-9 6-9 8-6 12 2 7 5 0 11-3 8-11 5-10 0-7-9Z`}
            fill="#bf4774"
            stroke="#ffadc5"
            strokeWidth="1.2"
          />
          <path
            d={`M${x - 4} ${y + 2}q-4-9 5-8 8 2 2 7-8 5-6-2 3-5 7-1`}
            fill="none"
            stroke="#ffcbda"
            strokeWidth="1.3"
          />
        </g>
      ))}
    </>
  ),
  lunar: (
    <>
      <circle
        cx="50"
        cy="51"
        r="40"
        stroke="#a49fdf"
        strokeWidth="1.5"
        strokeDasharray="2 4"
      />
      <path
        d="M28 13C-7 32 0 81 38 91 10 65 10 37 28 13Z"
        fill="#bab0ed"
        stroke="#ece2ff"
        strokeWidth="1.3"
      />
      <path
        d="m72 9 2.7 6.5L82 17l-6 4.5 1 7.5-6-4-6 4 1-7.5-6-4.5 7.3-1.5Zm17 32 2 5 6 1-5 4 1 6-5-3-5 3 1-6-5-4 6-1ZM65 79l3 7 8 2-7 4-1 8-5-6-8 1 4-7-3-7 7 2Z"
        fill="#ffe8ac"
        stroke="#fff5db"
        strokeWidth=".6"
      />
      <circle cx="46" cy="7" r="2" fill="#fff3d2" />
      <circle cx="91" cy="72" r="1.7" fill="#e4d4ff" />
    </>
  ),
  dragon: (
    <>
      <path
        d="M75 20Q95 31 91 61 84 91 50 94 16 92 9 65 4 43 17 26"
        fill="none"
        stroke="#466477"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M75 20Q95 31 91 61 84 91 50 94 16 92 9 65 4 43 17 26"
        fill="none"
        stroke="#a3d2c8"
        strokeWidth="3"
        strokeDasharray="3 5"
      />
      <path
        d="m12 38-10-4 7 16m80 13 9 4-13 7M35 92l-3 7 13-5M12 67l-8 7 13 4"
        fill="#a7c8ae"
      />
      <path
        d="M61 24 52 17l9-9 12 2 11 10-11 7Z"
        fill="#7eb9ac"
        stroke="#d0ecda"
        strokeWidth="1.8"
      />
      <path
        d="m61 9-2-8 8 8m7 2 6-8-1 13M80 21l12 3-5 4"
        fill="none"
        stroke="#e8d4a0"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="m65 16 6 1-3 3Z" fill="#ffe3a4" />
      <path
        d="M54 18q-10-5-15-1m42 9q8 9 14 7"
        stroke="#c8e5cf"
        strokeWidth="1.3"
      />
    </>
  ),
  ocean: (
    <>
      <path
        d="M14 33Q-4 54 14 78q20 23 50 14 23-7 28-29-12 12-17 9 20-12 13-31-1 15-14 18 10-20 2-27"
        fill="none"
        stroke="#72cbd8"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M11 68q2 24 36 25 31 2 42-25-11 8-22 3-9-5-2-11-19 5-17 17-11-9-21-2 1-12-16-7Z"
        fill="#408db1"
        stroke="#c4f1e8"
        strokeWidth="1.5"
      />
      <path
        d="M26 87q17-10 31-2 13 7 25-8"
        fill="none"
        stroke="#d8f8ee"
        strokeWidth="2"
      />
      <path d="m27 8 2 5 6 1-4 4 1 6-5-3-5 3 1-6-4-4 6-1Z" fill="#ffcfb1" />
      <circle cx="10" cy="48" r="3" stroke="#b7ecf0" />
      <circle cx="84" cy="20" r="3" stroke="#b7ecf0" />
      <circle cx="92" cy="34" r="1.5" fill="#d2f3f2" />
    </>
  ),
  pixel: (
    <>
      <path
        d="M29 9H15v9H6v19M71 9h14v9h9v19M6 63v19h9v9h14m42 0h14v-9h9V63"
        stroke="#b6a3ff"
        strokeWidth="4"
        strokeLinejoin="miter"
      />
      <path
        d="M24 16H16v8H9m67-8h8v8h7M9 76h7v8h8m52 0h8v-8h7"
        stroke="#7ae2dd"
        strokeWidth="2"
      />
      <path
        d="M39 3h7v6h8V3h7v13h-7v7h-8v-7h-7Z"
        fill="#fa8fbb"
        stroke="#ffcade"
        strokeWidth="1"
      />
      <path d="M39 87h7v-7h8v7h7v7h-7v6h-8v-6h-7Z" fill="#b8a2ff" />
      <path d="M1 48h8v8H1m90-8h8v8h-8" fill="#85d8de" />
    </>
  ),
  bloodmoon: (
    <>
      <circle cx="50" cy="50" r="40" stroke="#390c19" strokeWidth="5" />
      <path
        className="yk-avatar-moon-body"
        d="M67 9C24-5-3 38 14 70q16 29 51 21C27 88 9 32 67 9Z"
        fill="#a71930"
        stroke="#ef4e58"
        strokeWidth="1"
      />
      <path
        className="yk-avatar-moon-edge"
        d="M63 9C18 7 1 54 26 80l10 9M50 10l-11 5-3 7-10 4-1 9-8 9 5 8-2 11 8 8"
        fill="none"
        stroke="#ffe5dc"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        className="yk-avatar-moon-current"
        cx="50"
        cy="50"
        r="42"
        stroke="#ef364a"
        strokeWidth="1.1"
        strokeDasharray="43 17 7 21 31 12"
      />
      {Array.from({ length: 9 }, (_, i) => (
        <path
          key={i}
          className="yk-avatar-moon-shard"
          d={`M${18 + (i % 3) * 4} ${18 + i * 7}l-5 5 3 6-1-5Z`}
          fill={i % 3 === 0 ? "#fff0e8" : "#ee4252"}
          style={
            {
              "--part-delay": `${-i * 0.31}s`,
              "--part-duration": `${2.4 + (i % 3) * 0.4}s`
            } as CSSProperties
          }
        />
      ))}
    </>
  ),
  shadow: (
    <>
      <circle
        cx="50"
        cy="50"
        r="38.5"
        fill="none"
        stroke="#10151e"
        strokeWidth="4"
      />
      {shadowTendrils}
    </>
  ),
  rage: (
    <>
      <circle
        className="yk-avatar-rage-ring"
        cx="50"
        cy="50"
        r="41"
        stroke="#ed5764"
        strokeWidth="2.5"
        strokeDasharray="80 25 30 20"
      />
      <circle
        className="yk-avatar-rage-ring yk-avatar-rage-ring-outer"
        cx="50"
        cy="50"
        r="45"
        stroke="#b92743"
        strokeWidth="1.5"
        strokeDasharray="49 18 6 14"
      />
      <g
        className="yk-avatar-rage-mark"
        stroke="#ff5b64"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <path d="M75 3q0 10-8 10M84 3q0 10 8 10M68 22q8 0 8 9M92 22q-8 0-8 9" />
      </g>
      <g className="yk-avatar-rage-bubble">
        <path
          d="M6 70q-5 13 8 17l10-5 7 2-2-9q-4-12-15-11Z"
          fill="#fff5ef"
          stroke="#262334"
          strokeWidth="1.3"
        />
        <path
          d="m17 69 2 10m1 4v.5"
          stroke="#322131"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      </g>
    </>
  )
};

const motion: Record<string, string> = {
  orbit: "spin",
  crystal: "shimmer",
  bloom: "sway",
  flame: "flare",
  cat: "twitch",
  royal: "float",
  sakura: "sway",
  wings: "float",
  electric: "spark",
  fox: "twitch",
  roses: "sway",
  lunar: "float",
  dragon: "sway",
  ocean: "wave",
  pixel: "pixel",
  bloodmoon: "flare",
  shadow: "shadow",
  rage: "rage"
};

export function AvatarDecoration({ frame }: { frame?: string }) {
  const artwork = frame ? decorations[frame] : undefined;
  if (!artwork) return null;
  return (
    <svg
      className={`yk-avatar-decoration yk-avatar-decoration-${frame}`}
      data-avatar-decoration={frame}
      data-avatar-motion={frame ? motion[frame] : undefined}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <g className="yk-avatar-decoration-art">{artwork}</g>
      {frame && <DecorationMotes frame={frame} />}
      <circle
        className="yk-avatar-decoration-glint"
        cx="50"
        cy="50"
        r="40"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeDasharray="2 85"
        opacity=".7"
      />
    </svg>
  );
}
