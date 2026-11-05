"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@/components/ui";
import { acknowledgeMaintenanceCompensation } from "@/app/maintenance-compensation/actions";
import "@/styles/maintenance-compensation.css";
export function MaintenanceCompensation({
  preview = false
}: {
  preview?: boolean;
}) {
  const t = useTranslations("maintenanceCompensation");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      if (cancelled) return;
      if (
        document.visibilityState === "hidden" ||
        document.querySelector("dialog[open]")
      ) {
        timer = setTimeout(show, 500);
        return;
      }
      setOpen(true);
    };
    timer = setTimeout(show, preview ? 50 : 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [preview]);
  const close = () => {
    setOpen(false);
    if (!preview)
      void acknowledgeMaintenanceCompensation().catch(() => undefined);
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title={t("title")}
      className="yk-maintenance-gift"
    >
      <p>{t("body")}</p>
      <div className="yk-maintenance-rewards">
        <div>
          <strong>25</strong>
          <span>Regular Packs</span>
        </div>
        <div>
          <strong>1</strong>
          <span>Decision Pack</span>
        </div>
      </div>
      <p>{t("availability")}</p>
      <Button onClick={close}>{t("done")}</Button>
    </Modal>
  );
}
