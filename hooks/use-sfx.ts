"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playPackSound, type PackSound } from "@/lib/ui/pack-sound";

export type SfxName = PackSound | "ssr" | "lr";
const STORAGE_KEY = "yokkai-sound-enabled";
const CHANGE_EVENT = "yokkai:sound-change";
const SOUND_FILES: Partial<Record<SfxName, string>> = {
  lr: "LR.mp3",
  ssr: "SSR.mp3"
};
// Skip only the supplied files' leading silence; keep their audio bytes intact.
const START_OFFSETS: Partial<Record<SfxName, number>> = { lr: 0.25, ssr: 0.18 };

type AmbientNavigator = Navigator & { audioSession?: { type: string } };

/** "media": HTMLAudio is safe; "web-audio": mobile without an ambient session,
 * where Web Audio plays without taking audio focus from external music. */
function nonInterruptingAudioMode() {
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  if (!mobile) return "media";
  const session = (navigator as AmbientNavigator).audioSession;
  if (!session) return "web-audio";
  try {
    session.type = "ambient";
    return "media";
  } catch {
    return "web-audio";
  }
}

/** Local audio assets; missing/blocked audio must never interrupt a pack opening. */
export function useSfx() {
  const [enabled, setEnabled] = useState(true);
  const sounds = useRef(new Map<SfxName, HTMLAudioElement>());
  const context = useRef<AudioContext>(null);
  const buffers = useRef(new Map<SfxName, Promise<AudioBuffer>>());
  const sources = useRef(new Map<SfxName, AudioBufferSourceNode>());
  const generation = useRef({ value: 0 });
  const synthetic = useRef<ReturnType<typeof playPackSound> | null>(null);
  const stopCardSounds = useCallback(() => {
    synthetic.current?.stop();
    generation.current.value++;
    sounds.current.forEach((audio, name) => {
      if (name in SOUND_FILES) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    sources.current.forEach((source, name) => {
      if (name in SOUND_FILES) source.stop();
    });
  }, []);
  const play = useCallback(
    (name: SfxName) => {
      if (!enabled) return;
      stopCardSounds();
      if (name !== "lr" && name !== "ssr") {
        nonInterruptingAudioMode();
        try {
          const ctx = (context.current ??= new AudioContext());
          void ctx.resume().catch(() => {});
          synthetic.current = playPackSound(ctx, name);
        } catch {
          /* Audio must never block a pack opening. */
        }
        return;
      }
      const url = `/assets/sfx/${SOUND_FILES[name]}`;
      const offset = START_OFFSETS[name] ?? 0;
      if (nonInterruptingAudioMode() === "web-audio") {
        const requestedGeneration = generation.current.value;
        const ctx = (context.current ??= new AudioContext());
        void ctx.resume().catch(() => {});
        let buffer = buffers.current.get(name);
        if (!buffer) {
          buffer = fetch(url)
            .then(response => response.arrayBuffer())
            .then(data => ctx.decodeAudioData(data));
          buffers.current.set(name, buffer);
        }
        buffer.then(
          decoded => {
            if (requestedGeneration !== generation.current.value) return;
            sources.current.get(name)?.stop();
            const source = ctx.createBufferSource();
            const gain = ctx.createGain();
            gain.gain.value = 0.35;
            source.buffer = decoded;
            source.connect(gain).connect(ctx.destination);
            source.onended = () => {
              if (sources.current.get(name) === source)
                sources.current.delete(name);
              source.disconnect();
              gain.disconnect();
            };
            sources.current.set(name, source);
            source.start(0, offset);
          },
          () => buffers.current.delete(name)
        );
        return;
      }
      let audio = sounds.current.get(name);
      if (!audio) {
        audio = new Audio(url);
        audio.preload = "auto";
        audio.volume = 0.35;
        sounds.current.set(name, audio);
      }
      audio.currentTime = offset;
      void audio.play().catch(() => {
        /* Autoplay or unavailable audio: continue silently. */
      });
    },
    [enabled, stopCardSounds]
  );
  const toggle = useCallback(() => {
    synthetic.current?.stop();
    generation.current.value++;
    sources.current.forEach(source => source.stop());
    sources.current.clear();
    sounds.current.forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });
    void context.current?.suspend().catch(() => {});
    const next = !enabled;
    setEnabled(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
    window.dispatchEvent(
      new CustomEvent<boolean>(CHANGE_EVENT, { detail: next })
    );
  }, [enabled]);
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) queueMicrotask(() => setEnabled(saved === "true"));
    const sync = (event: Event) =>
      setEnabled((event as CustomEvent<boolean>).detail);
    const syncStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue !== null)
        setEnabled(event.newValue === "true");
    };
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", syncStorage);
    };
  }, []);
  useEffect(() => {
    const cache = sounds.current;
    const activeSources = sources.current;
    const decodedBuffers = buffers.current;
    const playback = generation.current;
    const synthesized = synthetic;
    return () => {
      synthesized.current?.stop();
      playback.value++;
      activeSources.forEach(source => source.stop());
      activeSources.clear();
      decodedBuffers.clear();
      cache.forEach(audio => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      });
      cache.clear();
      void context.current?.close().catch(() => {});
      context.current = null;
    };
  }, []);
  return { enabled, play, toggle, stopCardSounds };
}
