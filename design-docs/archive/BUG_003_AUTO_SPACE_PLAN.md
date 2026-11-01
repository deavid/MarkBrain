# Implementation Plan: Graph `Auto-Space` Layout Using `visible_factor` (`BUG-003`)

- **Status**: **Ready for Prototype Implementation** (designed with David on 2026-11-01).
- **Primary file**: `src/ui/graph/SpatialGraph.tsx` (plus a pure layout module `src/ui/graph/autoSpaceLayout.ts` for unit testing).

---

## 1. Why the Old `Auto-Space` Failed

In `src/ui/graph/SpatialGraph.tsx`:
1. `runPhysicsStep` reset `vx: 0, vy: 0` on every animation frame instead of accumulating velocity.
2. It rounded `Math.round(n.x + vx)` on every single frame — so as soon as `|vx| < 0.5px` (which happened at `~190px` distance with `kRepulsion = 18000 / distSq`), nodes moved `0px` and froze!
3. The spring target length was far too small (`220px` originally, `320px` after `BUG-004`), keeping cards crowded together so lines were stubby dashes hidden behind cards.

---

## 2. David's Distance & `visible_factor` Model

The whole point of Graph mode is to **scatter nodes across the 2D canvas with generous breathing room so we can clearly SEE the lines and their labels**. Any attempt to pack or compact the graph is wrong.

### 2.1 The `visible_factor` Formula

Given:
- Card width `NODE_CARD_WIDTH = 220` → **`half_width` (`W`) = `110px`**
- Center-to-center distance between two nodes: `distance = Math.hypot(n2.x - n1.x, n2.y - n1.y)`

1. Subtract the two card half-widths to get the raw visible line span:
   ```ts
   visible = distance - 2 * half_width; // distance - 220
   ```
2. Subtract one `half_width` (`110px`) for the edge label sitting in the middle of the line:
   ```ts
   visible_w_label = visible - half_width; // distance - 330
   ```
3. Divide by `half_width` (`110px`) to get the normalized **`visible_factor`**:
   ```ts
   visible_factor = visible_w_label / half_width; // (distance - 330) / 110
   ```
   *(And inversely: `distanceFromVisibleFactor(f) = (f + 3) * half_width = (f + 3) * 110`.)*

### 2.2 Distance Scale Reference Table

