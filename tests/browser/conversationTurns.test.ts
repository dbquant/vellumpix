import { describe, expect, test, vi } from "vitest";
import {
  buildConversationTurnCountExpression,
  buildConversationTurnListExpression,
  buildLastAssistantMessageExpression,
} from "../../src/browser/conversationTurns.js";
import {
  CONVERSATION_TURN_CONTAINER_SELECTOR,
  CONVERSATION_TURN_SELECTOR,
} from "../../src/browser/constants.js";

function evaluate(expression: string, responses: Map<string, unknown[]>): unknown {
  const document = {
    createElement: () => ({ placeholder: true }),
    querySelectorAll: vi.fn((selector: string) => responses.get(selector) ?? []),
  };
  return Function("document", `return ${expression};`)(document);
}

describe("conversation turn expressions", () => {
  test("preserves logical indices when earlier turns are virtualized away", () => {
    const latest = {
      querySelector: () => ({ getAttribute: () => "fallback-turn-3" }),
    };
    const responses = new Map([[CONVERSATION_TURN_CONTAINER_SELECTOR, [latest]]]);
    const turns = evaluate(buildConversationTurnListExpression(), responses) as unknown[];
    expect(turns).toHaveLength(4);
    expect(turns[3]).toBe(latest);
    expect(evaluate(buildConversationTurnCountExpression(), responses)).toBe(4);
  });
  test("prefers top-level turn containers over nested broad-selector matches", () => {
    const containers = [{ id: "user" }, { id: "assistant" }];
    const nestedMatches = [...containers, { id: "nested-assistant" }];
    const responses = new Map([
      [CONVERSATION_TURN_CONTAINER_SELECTOR, containers],
      [CONVERSATION_TURN_SELECTOR, nestedMatches],
    ]);

    expect(evaluate(buildConversationTurnListExpression(), responses)).toEqual(containers);
    expect(evaluate(buildConversationTurnCountExpression(), responses)).toBe(2);
  });

  test("falls back to the broad selector for older conversation markup", () => {
    const legacyTurns = [{ id: "user" }, { id: "assistant" }];
    const responses = new Map([
      [CONVERSATION_TURN_CONTAINER_SELECTOR, []],
      [CONVERSATION_TURN_SELECTOR, legacyTurns],
    ]);

    expect(evaluate(buildConversationTurnListExpression(), responses)).toEqual(legacyTurns);
  });

  test("recognizes untyped image reply message ids without selecting the user message", () => {
    const expression = buildLastAssistantMessageExpression("turn");

    expect(expression).toContain("[data-chatgpt-search-message-ids]");
    expect(expression).toContain("!key.endsWith(':user')");
    expect(expression).toContain("untypedMessages.at(-1)");
  });
});
