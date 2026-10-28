"use client";

import { useState, type CSSProperties } from "react";
import "@/styles/lr-shiny-reveal.css";

// V7's seeded decorations are stable across server rendering and Replay.
let seed = 16413;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};
const stars = Array.from(
  { length: 64 },
  () =>
    ({
      left: `${random() * 100}%`,
      top: `${random() * 100}%`,
      width: `${1 + random() * 2.8}px`,
      height: `${1 + random() * 2.8}px`,
      "--twinkle": `${1.4 + random() * 2.6}s`,
      "--phase": `${-random() * 3}s`
    }) as CSSProperties
);
const warp = Array.from(
  { length: 25 },
  () =>
    ({
      "--angle": `${random() * 360}deg`,
      "--length": `${7 + random() * 9}vmax`,
      "--rush": `${1.2 + random() * 1.2}s`,
      "--phase": `${-random() * 2.4}s`
    }) as CSSProperties
);
const glints = Array.from(
  { length: 24 },
  () =>
    ({
      left: `${random() * 100}%`,
      top: `${random() * 100}%`,
      "--size": `${2 + random() * 4}px`,
      "--phase": `${-random() * 3.5}s`
    }) as CSSProperties
);
const pinkStreaks = Array.from(
  { length: 8 },
  () =>
    ({
      top: `${12 + random() * 76}%`,
      "--angle": `${-29 + random() * 54}deg`,
      "--speed": `${4.6 + random() * 2.8}s`,
      "--phase": `${-random() * 7}s`
    }) as CSSProperties
);

export function LrShinyScenery({ streaks }: { streaks: number[][] }) {
  const [closed, setClosed] = useState(false);
  const [travelled, setTravelled] = useState(false);
  return (
    <div className="yk-shiny-scene" aria-hidden="true">
      {!closed && (
        <div
          className="yk-shiny-prelude"
          onAnimationEnd={event => {
            if (event.animationName === "yk-shiny-crt-close") setClosed(true);
          }}
        >
          <div className="yk-shiny-pink-world" />
          <div className="yk-shiny-blackout" />
          <div className="yk-shiny-gold-world">
            <div className="yk-shiny-gold-image" />
            <div className="yk-shiny-gold-flash" />
            {streaks.map(([top, angle, duration, delay], index) => (
              <i
                key={index}
                className="yk-shiny-gold-streak"
                style={
                  {
                    top: `${top}%`,
                    "--angle": `${angle}deg`,
                    "--speed": `${duration}s`,
                    "--phase": `${delay}s`
                  } as CSSProperties
                }
              />
            ))}
            {Array.from({ length: 24 }, (_, index) => (
              <i
                key={`g${index}`}
                className="yk-shiny-gold-spark"
                style={{
                  left: `${(index * 37 + 19) % 100}%`,
                  top: `${(index * 23 + 34) % 100}%`,
                  animationDelay: `${8.1 + index * 0.091}s`
                }}
              />
            ))}
            {Array.from({ length: 50 }, (_, index) => (
              <i
                key={`c${index}`}
                className="yk-shiny-gold-confetti"
                style={
                  {
                    left: `${(index * 31 + 7) % 100}%`,
                    "--drift": `${((index % 7) - 3) * 17}px`,
                    animationDelay: `${8.1 + (index % 12) * 0.17}s`,
                    animationDuration: `${3.5 + (index % 5) * 0.4}s`
                  } as CSSProperties
                }
              />
            ))}
          </div>
          <div className="yk-shiny-shell yk-shiny-shell-ssr">
            <div className="yk-shiny-shell-travel">
              <div className="yk-shiny-shell-spin">
                <div className="yk-shiny-black-card">
                  <i className="yk-shiny-shell-glass" />
                </div>
              </div>
            </div>
          </div>
          <div className="yk-shiny-shell yk-shiny-shell-lr">
            <div className="yk-shiny-shell-travel">
              <div className="yk-shiny-shell-spin">
                <div className="yk-shiny-black-card">
                  <i className="yk-shiny-shell-glass" />
                </div>
              </div>
            </div>
          </div>
          <div className="yk-shiny-phosphor" />
        </div>
      )}
      {!travelled && (
        <div
          className="yk-shiny-cosmos"
          onAnimationEnd={event => {
            if (event.animationName === "yk-shiny-nebula") setTravelled(true);
          }}
        >
          <div className="yk-shiny-nebula" />
          <div className="yk-shiny-stars">
            {stars.map((style, index) => (
              <i key={index} style={style} />
            ))}
          </div>
          <div className="yk-shiny-warp">
            {warp.map((style, index) => (
              <i key={index} style={style} />
            ))}
          </div>
        </div>
      )}
      <div className="yk-shiny-rose-world">
        <div className="yk-shiny-rose-tone" />
        <div className="yk-shiny-rose-glaze" />
        <div className="yk-shiny-rose-dots" />
        <div className="yk-shiny-glints">
          {glints.map((style, index) => (
            <i key={index} style={style} />
          ))}
        </div>
        <div className="yk-shiny-streaks">
          {pinkStreaks.map((style, index) => (
            <i key={index} style={style} />
          ))}
        </div>
        <div className="yk-shiny-rose-edge" />
      </div>
      <div className="yk-shiny-relight">
        <i className="yk-shiny-energy-ball" />
        <i className="yk-shiny-energy-bloom" />
        <i className="yk-shiny-tv-noise" />
      </div>
    </div>
  );
}
