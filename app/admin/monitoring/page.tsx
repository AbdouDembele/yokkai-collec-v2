import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { parseMonitorData } from "@/lib/admin/monitoring";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../admin-navigation";
import { MonitoringAutoRefresh } from "./auto-refresh";
import { MonitoringView } from "./monitoring-view";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminMonitoring");
  return { title: t("metadataTitle") };
}

export default async function AdminMonitoringPage() {
  const admin = await requireAdminPage();
  const client = createClient(await cookies());
  const t = await getTranslations("adminMonitoring");
  const [name, karas, result] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client),
    client.rpc("admin_get_ops_monitor", { p_hours: 24 })
  ]);
  if (result.error) throw new Error(result.error.message);
  const data = parseMonitorData(result.data);
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Topbar
        view="admin"
        account={<AccountMenu />}
        name={name ?? undefined}
        karas={karas}
      />
      <main
        id="main-content"
        className="min-w-0 px-3 py-6 [overflow-wrap:anywhere] sm:px-8 sm:py-8"
      >
        <div className="mx-auto max-w-7xl space-y-6">
          <header>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300 sm:text-sm">
              {t("eyebrow")}
            </p>
            <h1 className="mt-1 text-3xl font-black sm:text-4xl">
              {t("title")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              {t("description")}
            </p>
          </header>
          <AdminNavigation />
          <MonitoringView data={data} now={data.now} />
        </div>
      </main>
      <MonitoringAutoRefresh />
    </div>
  );
}
