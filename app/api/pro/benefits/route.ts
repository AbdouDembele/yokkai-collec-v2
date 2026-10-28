import {
  proUser,
  hasPaidPro,
  benefits,
  proReply,
  proFailure
} from "@/lib/pro/server";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await proUser(request);
    return proReply(benefits(await hasPaidPro(user.id)));
  } catch (error) {
    return proFailure(error);
  }
}
