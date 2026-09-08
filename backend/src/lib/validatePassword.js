// Requires >6 chars, at least one uppercase, one lowercase, one digit, one symbol.
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{7,}$/;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  "Password must be more than 6 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.";

export function isValidPassword(password) {
  return typeof password === "string" && PASSWORD_REGEX.test(password);
}
