import { createClient } from "@/utils/supabase/client";

export async function getProfilePrivacy() {
  const { data, error } = await createClient().rpc("get_profile_privacy");
  if (error) throw new Error("Couldn't load your profile privacy settings.");
  return Boolean(data);
}

export async function setProfilePrivacy(isPublic: boolean) {
  const { data, error } = await createClient().rpc("set_profile_privacy", { p_is_public: isPublic });
  if (error) throw new Error("Couldn't update your profile privacy settings.");
  return Boolean(data);
}
