import crypto from "crypto";

export function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString(); // 6 digits
}
