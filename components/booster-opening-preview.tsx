"use client";

import { useRef, useState } from "react";
import { Boosters, type RevealCard } from "@/components/boosters";

const scenarios = [60, 800, 3000, 6000, "error"] as const;
const names = [
  "Kappa ancien",
  "Tanuki solaire",
  "Tengu des brumes",
  "Oni écarlate",
  "Kitsune céleste"
];
const rarities = ["C", "R", "SR", "SSR", "LR"] as const;

function cards(): RevealCard[] {
  const stamp = Date.now();
  return names.map((name, index) => ({
    id: `preview-${index}`,
    instanceId: `preview-${stamp}-${index}`,
    name,
    category: "Anime",
    anime: "Spirit Realm",
    rarity: rarities[index],
    image: "/assets/booster-pack.png"
  }));
}

export function BoosterOpeningPreview() {
  const [scenario, setScenario] = useState<(typeof scenarios)[number]>(60);
  const [draw, setDraw] = useState<RevealCard[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState("");
  const [measurement, setMeasurement] = useState("Prêt à mesurer.");
  const [resetKey, setResetKey] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  function choose(next: (typeof scenarios)[number]) {
    setScenario(next);
    setDraw([]);
    setRevealed(0);
    setError("");
    setMeasurement("Prêt à mesurer.");
    setResetKey(key => key + 1);
  }

  async function open() {
    const startedAt = performance.now();
    setError("");
    setMeasurement("Mesure en cours…");
    const observer = new MutationObserver(() => {
      if (!root.current?.querySelector(".yk-reveal-screen")) return;
      setMeasurement(
        `Première carte visible après ${Math.round(performance.now() - startedAt)} ms.`
      );
      observer.disconnect();
    });
    observer.observe(root.current!, { childList: true, subtree: true });
    await new Promise(resolve =>
      window.setTimeout(resolve, scenario === "error" ? 800 : scenario)
    );
    if (scenario === "error") {
      observer.disconnect();
      const message =
        "Simulation : session expirée. Le pack n’a pas été consommé.";
      setError(message);
      setMeasurement("Erreur simulée : retour à l’état normal.");
      throw new Error(message);
    }
    const result = cards();
    setDraw(result);
    setRevealed(0);
    return result;
  }

  return (
    <div ref={root} className="mt-8">
      <div className="flex flex-wrap gap-2" aria-label="Latence simulée">
        {scenarios.map(value => (
          <button
            key={value}
            type="button"
            aria-pressed={scenario === value}
            className={`yk-button ${scenario === value ? "yk-button-primary" : "yk-button-secondary"}`}
            onClick={() => choose(value)}
          >
            {value === "error" ? "Erreur" : `${value} ms`}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-2" role="status">
        Scénario :{" "}
        {scenario === "error" ? "erreur après 800 ms" : `${scenario} ms`} ·{" "}
        {measurement}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm text-danger-ink"
        >
          {error}
        </p>
      )}
      <Boosters
        key={resetKey}
        status={{ available: 3, maximum: 5, nextPackAt: 4_102_444_800_000 }}
        countdown="02:00"
        decisionStatus={{
          available: false,
          pending: [],
          nextPackAt: 4_102_444_800_000
        }}
        decisionCountdown="24:00:00"
        busy={false}
        draw={draw}
        drawKind="regular"
        collection={[]}
        revealed={revealed}
        onOpen={open}
        onKeepDecision={async () => 0}
        onDiscard={async () => {}}
        onReveal={index =>
          setRevealed(current => (current === index ? current + 1 : current))
        }
      />
    </div>
  );
}
