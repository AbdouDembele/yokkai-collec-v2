import en from "@/messages/economic-maintenance/en.json";
import fr from "@/messages/economic-maintenance/fr.json";

export function economicMaintenanceError(code?: string): Error | undefined {
  if (code !== "ECONOMIC_MAINTENANCE") return;
  const catalog = typeof document !== "undefined" && document.documentElement.lang === "fr" ? fr : en;
  return new Error(catalog.message, { cause: { i18nKey: "cardErrors.economicMaintenance" } });
}
