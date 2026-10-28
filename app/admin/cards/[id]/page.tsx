import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountMenu } from "@/components/account-menu";
import { Topbar } from "@/components/topbar";
import { requireAdminPage } from "@/lib/auth/admin";
import { getCurrentKarasBalance, getCurrentPseudo } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AdminNavigation } from "../../admin-navigation";
import { CardRow } from "../admin-card-manager";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminReportedCard");
  return { title: t("title") };
}

export default async function AdminCardPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminPage();
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    notFound();
  const client = createClient(await cookies());
  const t = await getTranslations("adminReportedCard");
  const [name, karas, result, categoryResult] = await Promise.all([
    getCurrentPseudo(admin.id),
    getCurrentKarasBalance(client),
    client
      .from("cards")
      .select(
        "id,nom,categorie,franchise,rarete_base,image_url,card_franchises(franchise,position)"
      )
      .eq("id", id)
      .maybeSingle(),
    client.rpc("list_admin_card_categories")
  ]);
  if (result.error) throw new Error(result.error.message);
  if (categoryResult.error) throw new Error(categoryResult.error.message);
  const card = result.data;
  const categories = Array.isArray(categoryResult.data)
    ? categoryResult.data.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
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
        className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 py-8 sm:px-8"
      >
        <AdminNavigation />
        <Link
          className="yk-button yk-button-secondary min-h-11 max-w-full whitespace-normal"
          href="/admin/reports"
        >
          {t("back")}
        </Link>
        <header className="min-w-0 space-y-2">
          <h1 className="break-words text-2xl font-bold">
            {card?.nom ?? t("title")}
          </h1>
          <p className="text-sm text-slate-300">{t("help")}</p>
        </header>
        {card ? (
          <CardRow
            card={{
              ...card,
              franchises: [...(card.card_franchises ?? [])]
                .sort((left, right) => left.position - right.position)
                .map(item => item.franchise)
            }}
            categories={categories}
          />
        ) : (
          <p
            role="status"
            className="rounded-2xl border border-white/10 p-5 text-slate-300"
          >
            {t("missing")}
          </p>
        )}
      </main>
    </div>
  );
}
