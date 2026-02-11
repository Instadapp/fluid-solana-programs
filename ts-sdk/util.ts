import { BN } from "@coral-xyz/anchor";

// Helper to recursively print objects, converting BN, PublicKey, etc. to readable strings
export function readableConsoleDump(obj: any, depth = 0): any {
  if (obj === null || obj === undefined) return obj;
  if (
    typeof obj === "string" ||
    typeof obj === "number" ||
    typeof obj === "boolean"
  )
    return obj;
  if (typeof obj.toString === "function") {
    // BN.js or PublicKey or similar
    if (obj.constructor && obj.constructor.name === "BN") {
      return obj.toString(10);
    }
    if (obj.constructor && obj.constructor.name === "PublicKey") {
      return obj.toString();
    }
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => readableConsoleDump(item, depth + 1));
  }
  if (typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      out[k] = readableConsoleDump(obj[k], depth + 1);
    }
    return out;
  }
  return obj;
}

// Division with ceiling rounding (rounds up)
export function divCeil(numerator: BN, denominator: BN): BN {
  if (denominator.isZero()) {
    throw new Error("Division by zero");
  }
  const { div, mod } = numerator.divmod(denominator);
  return mod.isZero() ? div : div.addn(1);
}
