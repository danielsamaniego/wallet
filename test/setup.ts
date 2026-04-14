import { expect } from "vitest";
import { AppError, ErrorKind } from "@/utils/kernel/appError.js";

interface AppErrorMatchers {
  toThrowAppError(kind: ErrorKind, code: string): void;
}

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion extends AppErrorMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AppErrorMatchers {}
}

expect.extend({
  toThrowAppError(received: () => unknown, kind: ErrorKind, code: string) {
    let thrown: unknown;
    try {
      const result = received();
      if (result instanceof Promise) {
        return {
          pass: false,
          message: () =>
            "toThrowAppError does not support async functions. Use expect(...).rejects.toThrowAppError() or await the promise manually.",
        };
      }
      return {
        pass: false,
        message: () =>
          `Expected function to throw AppError(${kind}, ${code}), but it did not throw.`,
      };
    } catch (e) {
      thrown = e;
    }

    if (!(thrown instanceof AppError)) {
      return {
        pass: false,
        message: () =>
          `Expected function to throw AppError(${kind}, ${code}), but it threw: ${String(thrown)}`,
      };
    }

    const kindMatch = thrown.kind === kind;
    const codeMatch = thrown.code === code;

    return {
      pass: kindMatch && codeMatch,
      message: () =>
        kindMatch && codeMatch
          ? `Expected function NOT to throw AppError(${kind}, ${code}), but it did.`
          : `Expected AppError(${kind}, ${code}), but got AppError(${thrown.kind}, ${thrown.code}): "${thrown.msg}"`,
    };
  },
});
