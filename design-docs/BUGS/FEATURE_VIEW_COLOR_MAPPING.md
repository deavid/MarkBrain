# Feature Request: Configurable View-Level Color Mapping for Artifacts (Graph & Library)

- **Origin**: Logged by David on 2026-10-31 during `BUG-005` / `BUG-006.1` review.
- **Status**: Planned feature (for after the current bug-fix & stripping pass).

## Core Principle

**Colors do NOT belong to individual artifacts as a static property.**
Previously, each artifact was assigned a random pastel color (`art.color`, e.g. `#e05a66`) at creation time. That static color had no meaning — it made unselected cards in the graph look selected or broken, and displayed meaningless hex codes in the detail view.

Instead, **color is a lens / mapping applied by the VIEW** to make the current view clearer and convey real information at a glance.

## How View-Level Color Mapping Should Work

In views that display multiple artifacts (primarily **Graph mode**, and optionally Folder / Proximity views), the user can choose a **Color By** lens (with a small legend so the colors always answer "so what?"):

1. **Color by Active Chat Attachment / Granularity** *(huge value when working alongside a chat)*:
   - Highlights which artifacts are currently attached to the active chat and at what granularity level, using the existing attachment state palette:
     - **Full** (`full` body in context)
     - **Summary**
     - **Description**
     - **Title**
     - **Staged for next send**
     - **Not attached** (neutral/dimmed)
   - Lets the user immediately see on the graph which parts of the knowledge web the AI can currently see in the active conversation.

2. **Color by Tag**:
   - Maps top/selected tags (or user-assigned tag colors) onto nodes so thematic clusters stand out visually.

3. **Color by Folder / Path (or Type / Category)**:
   - Maps the artifact's folder hierarchy or document type (`document`, `chapter`, etc.) to distinct hues.

4. **None (Neutral)**:
   - Default calm neutral appearance where only the **selected node** and **hovered/connected edges** are highlighted.

## Design Rules When Implementing Later
- Never store a random hex color on the artifact itself.
- Selection highlight must always remain visually distinct from any color-mapping fill/accent (e.g. crisp selection ring vs. subtle badge/accent tint).
- Whenever a color mode other than `None` is active, show a compact, honest legend in the view corner so the user never has to guess what a color means.
