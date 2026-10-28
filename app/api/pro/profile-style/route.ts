import {
  ProError,
  proUser,
  proClient,
  hasPaidPro,
  boundedBody,
  saveProStyle,
  proReply,
  proFailure
} from "@/lib/pro/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await proUser(request);
    const client = proClient();
    const active = await hasPaidPro(user.id, client);
    const { data, error } = await client
      .from("profile_customizations")
      .select("style")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new ProError("PRO_UNAVAILABLE");
    return proReply({ active, style: active ? (data?.style ?? {}) : {} });
  } catch (error) {
    return proFailure(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await proUser(request, true);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !==
      "application/json"
    )
      throw new ProError("REQUEST_INVALID", 400);
    let input;
    try {
      input = JSON.parse((await boundedBody(request, 8192)).toString("utf8"));
    } catch (error) {
      if (error instanceof ProError) throw error;
      throw new ProError("REQUEST_INVALID", 400);
    }
    if (
      !input ||
      Array.isArray(input) ||
      typeof input !== "object" ||
      Object.keys(input).some(key => key !== "style") ||
      !("style" in input)
    )
      throw new ProError("REQUEST_INVALID", 400);
    return proReply(await saveProStyle(user.id, input.style));
  } catch (error) {
    return proFailure(error);
  }
}
