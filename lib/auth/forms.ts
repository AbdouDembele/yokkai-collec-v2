import messages from "@/messages/en.json";

export type AuthState = {
  error?: string;
  errorKey?: string;
  errorValues?: Record<string, number>;
  success?: boolean;
  retryAfter?: number;
  needsConfirmation?: boolean;
  fields?: Partial<
    Record<
      | "email"
      | "currentPassword"
      | "password"
      | "confirmPassword"
      | "pseudo"
      | "acceptedPolicies",
      string
    >
  >;
  values?: { email: string; pseudo: string };
};

const FORBIDDEN_PSEUDO_CHARACTERS = /[/\\?#%<>\p{Cc}]/u;

// Do not use \p{Emoji}: it also includes ordinary digits, #, and *.
const PSEUDO_EMOJI_CHARACTERS =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20E3\uFE0F\u{E0020}-\u{E007F}]/u;
export const PSEUDO_NO_EMOJI_PATTERN = String.raw`(?!.*[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u20E3\uFE0F\u{E0020}-\u{E007F}]).*`;

// Version of the Terms and Community rules presented at signup.
export const SIGNUP_POLICY_VERSION = "2026-10-20";

export function signupPolicyValidationError(form: FormData) {
  const acceptance = form.getAll("acceptedPolicies");
  return acceptance.length === 1 && acceptance[0] === SIGNUP_POLICY_VERSION
    ? undefined
    : "Accept the Terms of Use and Community rules to create your account.";
}

export function normalizeReferralCode(value: unknown) {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  return /^[a-f0-9]{12}$/.test(code) ? code : null;
}

export function pseudoValidationError(pseudo: string) {
  const length = [...pseudo].length;
  if (length < 3) return "Choose a username with at least 3 characters.";
  if (length > 30) return "Choose a username with no more than 30 characters.";
  if (FORBIDDEN_PSEUDO_CHARACTERS.test(pseudo)) {
    return "Your username can't contain / \\ ? # % < > or control characters.";
  }
  if (PSEUDO_EMOJI_CHARACTERS.test(pseudo)) {
    return "Choose a username without emoji.";
  }
  return undefined;
}

export function validateCredentials(form: FormData, signup: boolean) {
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const email = text("email").trim();
  const password = text("password"); // Password whitespace is meaningful.
  const pseudo = text("pseudo").trim();
  const fields: NonNullable<AuthState["fields"]> = {};
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fields.email = "Enter a valid email address.";
  }
  if (!password || (signup && (password.length < 8 || password.length > 128))) {
    fields.password = signup
      ? "Choose a password with 8–128 characters."
      : "Enter your password.";
  }
  const pseudoError = signup ? pseudoValidationError(pseudo) : undefined;
  if (pseudoError) fields.pseudo = pseudoError;
  return {
    email,
    password,
    pseudo,
    fields,
    valid: Object.keys(fields).length === 0
  };
}

export function validateEmail(form: FormData) {
  const value = form.get("email");
  const email = typeof value === "string" ? value.trim() : "";
  return {
    email,
    error:
      email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? undefined
        : "Enter a valid email address."
  };
}

export function validateNewPassword(form: FormData) {
  const passwordValue = form.get("password");
  const confirmationValue = form.get("confirmPassword");
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const confirmation =
    typeof confirmationValue === "string" ? confirmationValue : "";
  const fields: NonNullable<AuthState["fields"]> = {};
  if (password.length < 8 || password.length > 128) {
    fields.password = "Choose a password with 8–128 characters.";
  }
  if (confirmation !== password) {
    fields.confirmPassword = "The passwords don't match.";
  }
  return { password, fields, valid: Object.keys(fields).length === 0 };
}

export function validatePasswordChange(form: FormData) {
  const currentValue = form.get("currentPassword");
  const currentPassword = typeof currentValue === "string" ? currentValue : "";
  const next = validateNewPassword(form);
  const fields = { ...next.fields };
  if (!currentPassword) fields.currentPassword = "Enter your current password.";
  if (currentPassword && currentPassword === next.password) {
    fields.password =
      "Your new password must be different from your current one.";
  }
  return {
    currentPassword,
    password: next.password,
    fields,
    valid: Object.keys(fields).length === 0
  };
}

export function authError(code?: string, status?: number) {
  const { key } = authErrorDescriptor(code, status);
  return messages.authErrors[key as keyof typeof messages.authErrors];
}

export function authEmailError(error: unknown) {
  const { key } = authEmailErrorDescriptor(error);
  // The historical English cooldown is deliberately unchanged, even when the
  // provider includes a precise delay; the localized UI receives that parameter.
  return messages.authErrors[
    (key === "emailCooldown"
      ? "rateLimit"
      : key) as keyof typeof messages.authErrors
  ];
}

// GoTrue overloads over_email_send_rate_limit for both a shared budget and
// a per-address cooldown, and unexpected_failure for SMTP and other failures.
// Only those ambiguous codes inspect the untranslated provider message.
export function authErrorDescriptor(code?: string, status?: number) {
  const keys: Record<string, string> = {
    captcha_failed: "captchaFailed",
    user_banned: "banned",
    invalid_credentials: "invalidCredentials",
    email_not_confirmed: "emailNotConfirmed",
    weak_password: "weakPassword",
    over_request_rate_limit: "rateLimit",
    over_email_send_rate_limit: "rateLimit",
    over_sms_send_rate_limit: "rateLimit",
    user_already_exists: "emailExists",
    email_exists: "emailExists",
    email_address_invalid: "invalidAddress",
    email_address_not_authorized: "addressNotAllowed",
    signup_disabled: "signupDisabled",
    email_provider_disabled: "signupDisabled",
    request_timeout: "unavailable",
    unexpected_failure: "unavailable"
  };
  return {
    key:
      (code && keys[code]) ||
      (!code || (status ?? 0) >= 500 ? "unavailable" : "declined"),
    values: undefined as Record<string, number> | undefined
  };
}

export function authEmailErrorDescriptor(error: unknown) {
  if (typeof error !== "object" || error === null) return authErrorDescriptor();
  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;
  const status =
    "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  if (code === "over_email_send_rate_limit") {
    if (/^For security purposes, you can only request this /.test(message)) {
      const delay = /after (\d{1,6}) seconds?\b/.exec(message);
      return delay
        ? { key: "emailCooldown", values: { seconds: Number(delay[1]) } }
        : authErrorDescriptor("over_request_rate_limit");
    }
    return { key: "emailLimit", values: undefined };
  }
  if (
    (code === "unexpected_failure" || (status ?? 0) >= 500) &&
    /^Error sending (confirmation|recovery) email$/.test(message)
  ) {
    return { key: "emailUnavailable", values: undefined };
  }
  return authErrorDescriptor(code, status);
}

export function captchaOptions(form: FormData, siteKey?: string) {
  if (!siteKey) return {};
  const tokens = form.getAll("cf-turnstile-response");
  const token = tokens[0];
  if (
    tokens.length !== 1 ||
    typeof token !== "string" ||
    !token ||
    token.length > 2048 ||
    token !== token.trim()
  )
    return undefined;
  return { captchaToken: token };
}
