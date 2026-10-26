import {
  ASSISTANT_ROLE_SELECTOR,
  CONVERSATION_TURN_CONTAINER_SELECTOR,
  CONVERSATION_TURN_SELECTOR,
} from "./constants.js";

/** An exchange can contain progress messages before its final assistant message. */
export function buildLastAssistantMessageExpression(turnExpression = "turn"): string {
  return `(() => {
    const root = ${turnExpression};
    if (!root) return null;
    const selector = ${JSON.stringify(ASSISTANT_ROLE_SELECTOR)};
    const messages = Array.from(root.querySelectorAll(selector)).filter(node => {
      const owner = node.parentElement?.closest(selector);
      return !owner || owner === root;
    });
    // Image-only replies in the current ChatGPT layout have a message id but no
    // assistant role/search-unit attribute. Exclude the user message-id node and
    // use the last remaining message node as the assistant payload root.
    const untypedMessages = Array.from(root.querySelectorAll('[data-chatgpt-search-message-ids]'))
      .filter(node => {
        const key = (node.getAttribute('data-content-search-unit-key') || node.getAttribute('data-chatgpt-search-unit-key') || '').toLowerCase();
        return !key.endsWith(':user') && !node.closest('[data-user-message-bubble], [data-message-author-role="user"]');
      });
    return messages.at(-1) ?? root.querySelector(selector) ?? untypedMessages.at(-1) ?? (root.matches?.(selector) ? root : null);
  })()`;
}

/** Build a browser-context expression that returns one DOM node per conversation turn. */
export function buildConversationTurnListExpression(rootExpression = "document"): string {
  const containerSelector = JSON.stringify(CONVERSATION_TURN_CONTAINER_SELECTOR);
  const fallbackSelector = JSON.stringify(CONVERSATION_TURN_SELECTOR);
  return `(() => {
    const root = ${rootExpression};
    const containers = Array.from(root.querySelectorAll(${containerSelector})).filter(
      node => !node.parentElement?.closest(${containerSelector}),
    );
    return containers.length > 0
      ? containers
      : Array.from(root.querySelectorAll(${fallbackSelector}));
  })()`;
}

export function buildConversationTurnCountExpression(rootExpression = "document"): string {
  return `(${buildConversationTurnListExpression(rootExpression)}).length`;
}
