import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function getAdminUser() {
  const supabase = createClient(await cookies());
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return { kind: "anonymous" as const };
  const { data: isAdmin, error: adminError } = await supabase.rpc(
    "is_current_user_admin"
  );
  if (adminError || isAdmin !== true) return { kind: "forbidden" as const };
  return { kind: "admin" as const, user: authData.user };
}

export async function requireAdminPage() {
  const result = await getAdminUser();
  if (result.kind === "anonymous") redirect("/login?next=/admin/cards");
  if (result.kind === "forbidden") notFound();
  return result.user;
}

export async function requireAdminAction() {
  const result = await getAdminUser();
  if (result.kind !== "admin")
    throw new Error("This action is restricted to administrators.");
  return result.user;
}
