import { APIConnectionError, APIConnectionTimeoutError, APIUserAbortError } from "openai";
import { APIError } from "openai/error";
import type {
  VellumPixResponse,
  VellumPixResponseMetadata,
  TransportFailureReason,
} from "./types.js";
import { formatElapsed } from "./format.js";

export type VellumPixUserErrorCategory =
  | "file-validation"
  | "browser-automation"
  | "prompt-validation";

export interface VellumPixUserErrorDetails {
  [key: string]: unknown;
}

export class VellumPixUserError extends Error {
  readonly category: VellumPixUserErrorCategory;
  readonly details?: VellumPixUserErrorDetails;

  constructor(
    category: VellumPixUserErrorCategory,
    message: string,
    details?: VellumPixUserErrorDetails,
    cause?: unknown,
  ) {
    super(message);
    this.name = "VellumPixUserError";
    this.category = category;
    this.details = details;
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class FileValidationError extends VellumPixUserError {
  constructor(message: string, details?: VellumPixUserErrorDetails, cause?: unknown) {
    super("file-validation", message, details, cause);
    this.name = "FileValidationError";
  }
}

export class BrowserAutomationError extends VellumPixUserError {
  constructor(message: string, details?: VellumPixUserErrorDetails, cause?: unknown) {
    super("browser-automation", message, details, cause);
    this.name = "BrowserAutomationError";
  }
}

/**
 * The caller went away. Distinct from a failure: nothing was wrong with the run,
 * it simply stopped being wanted, and a caller that reads this should not retry
 * or report a problem.
 */
export class BrowserRunCancelledError extends VellumPixUserError {
  constructor(message = "Browser run cancelled: the caller disconnected.") {
    super("browser-automation", message, { stage: "run-cancelled" });
    this.name = "BrowserRunCancelledError";
  }
}

export class PromptValidationError extends VellumPixUserError {
  constructor(message: string, details?: VellumPixUserErrorDetails, cause?: unknown) {
    super("prompt-validation", message, details, cause);
    this.name = "PromptValidationError";
  }
}

export function asVellumPixUserError(error: unknown): VellumPixUserError | null {
  if (error instanceof VellumPixUserError) {
    return error;
  }
  return null;
}

export class VellumPixTransportError extends Error {
  readonly reason: TransportFailureReason;

  constructor(reason: TransportFailureReason, message: string, cause?: unknown) {
    super(message);
    this.name = "VellumPixTransportError";
    this.reason = reason;
    if (cause) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export class VellumPixResponseError extends Error {
  readonly metadata: VellumPixResponseMetadata;
  readonly response?: VellumPixResponse;

  constructor(message: string, response?: VellumPixResponse) {
    super(message);
    this.name = "VellumPixResponseError";
    this.response = response;
    this.metadata = extractResponseMetadata(response);
  }
}

export function extractResponseMetadata(
  response?: VellumPixResponse | null,
): VellumPixResponseMetadata {
  if (!response) {
    return {};
  }
  const metadata: VellumPixResponseMetadata = {
    responseId: response.id,
    status: response.status,
    incompleteReason: response.incomplete_details?.reason ?? undefined,
  };
  const requestId = response._request_id;
  if (requestId !== undefined) {
    metadata.requestId = requestId;
  }
  return metadata;
}

export function toTransportError(error: unknown, model?: string): VellumPixTransportError {
  if (error instanceof VellumPixTransportError) {
    return error;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new VellumPixTransportError(
      "client-timeout",
      "OpenAI request timed out before completion.",
      error,
    );
  }
  if (error instanceof APIUserAbortError) {
    return new VellumPixTransportError(
      "client-abort",
      "The request was aborted before OpenAI finished responding.",
      error,
    );
  }
  if (error instanceof APIConnectionError) {
    return new VellumPixTransportError(
      "connection-lost",
      "Connection to OpenAI dropped before the response completed.",
      error,
    );
  }
  const isApiError = error instanceof APIError || (error as { name?: string })?.name === "APIError";
  if (isApiError) {
    const apiError = error as APIError & {
      code?: string;
      error?: { code?: string; message?: string };
    };
    const code = apiError.code ?? apiError.error?.code;
    const messageText = apiError.message?.toLowerCase?.() ?? "";
    const apiMessage =
      apiError.error?.message ||
      apiError.message ||
      (apiError.status ? `${apiError.status} OpenAI API error` : "OpenAI API error");
    // Friendly guidance when a pro-tier model isn't available on this base URL / API key.
    if (
      (model === "gpt-5.5-pro" || model === "gpt-5.4-pro") &&
      (code === "model_not_found" ||
        messageText.includes("does not exist") ||
        messageText.includes("unknown model") ||
        messageText.includes("model_not_found"))
    ) {
      return new VellumPixTransportError(
        "model-unavailable",
        `${model} is not available on this API base/key. Try gpt-5.5, gpt-5-pro, or switch to the browser engine.`,
        apiError,
      );
    }
    if (apiError.status === 404 || apiError.status === 405) {
      return new VellumPixTransportError(
        "unsupported-endpoint",
        "HTTP 404/405 from the Responses API; this base URL or gateway likely does not expose /v1/responses. Set OPENAI_BASE_URL to api.openai.com/v1, update your Azure API version/deployment, or use the browser engine.",
        apiError,
      );
    }
    return new VellumPixTransportError("api-error", apiMessage, apiError);
  }
  return new VellumPixTransportError(
    "unknown",
    error instanceof Error ? error.message : "Unknown transport failure.",
    error,
  );
}

export function describeTransportError(
  error: VellumPixTransportError,
  deadlineMs?: number,
): string {
  switch (error.reason) {
    case "client-timeout":
      return deadlineMs
        ? `Client-side timeout: OpenAI streaming call exceeded the ${formatElapsed(deadlineMs)} deadline.`
        : "Client-side timeout: OpenAI streaming call exceeded the configured deadline.";
    case "connection-lost":
      return "Connection to OpenAI ended unexpectedly before the response completed.";
    case "client-abort":
      return "Request was aborted before OpenAI completed the response.";
    case "api-error":
      return error.message;
    case "model-unavailable":
      return error.message;
    case "unsupported-endpoint":
      return "The Responses API returned 404/405 — your base URL/gateway probably lacks /v1/responses (check OPENAI_BASE_URL or switch to api.openai.com / browser engine).";
    default:
      return "OpenAI streaming call ended with an unknown transport error.";
  }
}
