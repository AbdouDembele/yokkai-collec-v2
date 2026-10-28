import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";

test("signup carries a bounded referral code and settings expose the referral panel", () => {
  const signup = readFileSync("app/(auth)/signup/page.tsx", "utf8");
  const form = readFileSync("components/auth-form.tsx", "utf8");
  const action = readFileSync("app/auth/actions.ts", "utf8");
  const settings = readFileSync("app/settings/page.tsx", "utf8");
  const panel = readFileSync("components/referral-panel.tsx", "utf8");
  const layout = readFileSync("app/layout.tsx", "utf8");
  const reminder = readFileSync("components/referral-reminder.tsx", "utf8");
  assert.match(signup, /normalizeReferralCode/);
  assert.match(form, /name="referralCode"/);
  assert.match(action, /referral_code: referralCode/);
  assert.match(settings, /<ReferralPanel/);
  assert.match(panel, /t\("settingsUi.referralRewardNotice"\)/);
  assert.match(
    englishMessages.settingsUi.referralRewardNotice,
    /verifies their email/
  );
  assert.match(
    englishMessages.settingsUi.referralRewardNotice,
    /5 bonus Regular Packs/
  );
  assert.match(layout, /<ReferralReminder \/>/);
  assert.match(reminder, /t\("inviteFriendsEarn5BonusPacks"\)/);
  assert.match(
    englishMessages.referralReminder.inviteFriendsEarn5BonusPacks,
    /Earn 5 bonus packs/
  );
  assert.match(reminder, /t\("copyLink"\)/);
  assert.equal(englishMessages.referralReminder.copyLink, "Copy link");
  assert.match(reminder, /t\("dismissReferralReminder"\)/);
  assert.equal(
    englishMessages.referralReminder.dismissReferralReminder,
    "Dismiss referral reminder"
  );
  assert.match(reminder, /yokkai-referral-reminder-dismissed:/);
});
