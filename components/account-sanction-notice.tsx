"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import "@/styles/account-sanctions.css";

type Receipt = {
  sanction_id: string;
  sanction_type:
    | "AFFILIATE_ABUSE_SANCTION"
    | "AFFILIATE_ABUSE_WARNING_WITH_PENALTY"
    | "AFFILIATE_ABUSE_WARNING";
  cards_removed: number;
  kara_removed: number;
};

// No local receipt: only the committed server acknowledgement can dismiss this.
export function AccountSanctionNotice() {
  const t = useTranslations("accountSanctions");
  const pathname = usePathname();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const receipt = receipts[0];
  const receiptId = receipt?.sanction_id;
  useEffect(() => {
    const client = createClient();
    let active = true;
    let revision = 0;
    const load = async () => {
      const request = ++revision;
      const {
        data: { session }
      } = await client.auth.getSession();
      if (!active || request !== revision) return;
      if (!session) {
        setReceipts([]);
        return;
      }
      const { data, error } = await client.rpc("get_my_pending_sanctions");
      if (active && request === revision && !error) setReceipts(data ?? []);
    };
    void load();
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        revision++;
        setReceipts([]);
      } else if (event === "SIGNED_IN")
        setTimeout(() => {
          if (active) void load();
        }, 0);
    });
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [pathname]);
  useEffect(() => {
    const element = dialog.current;
    if (!receiptId || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => {
      element.close();
      previous?.focus({ preventScroll: true });
    };
  }, [receiptId]);
  if (!receipt) return null;
  const kind =
    receipt.sanction_type === "AFFILIATE_ABUSE_SANCTION"
      ? "sanction"
      : receipt.sanction_type === "AFFILIATE_ABUSE_WARNING_WITH_PENALTY"
        ? "penalty"
        : "warning";
  const acknowledge = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const { data, error } = await createClient().rpc(
        "acknowledge_my_sanction",
        { p_sanction_id: receipt.sanction_id }
      );
      if (error || data !== true) {
        setFailed(true);
        return;
      }
      setReceipts(items =>
        items.filter(item => item.sanction_id !== receipt.sanction_id)
      );
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="yk-sanction-notice"
      aria-labelledby={title}
      onCancel={event => event.preventDefault()}
    >
      <h2 id={title}>{t(`${kind}.title`)}</h2>
      <p>{t(`${kind}.intro`)}</p>
      {kind !== "warning" && (
        <>
          <p>{t(`${kind}.decision`)}</p>
          <dl>
            <div>
              <dt>{t("cardsRemoved")}</dt>
              <dd>{receipt.cards_removed}</dd>
            </div>
            <div>
              <dt>{t("karaRemoved")}</dt>
              <dd>{receipt.kara_removed}</dd>
            </div>
          </dl>
          <p>{t(`${kind}.explanation`)}</p>
        </>
      )}
      <p>{t(`${kind}.rules`)}</p>
      <p>{t(`${kind}.future`)}</p>
      {failed && <p role="alert">{t("saveError")}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void acknowledge()}
      >
        {t(saving ? "saving" : "acknowledge")}
      </button>
    </dialog>
  );
}