| Center-to-Center Distance | `visible` (`dist - 220`) | `visible_w_label` (`dist - 330`) | `visible_factor` | Classification |
|---|---|---|---|---|
| **`300px`** | `80px` | `-30px` | **`-0.27`** | **Too short / tiny** (label doesn't even fit!) |
| **`500px`** | `280px` | `170px` | **`+1.55`** | **Short** (minimum acceptable linked distance) |
| **`800px`** | `580px` | `470px` | **`+4.27`** | **Normal / Medium (Target Sweet Spot)** |
| **`1000px`** | `780px` | `670px` | **`+6.09`** | **Long** (upper end of comfortable linked range) |
| **`1500px`** | `1280px` | `1170px` | **`+10.64`** | **Too long** (pull back together) |
| **`2000px`** | `1780px` | `1670px` | **`+15.18`** | **Way too long** |

---

## 3. Layout Solver Specification (`src/ui/graph/autoSpaceLayout.ts`)

Create a pure, deterministic layout solver `computeAutoSpacePositions(nodes, edges)` in `src/ui/graph/autoSpaceLayout.ts` and export `computeVisibleFactor(distance, halfWidth = 110)` and `distanceFromVisibleFactor(factor, halfWidth = 110)`:

### 3.1 Constants Driven by `visible_factor`
- `HALF_WIDTH = 110` (`NODE_CARD_WIDTH / 2`)
- `MIN_LINKED_FACTOR = 1.55` → **`~500px`** (hard floor for any linked pair)
- `TARGET_LINKED_FACTOR = 4.27` → **`~800px`** (ideal normal/medium distance for linked nodes)
- `LONG_LINKED_FACTOR = 6.09` → **`~1000px`** (comfortable upper band; for high-degree hubs with `degree >= 5`, scale target factor up toward `5.5–6.0` so radiating spokes have angular room)
- `MAX_LINKED_FACTOR = 10.0` → **`~1430px`** (never let an edge stretch into the `1500px+` "too long" zone)
- `MIN_UNLINKED_DISTANCE = 600` (`visible_factor ≈ 2.45` — any two non-linked nodes within `600px` strongly repel each other so unrelated cards never crowd near each other)
- `NODE_TO_EDGE_CLEARANCE = 220` (if a third node `C` sits within `220px` of the line segment between linked nodes `A` and `B`, push `C` perpendicular to the segment `AB` so cards never sit on top of other cards' lines!).

### 3.2 How `computeAutoSpacePositions` Solves the Layout in One Click

Instead of nudging 5 pixels and stopping, `computeAutoSpacePositions(nodes, edges)` runs a complete **floating-point simulation (`~250` iterations with simulated-annealing temperature schedule)** in memory and returns the solved `{ id, x, y }[]`:

1. **Partition into Connected Components + Unlinked Islands (degree 0)**:
   - Identify nodes with at least 1 edge vs. isolated nodes (`degree === 0`).
   - If two nodes start at nearly identical coordinates (or closer than `100px`), jitter them deterministically by index angle before starting so forces have a clean direction vector.

2. **Per-Iteration Forces (in `float64`, NO per-step `Math.round`!)**:
   For each iteration `step = 0 .. 249` with temperature `temp = Math.max(0.08, 1 - step / 250)` (allowing moves up to `120px * temp` per step so cramped graphs expand `1000px+` in a single click):
   - **A. Linked Edge Force (using `visible_factor`)**:
     For each edge `(u, v)`:
     - Compute `dist = Math.hypot(v.x - u.x, v.y - u.y)` and `vf = computeVisibleFactor(dist)`.
     - Hub-aware target factor: `targetVf = 4.27 + Math.min(1.8, Math.max(deg(u), deg(v)) * 0.2)` (so normal pairs target **`800px`**, and busy hubs target **`900px–1000px`**).
     - Deadband comfort zone: if `vf` is within `[targetVf - 0.6, targetVf + 0.8]` (roughly `730px–900px`), spring force is very gentle (`k = 0.02`) so edges don't fight each other unnecessarily.
     - If `vf < MIN_LINKED_FACTOR` (`< 500px`): strong repulsive push outward so short edges expand quickly into the `800px` medium range.
     - If `vf > LONG_LINKED_FACTOR` (`> 1000px`): stronger attractive pull inward so edges never stay in the `1500px` "too long" range.
   - **B. All-Pairs Node Repulsion (Wide Scattering)**:
     For every pair of nodes `(n1, n2)` in the connected graph:
     - If `dist < 900`: apply smooth inverse repulsion that is strong inside `600px` (`(900 - dist)` + inverse-square term) so non-linked nodes never sit closer than `~550px–650px` to each other.
     - Also account for rectangular aspect ratio (`220×68`): horizontal overlap requires wider clearance than vertical, though radial `600px+` gives generous room in every direction.
   - **C. Node-to-Edge Line Clearance (Keep cards off lines!)**:
     For every edge `(A, B)` and every third node `C` (`C !== A && C !== B`):
     - Project `C` onto the segment `AB` (`t` clamped to `[0.1, 0.9]`).
     - If perpendicular distance `perpDist < NODE_TO_EDGE_CLEARANCE` (`220px`):
       Push `C` perpendicular to `AB` away from the line (and gently push `A` and `B` the opposite way) so `C` clears the corridor of the edge `AB`!

3. **Placement of Unlinked Nodes (`degree === 0`)**:
   - Place unlinked/island nodes in a clean, well-spaced arc or shelf above/beside the bounding box of the connected components, spaced **`650px–800px`** apart from each other and at least **`700px`** clear of the connected web (so they neither clutter the web nor fly off `5,000px` away).

4. **Smooth Animation & Auto-Fit in `SpatialGraph.tsx`**:
   - When the user clicks **`Auto-Space`**:
     1. Compute `targetPositions = computeAutoSpacePositions(nodes, edges)` immediately.
     2. Animate `nodes` from their current `(x, y)` to `targetPositions` over `~25` animation frames (`~400ms`) using ease-out cubic interpolation (`t = 1 - Math.pow(1 - p, 3)`), calling `onBatchUpdateNodePositions`.
     3. At the end of the animation (or smoothly during it), call `fitViewToNodes` (updating the minimum zoom clamp in `fitViewToNodes` from `0.5` down to `0.15` and mouse-wheel min zoom from `0.35` down to `0.12` so a wide-scattered 25-node graph at `800px` edge lengths can always fit on screen and be zoomed out completely!).

---

## 4. Required Tests (`src/tests/auto-space-layout.test.ts`)

1. **`computeVisibleFactor` & `distanceFromVisibleFactor`**:
   - `computeVisibleFactor(300)` is `< 0` (`~ -0.27`).
   - `computeVisibleFactor(500)` is `~ 1.55`.
   - `computeVisibleFactor(800)` is `~ 4.27`.
   - `computeVisibleFactor(1000)` is `~ 6.09`.
   - `computeVisibleFactor(1500)` is `~ 10.64`.
2. **Single click convergence from a cramped clump**:
   - Given 10 connected nodes all starting crammed inside a `200×200px` box, one call to `computeAutoSpacePositions` spreads them out so that:
     - Every linked pair has center-to-center distance `>= 500px` (`visible_factor >= 1.5`) and `<= 1350px` (`visible_factor < 9.5`), with median linked distance in the `650px–1000px` range (`visible_factor` `3.0–6.1`).
     - No two nodes (linked or unlinked) end up closer than `480px`.
3. **Pulling back overly long edges**:
   - Given 2 linked nodes starting `2500px` apart (`visible_factor > 19`), one call to `computeAutoSpacePositions` pulls them back into the `700px–1000px` normal/long range.
4. **Node-to-edge clearance**:
   - Given node `A` at `(0, 0)`, node `B` at `(800, 0)` (linked), and unlinked node `C` sitting right on the line at `(400, 10)`, `computeAutoSpacePositions` pushes `C` off the line segment `AB` by at least `180px`.
