"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { createPlayerSnapshotCache } from "@/lib/data/player-state";
import { readRequest } from "@/lib/data/read-request";
const cache = createPlayerSnapshotCache();
let observed = false;
let userId: string | undefined;
export async function getIsAdmin() {
  const client = createClient();
  if (!observed) {
    observed = true;
    client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== userId) {
        userId = session?.user.id;
        cache.clear();
      }
    });
  }
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) {
    cache.clear();
    return false;
  }
  const admin = await cache.memo(`admin:${id}`, 300_000, async () => {
    const { data, error } = await readRequest(signal =>
      client.rpc("is_current_user_admin").abortSignal(signal)
    );
    if (error) throw error;
    return data === true;
  });
  const current = await client.auth.getSession();
  return current.data.session?.user.id === id && admin;
}
export function useIsAdmin(enabled = true) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const client = createClient();
    const update = () => {
      setIsAdmin(false);
      void getIsAdmin().then(
        value => {
          if (active) setIsAdmin(value);
        },
        () => {
          if (active) setIsAdmin(false);
        }
      );
    };
    update();
    const { data } = client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") setIsAdmin(false);
      else if (event === "SIGNED_IN") queueMicrotask(update);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [enabled]);
  return isAdmin;
}
