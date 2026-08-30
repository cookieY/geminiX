import { describe, expect, it } from "vitest";
import {
  businessErrCodeByName,
  businessErrorName,
  describeBusinessError,
  describeError,
  describeTransportError,
} from "@/shared/api/error-display";
import { BusinessError, TransportError } from "@/shared/api/mutator";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";

function businessError(errCode: number): BusinessError {
  return new BusinessError({
    err_code: errCode,
    message: "server text",
    request_id: REQUEST_ID,
    retryable: false,
  });
}

describe("describeBusinessError", () => {
  it("maps a declared err_code to its catalog i18n key", () => {
    // login declares INVALID_CREDENTIALS in its generated error profile
    const display = describeBusinessError(businessError(1101), "login");
    expect(display.messageKey).toBe("errors.INVALID_CREDENTIALS");
    expect(display.requestId).toBe(REQUEST_ID);
    expect(display.contractViolation).toBe(false);
  });

  it("sends undeclared err_code outcomes to the safe generic path with the request_id", () => {
    // 2011 AI_PROVIDER_FAILED is real but never declared for login
    const display = describeBusinessError(businessError(2011), "login");
    expect(display.messageKey).toBe("errors.generic.safe");
    expect(display.requestId).toBe(REQUEST_ID);
    expect(display.contractViolation).toBe(true);
  });

  it("treats an unknown err_code as a contract violation, never a success signal", () => {
    const display = describeBusinessError(businessError(9999), "getCurrentUser");
    expect(display.messageKey).toBe("errors.generic.safe");
    expect(display.contractViolation).toBe(true);
  });

  it("falls back to the generic business key for a declared-but-uncatalogued code", () => {
    // getCurrentUser declares no_business_error → every err_code is a violation
    const display = describeBusinessError(businessError(1001), "getCurrentUser");
    expect(display.contractViolation).toBe(true);
  });
});

describe("describeTransportError", () => {
  it("maps each transport status class to its i18n key and keeps the request_id", () => {
    const problem = {
      type: "about:blank",
      title: "session_expired",
      status: 401,
      detail: "expired",
      request_id: REQUEST_ID,
    };
    const display = describeTransportError(new TransportError(problem));
    expect(display.messageKey).toBe("errors.transport.unauthenticated");
    expect(display.requestId).toBe(REQUEST_ID);
  });

  it("maps forbidden and rate-limited statuses to their own keys", () => {
    const forbidden = describeTransportError(
      new TransportError({ title: "permission_denied", status: 403, detail: "no" }),
    );
    expect(forbidden.messageKey).toBe("errors.transport.forbidden");
    const limited = describeTransportError(
      new TransportError({ title: "rate_limited", status: 429, detail: "slow down" }),
    );
    expect(limited.messageKey).toBe("errors.transport.rateLimited");
  });

  it("treats an operation outside every profile as fully undeclared", () => {
    const display = describeBusinessError(businessError(1001), "noSuchOperation");
    expect(display.messageKey).toBe("errors.generic.safe");
    expect(display.contractViolation).toBe(true);
  });

  it("reports network failures without fabricating a request id", () => {
    const display = describeTransportError(
      new TransportError({ title: "network_error", status: 0, detail: "down" }),
    );
    expect(display.messageKey).toBe("errors.transport.network");
    expect(display.requestId).toBeNull();
  });
});

describe("describeError", () => {
  it("routes unknown throwables to the safe generic message", () => {
    const display = describeError(new Error("boom"), "login");
    expect(display.messageKey).toBe("errors.generic.safe");
    expect(display.requestId).toBeNull();
  });
});

describe("catalog helpers", () => {
  it("resolves stable names and codes without numeric literals in components", () => {
    expect(businessErrorName(1101)).toBe("INVALID_CREDENTIALS");
    expect(businessErrCodeByName("ADMIN_PASSWORD_LOCKED")).toBe(1102);
    expect(businessErrCodeByName("NOT_A_REAL_ERROR")).toBeNull();
  });
});
