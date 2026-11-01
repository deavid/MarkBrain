import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Artifact, SemanticEdge, RelationKind } from '../../types';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Link as LinkIcon,
  Plus,
} from 'lucide-react';

/**
 * View-local shapes: x/y layout state lives here, a view concern, built from the
 * domain inputs (UniversalArtifactDocument[] + SemanticEdge[]).
 *
 * View nodes are keyed by ARTIFACT id, never a prefixed view id, and handlers
 * receive artifact ids. The graph therefore needs no id-mapping layer either side.
 */
interface ViewNode {
  id: string; // = artifact id
  artifact: Artifact;
  artifactId: string;
  title: string;
  type: string;
  x: number;
  y: number;
  tags?: string[];
}

interface ViewEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: string;
}

export interface TentativeLink {
  id: string;
  sourceNode: ViewNode;
  targetNode: ViewNode;
  sharedTags: string[];
}

/** Node card box on the canvas (BUG-001: lean Title + Type card). */
export const NODE_CARD_WIDTH = 220;
export const NODE_CARD_HEIGHT = 68;
/** Outer margin (px) between the clipped edge endpoint and the card border. */
const EDGE_CLIP_MARGIN = 4;
/** BUG-004: linked node centers never settle closer than this, so the
 *  card edge to card edge gap always fits an 80px edge label. */
export const MIN_LINKED_CENTER_DISTANCE = 320;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Ray-rect intersection: where does the straight line between the two rect
 * centers exit the source rect and enter the target rect (each inflated by
 * `margin`)? Returns those border points plus their midpoint, so edges are
 * drawn card-border to card-border and labels sit in the open gap (BUG-004).
 */
export function clipEdgeToNodeRects(
  sRect: Rect,
  tRect: Rect,
  _curveOffset?: number
): { sx: number; sy: number; tx: number; ty: number; midX: number; midY: number } {
  const scx = sRect.x + sRect.width / 2;
  const scy = sRect.y + sRect.height / 2;
  const tcx = tRect.x + tRect.width / 2;
  const tcy = tRect.y + tRect.height / 2;

  const exit = (from: { x: number; y: number }, to: { x: number; y: number }, rect: Rect) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const minX = rect.x - EDGE_CLIP_MARGIN;
    const minY = rect.y - EDGE_CLIP_MARGIN;
    const maxX = rect.x + rect.width + EDGE_CLIP_MARGIN;
    const maxY = rect.y + rect.height + EDGE_CLIP_MARGIN;
    // Slabs: distance along the ray where each face is crossed.
    const tx = dx !== 0 ? (dx > 0 ? (maxX - from.x) / dx : (minX - from.x) / dx) : Infinity;
    const ty = dy !== 0 ? (dy > 0 ? (maxY - from.y) / dy : (minY - from.y) / dy) : Infinity;
    const t = Math.min(tx, ty);
    if (!Number.isFinite(t)) return { x: from.x, y: from.y };
    return { x: from.x + dx * t, y: from.y + dy * t };
  };

  const s = exit({ x: scx, y: scy }, { x: tcx, y: tcy }, sRect);
  const t = exit({ x: tcx, y: tcy }, { x: scx, y: scy }, tRect);
  return {
    sx: s.x,
    sy: s.y,
    tx: t.x,
    ty: t.y,
    midX: (s.x + t.x) / 2,
    midY: (s.y + t.y) / 2,
  };
}

interface SpatialGraphProps {
  projectId: string;
  artifacts: Artifact[];
  edges: SemanticEdge[];
  onSelectArtifact: (artifact: Artifact) => void;
  /** Artifact ids + open-vocabulary kind — whatever this UI authors is a valid kind (mapped below). */
  onAddEdge: (sourceId: string, targetId: string, kind: RelationKind, weight?: number) => void;
  onUpdateNodePosition: (artifactId: string, x: number, y: number) => void;
  onBatchUpdateNodePositions: (positions: Array<{ artifactId: string; x: number; y: number }>) => void;
  /** Clicking a #tag leaves the graph for the folder tree, filtered to it. */
  onFilterByTag?: (tag: string) => void;
}

