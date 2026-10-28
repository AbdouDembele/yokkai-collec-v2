// Compatibility for the existing validation DTO: these are source English
// messages, never localized display text or raw GoTrue error.message values.
const authMessageKeys: Record<string, string> = {
  "We couldn't save your username. Please try again.": "usernameSaveFailed",
  "We couldn't find this email domain. Check your address for typos.":
    "emailDomainMissing",
  "Accept the Terms of Use and Community rules to create your account.":
    "acceptPolicies",
  "Choose a username with at least 3 characters.": "usernameShort",
  "Choose a username with no more than 30 characters.": "usernameLong",
  "Your username can't contain / \\ ? # % < > or control characters.":
    "usernameCharacters",
  "Choose a username without emoji.": "usernameEmoji",
  "Enter a valid email address.": "emailInvalid",
  "Choose a password with 8–128 characters.": "passwordLength",
  "Enter your password.": "passwordRequired",
  "The passwords don't match.": "passwordMismatch",
  "Enter your current password.": "currentPasswordRequired",
  "Your new password must be different from your current one.":
    "passwordDifferent",
  "Bot verification failed or expired. Complete verification again before resubmitting the form.":
    "captchaFailed",
  "Your account is banned.": "banned",
  "Incorrect email or password.": "invalidCredentials",
  "Confirm your email address before signing in.": "emailNotConfirmed",
  "This password is too weak. Choose a longer one with more variety.":
    "weakPassword",
  "Too many attempts. Wait a few minutes before trying again.": "rateLimit",
  "This email address is already in use. Try signing in.": "emailExists",
  "This email address is invalid.": "invalidAddress",
  "This email address can't be used to sign up.": "addressNotAllowed",
  "Sign-ups are temporarily disabled.": "signupDisabled",
  "Sign-in is temporarily unavailable. Please try again in a moment.":
    "unavailable",
  "Authentication was declined. Check your details and try again.": "declined",
  "The service has reached its email sending limit. Try again later; this isn't an issue with your address.":
    "emailLimit",
  "Email delivery is temporarily unavailable. Please try again later.":
    "emailUnavailable",
  "That username is already taken. Try another one.": "usernameTaken",
  "This password reset link is invalid or has expired.": "resetInvalid",
  "Your session has expired. Sign in again and retry.": "sessionExpired",
  "Incorrect current password.": "currentPasswordWrong",
  "Couldn't sign out. Please try again.": "signOutFailed"
};

export function authMessageKey(message: string) {
  return authMessageKeys[message] ?? message;
}
