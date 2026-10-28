import { getRequestConfig } from "next-intl/server";
import { getLocalePreference } from "./server";

export default getRequestConfig(async () => {
  const { locale } = await getLocalePreference();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: "UTC"
  };
});
