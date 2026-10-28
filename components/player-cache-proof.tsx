"use client";

import { useState } from "react";
import {
  createPlayerSnapshotCache,
  PLAYER_SNAPSHOT_TTL
} from "@/lib/data/player-state";

type Counts = { balance: number; collection: number };

class CacheProofHarness {
  private clock = 0;
  private counts: Counts = { balance: 0, collection: 0 };
  readonly cache = createPlayerSnapshotCache(() => this.clock);

  advance(milliseconds: number) {
    this.clock += milliseconds;
  }

  increment(scope: keyof Counts) {
    this.counts[scope] += 1;
    return this.counts[scope];
  }

  snapshot(): Counts {
    return { ...this.counts };
  }
}

export function PlayerCacheProof({ disabled = false }: { disabled?: boolean }) {
  const [proof] = useState(() => new CacheProofHarness());
  const [result, setResult] = useState<Counts>({ balance: 0, collection: 0 });
  async function read() {
    const collectionTtl = disabled ? 0 : PLAYER_SNAPSHOT_TTL.collection;
    await Promise.all([
      proof.cache.memo("collection:proof", collectionTtl, async () =>
        proof.increment("collection")
      ),
      proof.cache.memo("collection:proof", collectionTtl, async () =>
        proof.increment("collection")
      ),
      proof.cache.memo("info:proof", PLAYER_SNAPSHOT_TTL.balance, async () =>
        proof.increment("balance")
      ),
      proof.cache.memo("info:proof", PLAYER_SNAPSHOT_TTL.balance, async () =>
        proof.increment("balance")
      )
    ]);
    setResult(proof.snapshot());
  }
  return (
    <section
      className="yk-social-panel"
      data-proof-result={JSON.stringify(result)}
    >
      <h2 className="yk-section-title">Politique de cache inchangée</h2>
      <p className="mt-3 text-sm text-ink-2">
        Collection : {result.collection} chargement(s) · Solde :{" "}
        {result.balance} chargement(s)
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          className="yk-button yk-button-primary"
          onClick={() => void read()}
        >
          Lire les snapshots
        </button>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => proof.advance(11_000)}
        >
          Avancer de 11 s
        </button>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => proof.advance(50_000)}
        >
          Avancer de 50 s
        </button>
      </div>
    </section>
  );
}
