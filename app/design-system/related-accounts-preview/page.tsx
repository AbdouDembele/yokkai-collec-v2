import { getTranslations } from "next-intl/server";
import { RelatedAccountPicker } from "@/app/admin/security/related-account-picker";
import { relatedFixture, fixtureSubject } from "./fixtures";

export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = await searchParams;
  const t = await getTranslations("adminSecurity");
  const query = String(q.linked_q ?? "");
  const status = String(q.linked_status ?? "");
  const page = Math.max(1, parseInt(String(q.linked_page ?? "1"), 10) || 1);
  const role =
    q.role === "smurf" ? "smurf" : q.role === "missing" ? "" : "primary";
  const selected = Array.isArray(q.source_account)
    ? q.source_account
    : q.source_account
      ? [q.source_account]
      : [];
  const data = relatedFixture(query, status, page, q.removed === "1");
  return (
    <main className="mx-auto max-w-7xl p-3 sm:p-6">
      <h1 className="text-xl font-black">{t("metadataTitle")}</h1>
      <RelatedAccountPicker
        subjectId={fixtureSubject}
        role={role}
        data={data}
        query={query}
        status={status}
        page={page}
        selected={selected}
        activeId={typeof q.primary === "string" ? q.primary : null}
        targetLabel={t(role === "primary" ? "smurfAccount" : "primaryAccount")}
      />
      {(q.primary || selected.length > 0) && (
        <section
          id="sanction-preview"
          className="mt-5 scroll-mt-28 rounded-xl border border-cyan-300/30 p-4"
        >
          <h2 className="font-bold">{t("previewSanction")}</h2>
          <p>{t("relatedAccounts.previewSimulation")}</p>
        </section>
      )}
    </main>
  );
}
