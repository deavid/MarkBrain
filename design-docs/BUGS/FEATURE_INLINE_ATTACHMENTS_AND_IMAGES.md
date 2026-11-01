# Feature Request (Drawer): Inline User Attachments (`<attach>`) & Mid-Message Images

- **Origin**: Discussed with David on 2026-10-31 during `BUG-007` review.
- **Status**: Drawer (future feature — not part of the immediate bug-fix pass).

## 1. Common XML Language for User & Model Inline References

Right now, user attachments sit in a staging tray above the composer and apply to the whole turn, whereas the model writes operations inline inside its message text.
In the future, both parties should speak the **same inline XML language**:
- Driven by the `[+]` Attach button (or `@` / `/` in the composer), picking an artifact can insert an inline XML tag right at the cursor position in the user's message:
  ```xml
  <attach file="night-vision-acoustic-synesthesia-design.md" level="full" />
  ```
- When rendered in the chat bubble, that tag renders **in place** as an interactive Attachment Chip right inside the user's sentence (just like `<link>` and `<artifact_upsert>` render in place in the assistant's reply).
- When flipped to `<> Raw`, the user sees the exact `<attach .../>` XML tag in place.

## 2. Mid-Message Auto-Named Image Attachments (Chat & Markdown Artifacts)

A limitation David hit even in Goose is not being able to paste/attach images mid-message with clear names and inline references:
- When the user drops/pastes/attaches images into a message, automatically assign each image a clean, deterministic handle (`img-01.png`, `img-02.png`, or `<image file="img-01.png" />`) at the exact spot in the prose where it was inserted.
- In rendered Markdown mode, the image renders inline right where the user placed it (so the conversation reads naturally with images embedded between paragraphs, not dumped in a footer strip).
- The LLM receives the image along with its `img-01.png` identifier in the exact position in the turn, so both the user and the LLM can refer to `img-01.png` unambiguously.
- Extend the same capability to **Artifact Markdown bodies** so design documents and specs can embed and render images inline.
