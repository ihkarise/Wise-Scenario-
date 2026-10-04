/** Parses JSON text. Syntax errors are reported in plain language. (Kept tiny: used in the browser.) */
export function parseJsonText(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(raw.replace(/^﻿/, "")) };
  } catch (e) {
    return { ok: false, message: `This file is not valid JSON: ${(e as Error).message}` };
  }
}
