# 7. Horizon: Client Replica, WASM Embeddings, and Local File System Mirror
*Status: Open Horizon (Spike/Design)*

**WARNING:** This is an Open Horizon design document. Much of this functionality is unbuilt, heavily spiked, or currently under active design. This document does not pretend to be finalized doctrine; it is an honest record of current direction, identified gaps, and architectural tensions.

---

## 1. Architectural Principle: "VPS Light as a Feather"

The fundamental premise of this horizon is that the VPS (Virtual Private Server) must remain *light*—a passive conduit for storage, sync, and low-overhead serving. It should not be subjected to the heavy, unpredictable compute loads of arbitrary user workflows.

**Rationale:** By offloading heavy tasks (archiving, plaintext serialization, folder mirroring, embedding calculation, state management) to the user's client device, we achieve several critical benefits:
*   **Cost Efficiency:** Plate-rate VPS costs remain stable.
*   **Offline Capability:** The system works reliably without internet access.
*   **Performance:** The VPS remains fast under high load.
    
## 2. What Already Landed (Execution Pack 1)

The following features are already built, integrated, and awaiting David's hands-on, high-fidelity testing. This work is essential to proving the architectural premise of this document before wider implementation of the next steps.

*   **Client-Side POSIX ustar + Gzip Archiving:** Core functionality for export/import of projects via POSIX-compatible `tar.gz` archives (`src/utils/tarGz.ts` and `src/domains/plaintextTree.ts).
*   **Operator CLI Tools:** Initial implementation of the local-only operator CLI (`scripts/plaintext-cli.ts`), allowing manual Plaintext Tree operations without requiring server interaction.
*   **Offline Registry Access:** The authentication model supports identifying and allowing users to access existing local offline replicas via the AuthGate (knownReplicating the `knownReplicas` registry, and the "Open Offline" toggle).

## 3. Next Step A — Browser-Side JS/WASM Embeddings (transformers.js/ONNX)

This is perhaps the most critical technical pivot for the longevity of the application, solving two specific, non-negotiable problems.

### 3.1. The Problems It Solves
1.  **Embedding Quota Exhaustion:** Commercial APIs (like Google's) have minuscule, rate-limited quotas. They cannot support the volume of indexing and query calls required by a high-usage user.
2.  **Airplane Mode Search:** Semantic search must work 100% offline, regardless of network status.

### 3.2. Target Architecture (Direction Locked 2026-10-27)
The direction is to run local Vector/Semantic intelligence inside the browser using WebAssembly (WASM).

*   **The Model:** We target a small, quantized ONNX embedding model (e.g., all-MiniLM-L6-v2 or bge-small-en-v1.5 q8, ~22MB download).
*   **Lazy Loading:** The model is *not* loaded on startup. It is lazy-loaded only upon the first search or indexing request, residing in a dedicated Web Worker.
*   **Caching:** The model weights are cached persistently in a dedicated browser Cache Storage bucket (`markbrain-models-v1`). Subsequent app updates do not require re-download.
*   **Indexing/Query Flow:**
    *   **Indexing:** Section embeddings are computed locally by the client against the Plaintext Tree and stored locally in IndexedDB.
    *   **Querying:** Query embeddings are also computed locally against the cached vectors in IndexedDB.
    *   **Search:** Lexical and Vector search runs with **zero API keys and zero network overhead.**
*   **LLM vs. Embedding:** The `generate-qa` step can *still* use the LLM when online (optional boost), while the core vector and lexical search runs independently of it.

### 3.3. The Immediate Tension (Open Questions)
*   **Model Migration:** How to handle the dimension shift (e.g., from 768 Gemini to 384 ONNX)? Do we need to re-embed existing historical data, or dual-index?
*   **Deployment:** Mobile battery/thermal constraints when indexing dozens of notes.
*   **Synchronization:** Do vectors sync cross-device via SQLite, or does each device compute its own autonomous index?

## 4. Next Step B — Desktop Live Local Folder Mirror (File System Access API)

A feature specifically for Desktop clients (not mobile) to "close the loop" on data loss. A user can link a local directory on their drive to a browser-managed mirror, and the browser writes the canonical Plaintext Tree (artifacts/*.md, threads/*.json, edges.json) directly to disk, creating a local, external backup that can be managed by Git or Syncthing.

*   **Goal:** Move beyond the volatile browser/local storage and onto persistent, user-controlled physical storage.

**Open Questions:**
*   **One-Way vs. Open Mirror:** App -> Disk (The current plan).
*   **Two-Way Watch:** Picking up external edits (e.g., user edits a `.md` in VS Code) requires robust conflict resolution.

## 5. Next Step C — Optional Password Unlock for Offline Replicas (Hardening)

Currently, if a user signs out on a personal machine, their local IndexedDB replica remains open and readable. Optional hardening would store a salted verifier hash (PBKDF2 of the account password) to gate the local replica. This is **nice-to-have**—the primary requirement (access when the VPS is down) already works unencrypted by design choice—but it prevents misuse on shared devices. Needs David's risk call.