export const SpatialGraph: React.FC<SpatialGraphProps> = ({
  projectId,
  artifacts,
  edges: domainEdges,
  onSelectArtifact,
  onAddEdge,
  onUpdateNodePosition,
  onBatchUpdateNodePositions,
  onFilterByTag,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Viewport transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });

  // Pan interaction
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ pointerX: 0, pointerY: 0, panX: 0, panY: 0 });

  // Node Dragging interaction
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    nodeX: number;
    nodeY: number;
  } | null>(null);

  // Force simulation state
  const [isPhysicsRunning, setIsPhysicsRunning] = useState(false);
  const physicsFrameRef = useRef<number | null>(null);

  // Edge linking mode
  const [linkingSourceNode, setLinkingSourceNode] = useState<ViewNode | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });

  // Selected node
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // View adapter: domain artifacts + edges → x/y view shapes.
  const nodes: ViewNode[] = useMemo(
    () =>
      artifacts.map((art, idx) => ({
        id: art.id,
        artifact: art,
        artifactId: art.id,
        title: art.title || art.title || 'Untitled',
        type: art.type,
        x: art.graph?.x ?? 300 + (idx % 5) * 180,
        y: art.graph?.y ?? 200 + Math.floor(idx / 5) * 120,
        tags: art.tags,
      })),
    [artifacts]
  );
  const edges: ViewEdge[] = useMemo(
    () =>
      domainEdges.map((e) => ({
        id: e.id,
        sourceId: e.sourceId,
        targetId: e.targetId,
        kind: e.kind,
      })),
    [domainEdges]
  );

  // Tags are NOT connections. Shared-tag "tentative cross-links" meshed the
  // graph into noise and were removed; real edges come only from explicit
  // relationships. Kept as a stable [] so dependent renders stay inert.
  const tentativeLinks = useMemo<TentativeLink[]>(() => [], []);

  // Fit View to nodes (ONLY called when explicitly clicked or on initial load)
  const fitViewToNodes = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    nodes.forEach((n) => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + NODE_CARD_WIDTH > maxX) maxX = n.x + NODE_CARD_WIDTH;
      if (n.y + NODE_CARD_HEIGHT > maxY) maxY = n.y + NODE_CARD_HEIGHT;
    });

    const graphWidth = Math.max(maxX - minX, 150);
    const graphHeight = Math.max(maxY - minY, 150);
    const padding = 50;

    const scaleX = (width - padding * 2) / graphWidth;
    const scaleY = (height - padding * 2) / graphHeight;
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.5), 1.3);

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const newPanX = width / 2 - centerX * newZoom;
    const newPanY = height / 2 - centerY * newZoom;

    setZoom(newZoom);
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  }, [nodes]);

  // Initial fit on project mount only
  const initialFitDoneRef = useRef(false);
  useEffect(() => {
    if (!initialFitDoneRef.current && nodes.length > 0) {
      initialFitDoneRef.current = true;
      setTimeout(() => fitViewToNodes(), 60);
    }
  }, [projectId, fitViewToNodes, nodes.length]);

  // Mouse Wheel Zooming (native scroll wheel)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom delta
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.35), 2.5);

    // Zoom towards cursor
    const mouseCanvasX = (mouseX - pan.x) / zoom;
    const mouseCanvasY = (mouseY - pan.y) / zoom;

    const newPanX = mouseX - mouseCanvasX * newZoom;
    const newPanY = mouseY - mouseCanvasY * newZoom;

    setZoom(newZoom);
    setPan({ x: Math.round(newPanX), y: Math.round(newPanY) });
  };

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  // Force-Directed Physics Engine (JS animated layout)
  const runPhysicsStep = useCallback(
    (currentNodes: ViewNode[]): Array<{ id: string; x: number; y: number }> => {
      const nodeMap = new Map(currentNodes.map((n) => [n.id, { ...n, vx: 0, vy: 0 }]));
      const kRepulsion = 18000;
      const kSpring = 0.04;
      // BUG-004: linked cards settle at the min linked distance so the edge
      // label always has open card-free space to sit in.
      const idealSpringLength = MIN_LINKED_CENTER_DISTANCE;
      const damping = 0.85;

      const nodeArr = Array.from(nodeMap.values());

      // 1. Repulsive forces between every pair of nodes
      for (let i = 0; i < nodeArr.length; i++) {
        for (let j = i + 1; j < nodeArr.length; j++) {
          const n1 = nodeArr[i];
          const n2 = nodeArr[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const distSq = Math.max(dx * dx + dy * dy, 400);
          const dist = Math.sqrt(distSq);

          const force = kRepulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          n1.vx -= fx;
          n1.vy -= fy;
          n2.vx += fx;
          n2.vy += fy;
        }
      }

      // 2. Attractive spring forces along edges
      for (const edge of edges) {
        const sNode = nodeMap.get(edge.sourceId);
        const tNode = nodeMap.get(edge.targetId);
        if (!sNode || !tNode) continue;

        const dx = tNode.x - sNode.x;
        const dy = tNode.y - sNode.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const displacement = dist - idealSpringLength;
        const springForce = displacement * kSpring;

        const fx = (dx / dist) * springForce;
        const fy = (dy / dist) * springForce;

        sNode.vx += fx;
        sNode.vy += fy;
        tNode.vx -= fx;
        tNode.vy -= fy;
      }

      // 3. Apply velocities (excluding currently dragged node)
      return nodeArr.map((n) => {
        if (n.id === draggingNodeId) {
          return { id: n.id, x: n.x, y: n.y };
        }
        const vx = Math.min(Math.max(n.vx * damping, -25), 25);
        const vy = Math.min(Math.max(n.vy * damping, -25), 25);
        return {
          id: n.id,
          x: Math.round(n.x + vx),
          y: Math.round(n.y + vy),
        };
      });
    },
    [edges, draggingNodeId]
  );

  // Trigger smooth multi-step Auto-Arrange animation
  const handleAutoArrange = () => {
    let stepsLeft = 45;
    let currentNodesState = [...nodes];

    const animateStep = () => {
      if (stepsLeft <= 0) return;
      const updates = runPhysicsStep(currentNodesState);
      onBatchUpdateNodePositions(
        updates.map((u) => ({ artifactId: u.id, x: u.x, y: u.y }))
      );

      currentNodesState = currentNodesState.map((n) => {
        const match = updates.find((u) => u.id === n.id);
        return match ? { ...n, x: match.x, y: match.y } : n;
      });

      stepsLeft--;
      physicsFrameRef.current = requestAnimationFrame(animateStep);
    };

    physicsFrameRef.current = requestAnimationFrame(animateStep);
  };

  useEffect(() => {
    return () => {
      if (physicsFrameRef.current) cancelAnimationFrame(physicsFrameRef.current);
    };
  }, []);

  // Pan handlers
  const handlePointerDownBg = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).id === 'graph-viewport' || (e.target as HTMLElement).tagName === 'svg') {
      setIsPanning(true);
      panStartRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMoveBg = (e: React.PointerEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.pointerX;
      const dy = e.clientY - panStartRef.current.pointerY;
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      });
    } else if (draggingNodeId && dragStartRef.current) {
      // Stable delta drag with clamped values
      const dx = (e.clientX - dragStartRef.current.pointerX) / zoom;
      const dy = (e.clientY - dragStartRef.current.pointerY) / zoom;
      const newX = Math.round(dragStartRef.current.nodeX + dx);
      const newY = Math.round(dragStartRef.current.nodeY + dy);
      onUpdateNodePosition(draggingNodeId, newX, newY);
    }

    if (linkingSourceNode) {
      const cPos = screenToCanvas(e.clientX, e.clientY);
      setMouseCanvasPos(cPos);
    }
  };

  const handlePointerUpBg = (e: React.PointerEvent) => {
    if (isPanning) {
      setIsPanning(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    if (draggingNodeId) {
      enforceMinLinkedDistance(draggingNodeId);
      setDraggingNodeId(null);
      dragStartRef.current = null;
    }
  };

  // BUG-004: after a drag, if the node settled closer than
  // MIN_LINKED_CENTER_DISTANCE to a linked node (or overlapping any node),
  // push it outward along the connecting vector so edge labels keep an open gap.
  const enforceMinLinkedDistance = (draggedId: string) => {
    const dragged = nodes.find((n) => n.id === draggedId);
    if (!dragged) return;
    const linkedIds = new Set(
      edges
        .filter((e) => e.sourceId === draggedId || e.targetId === draggedId)
        .flatMap((e) => [e.sourceId, e.targetId])
    );
    let bestX = dragged.x;
    let bestY = dragged.y;
    let pushDist = 0;

    for (const other of nodes) {
      if (other.id === draggedId) continue;
      const isLinked = linkedIds.has(other.id);
      const minDx = isLinked ? 0 : NODE_CARD_WIDTH + 20; // card-collision clearance
      const minDy = isLinked ? 0 : NODE_CARD_HEIGHT + 22;
      const dx = bestX - other.x;
      const dy = bestY - other.y;
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const minDist = isLinked
        ? MIN_LINKED_CENTER_DISTANCE
        : Math.max(
            Math.hypot(minDx, minDy),
            Math.abs(dx) >= minDx || Math.abs(dy) >= minDy ? dist : 0
          );
      if (dist < minDist) {
        const push = (minDist - dist) / dist;
        const cx = bestX + dx * push;
        const cy = bestY + dy * push;
        if (Math.hypot(cx - bestX, cy - bestY) > pushDist) {
          pushDist = Math.hypot(cx - bestX, cy - bestY);
          bestX = Math.round(cx);
          bestY = Math.round(cy);
        }
      }
    }

    if (bestX !== dragged.x || bestY !== dragged.y) {
      onUpdateNodePosition(draggedId, bestX, bestY);
    }
  };

  // Node Drag Start Handler
  const handleNodePointerDown = (e: React.PointerEvent, node: ViewNode) => {
    e.stopPropagation();
    if (linkingSourceNode) {
      handleCompleteEdge(node);
      return;
    }

    setSelectedNodeId(node.id);
    setDraggingNodeId(node.id);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };
  };

  // Complete Edge connection — the UI intent "references" maps to the domain
  // kind 'relates_to' (open vocabulary, KNOWN_RELATION_KINDS is the suggested set).
  const handleCompleteEdge = (targetNode: ViewNode) => {
    if (!linkingSourceNode || linkingSourceNode.id === targetNode.id) {
      setLinkingSourceNode(null);
      return;
    }

    onAddEdge(linkingSourceNode.id, targetNode.id, 'relates_to');
    setLinkingSourceNode(null);
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  return (
    <div
      ref={containerRef}
      id="graph-viewport"
      onWheel={handleWheel}
      onPointerDown={handlePointerDownBg}
      onPointerMove={handlePointerMoveBg}
      onPointerUp={handlePointerUpBg}
      className="relative w-full h-full min-h-0 flex-1 overflow-hidden bg-surface-1 select-none touch-none cursor-grab active:cursor-grabbing"
    >
      <div
        className="absolute inset-0 pointer-events-none opacity-25"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #36507a 1px, transparent 0)`,
          backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-surface-2/95 backdrop-blur-md p-1.5 rounded-xl shadow-xl">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.15, 2.2))}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-surface-3 text-[#9bb0d1] transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.15, 0.4))}
          className="p-1.5 sm:p-2 rounded-lg hover:bg-surface-3 text-[#9bb0d1] transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <div className="w-[1px] h-4 bg-surface-3 mx-0.5" />
        <button
          onClick={fitViewToNodes}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-3 text-xs font-medium text-[#c4d5f2] transition-colors"
          title="Recenter and Fit Screen"
        >
          <Maximize2 className="w-3.5 h-3.5 text-[#5d87b8]" />
          <span className="hidden sm:inline">Fit Screen</span>
        </button>
        <button
          onClick={handleAutoArrange}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-[#67e8f9] shadow-sm transition-all cursor-pointer"
          title="Animate and automatically space nodes using physics forces"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Auto-Space</span>
        </button>
      </div>

      {linkingSourceNode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-surface-2 text-[#cbe9fb] px-4 py-2 rounded-full text-xs font-mono shadow-2xl flex items-center gap-2 animate-bounce">
          <LinkIcon className="w-3.5 h-3.5 text-[#38bdf8]" />
          <span>Click target node to connect (From: {linkingSourceNode.title})</span>
          <button
            onClick={() => setLinkingSourceNode(null)}
            className="ml-2 text-xs bg-surface-0 px-2 py-0.5 rounded text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ overflow: 'visible' }}
      >
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map((edge) => {
            const sourceNode = nodes.find((n) => n.id === edge.sourceId);
            const targetNode = nodes.find((n) => n.id === edge.targetId);
            if (!sourceNode || !targetNode) return null;

            const clip = clipEdgeToNodeRects(
              { x: sourceNode.x, y: sourceNode.y, width: NODE_CARD_WIDTH, height: NODE_CARD_HEIGHT },
              { x: targetNode.x, y: targetNode.y, width: NODE_CARD_WIDTH, height: NODE_CARD_HEIGHT }
            );
            const { sx, sy, tx, ty, midX, midY } = clip;
            // BUG-004: the label is sized to its text and centered on the
            // card edge to card edge midpoint — the open gap between the two cards.
            const labelW = Math.max(56, edge.kind.length * 6 + 16);

            return (
              <g key={edge.id}>
                <path
                  d={`M ${sx} ${sy} Q ${midX} ${midY - 20} ${tx} ${ty}`}
                  fill="none"
                  stroke="#4f6e99"
                  strokeWidth="2"
                  strokeOpacity="0.8"
                />
                <rect
                  x={midX - labelW / 2}
                  y={midY - 26}
                  width={labelW}
                  height="16"
                  rx="4"
                  fill="#101724"
                  stroke="#273854"
                  strokeWidth="1"
                />
                <text
                  x={midX}
                  y={midY - 14}
                  textAnchor="middle"
                  fill="#9cb4d9"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {edge.kind}
                </text>
              </g>
            );
          })}

          {tentativeLinks.map((link: TentativeLink) => {
            const sx = link.sourceNode.x + 105;
            const sy = link.sourceNode.y + 40;
            const tx = link.targetNode.x + 105;
            const ty = link.targetNode.y + 40;
            const midX = (sx + tx) / 2;
            const midY = (sy + ty) / 2;
            const isHighlighted =
              selectedNodeId === link.sourceNode.id || selectedNodeId === link.targetNode.id;

            return (
              <g key={link.id} opacity={isHighlighted ? 0.95 : 0.65}>
                <path
                  d={`M ${sx} ${sy} Q ${midX} ${midY + 28} ${tx} ${ty}`}
                  fill="none"
                  stroke={isHighlighted ? '#e05a66' : '#d48a37'}
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <rect
                  x={midX - 48}
                  y={midY + 20}
                  width="96"
                  height="16"
                  rx="4"
                  fill="#121822"
                  stroke={isHighlighted ? '#e05a66' : '#6e4b21'}
                  strokeWidth="1"
                />
                <text
                  x={midX}
                  y={midY + 31}
                  textAnchor="middle"
                  fill="#f5c276"
                  fontSize="8.5"
                  fontFamily="monospace"
                >
                  #{link.sharedTags[0]} (tentative)
                </text>
              </g>
            );
          })}

          {linkingSourceNode && (
            <line
              x1={linkingSourceNode.x + NODE_CARD_WIDTH / 2}
              y1={linkingSourceNode.y + NODE_CARD_HEIGHT / 2}
              x2={mouseCanvasPos.x}
              y2={mouseCanvasPos.y}
              stroke="#38bdf8"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          )}
        </g>
      </svg>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {nodes.map((node) => {
          const isSelected = selectedNodeId === node.id;

          return (
            <div
              key={node.id}
              style={{
                transform: `translate(${node.x}px, ${node.y}px)`,
                width: `${NODE_CARD_WIDTH}px`,
                height: `${NODE_CARD_HEIGHT}px`,
                // Neutral dark elevation — the card is NOT lit by the
                // artifact's own hue (that red halo read as a leaked
                // selection cursor). Selection is the only accent (BUG-005).
                boxShadow: isSelected
                  ? '0 0 20px -4px rgba(56,189,248,0.45)'
                  : '0 1px 2px rgb(0 0 0 / 0.35), 0 12px 26px -14px rgb(0 0 0 / 0.72)',
              }}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              onDoubleClick={() => {
                if (node.artifact) onSelectArtifact(node.artifact);
              }}
              className={`absolute pointer-events-auto rounded-xl p-3 backdrop-blur-md cursor-grab active:cursor-grabbing transition-shadow select-none bg-surface-2/95 border ${
                isSelected
                  ? 'border-accent ring-2 ring-accent'
                  : 'border-transparent'
              }`}
            >
              {/* Lean card: Type + Title only. Click = select, drag = move,
                  double-click = open. No inner buttons — the bottom-left
                  detail card carries tags / Link / Open (BUG-001/002). */}
              <div className="flex items-center text-10 font-mono mb-1.5">
                <span className="px-1.5 py-0.5 rounded text-9 font-semibold bg-surface-3 text-[#8ab1e0] truncate">
                  {node.type}
                </span>
              </div>

              <div className="font-semibold text-xs text-ink truncate font-mono">
                {node.title}
              </div>
            </div>
          );
        })}
      </div>

      {selectedNode && (
        /* Bottom-RIGHT, raised to bottom-16 (64px): the lens pill
            (Folders/Graph/Proximity) and the "back to chat" bubble both sit
            at bottom-4 and reach ~54-56px up, so 64px clears the bottom row
            without covering either control. */
        <div className="absolute bottom-16 right-3 z-30 w-80 max-w-[calc(100vw-1.5rem)] bg-surface-2/95 backdrop-blur-md border border-line rounded-xl p-3.5 shadow-2xl">
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <span className="font-bold text-xs text-ink line-clamp-2">{selectedNode.title}</span>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="text-11 text-[#7185a3] hover:text-ink shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="text-11 text-[#8ba0bf] mb-2.5">
            Type: <span className="capitalize">{selectedNode.type}</span>
          </div>

          {(() => {
            const tags = selectedNode.tags || selectedNode.artifact.tags || [];
            if (tags.length === 0) return null;
            return (
              <div className="flex flex-wrap gap-1 mb-2.5">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onFilterByTag?.(t)}
                    title={`Filter the folder tree by #${t}`}
                    className="inline-flex items-center min-h-[30px] px-2 text-9 font-mono rounded bg-surface-2 hover:bg-surface-4 hover:text-ink text-[#8ab1e0] cursor-pointer transition-colors"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            );
          })()}

          <div className="flex items-center gap-2">
            <button
              onClick={() => setLinkingSourceNode(selectedNode)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-3 hover:bg-surface-4 text-[#9bb0d1] hover:text-ink text-11 font-medium transition-colors cursor-pointer"
              title="Connect this artifact to another node"
            >
              <LinkIcon className="w-3 h-3" />
              <span>Link to…</span>
            </button>

            {selectedNode.artifactId && (
              <button
                onClick={() => {
                  const art = selectedNode.artifact;
                  if (art) onSelectArtifact(art);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-4 hover:bg-surface-5 text-[#67e8f9] text-11 font-semibold transition-colors cursor-pointer"
                title="Open the artifact detail view"
              >
                <span>Open</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
