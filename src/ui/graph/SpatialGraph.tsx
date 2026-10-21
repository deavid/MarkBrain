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
      if (n.x + 220 > maxX) maxX = n.x + 220;
      if (n.y + 110 > maxY) maxY = n.y + 110;
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
      const idealSpringLength = 220;
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
      setDraggingNodeId(null);
      dragStartRef.current = null;
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
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-xs font-semibold text-[#f08b98] shadow-sm transition-all cursor-pointer"
          title="Animate and automatically space nodes using physics forces"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#e65a6c]" />
          <span>Auto-Space</span>
        </button>
      </div>

      {linkingSourceNode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-surface-2 text-[#fad4d8] px-4 py-2 rounded-full text-xs font-mono shadow-2xl flex items-center gap-2 animate-bounce">
          <LinkIcon className="w-3.5 h-3.5 text-[#e65a6c]" />
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

            const sx = sourceNode.x + 105;
            const sy = sourceNode.y + 40;
            const tx = targetNode.x + 105;
            const ty = targetNode.y + 40;

            const midX = (sx + tx) / 2;
            const midY = (sy + ty) / 2;

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
                  x={midX - 40}
                  y={midY - 26}
                  width="80"
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
              x1={linkingSourceNode.x + 105}
              y1={linkingSourceNode.y + 40}
              x2={mouseCanvasPos.x}
              y2={mouseCanvasPos.y}
              stroke="#e65a6c"
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
          const art = node.artifact;
          const tags = node.tags || art.tags || [];
          const artColor = art?.color || '#5d87b8';

          return (
            <div
              key={node.id}
              style={{
                transform: `translate(${node.x}px, ${node.y}px)`,
                width: '220px',
                // A node is LIT by its own hue, not outlined by it: a wide soft
                // halo reads as depth, where a 1px ring read as a fence.
                boxShadow: `0 1px 2px rgb(0 0 0 / 0.35), 0 12px 26px -14px rgb(0 0 0 / 0.72), 0 0 0 6px ${artColor}12, 0 10px 26px -6px ${artColor}26`,
              }}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              className={`absolute pointer-events-auto rounded-xl p-3 backdrop-blur-md cursor-grab active:cursor-grabbing transition-shadow select-none bg-surface-2/95 ${
                isSelected ? 'ring-2 ring-[#e65a6c]' : ''
              }`}
            >
              <div className="flex items-center justify-between text-[10px] font-mono mb-1.5 gap-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                    style={{ backgroundColor: artColor }}
                  />
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-surface-3 text-[#8ab1e0] truncate">
                    {node.type}
                  </span>
                </div>

              </div>

              <div className="font-semibold text-xs text-ink truncate mb-1.5 font-mono">
                {node.title}
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {tags.slice(0, 3).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFilterByTag?.(t);
                      }}
                      title={`Filter the folder tree by #${t}`}
                      className="inline-flex items-center min-h-[30px] px-2 text-[9px] font-mono rounded bg-surface-2 hover:bg-surface-4 hover:text-ink text-[#7da0cf] cursor-pointer transition-colors"
                    >
                      #{t}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] text-[#869ab8] pt-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setLinkingSourceNode(node);
                  }}
                  className="flex items-center gap-1 p-1 min-h-[30px] rounded hover:bg-surface-3 text-[#9bb0d1] transition-colors cursor-pointer"
                  title="Connect Edge"
                >
                  <LinkIcon className="w-3 h-3 text-[#5d87b8]" />
                  <span>Link</span>
                </button>

                <div className="flex items-center gap-1">
                  {node.artifactId && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (art) onSelectArtifact(art);
                      }}
                      className="px-2 py-0.5 flex items-center justify-center min-h-[30px] rounded bg-surface-4 hover:bg-surface-5 text-[#8ab1e0] text-[10px] font-medium transition-colors cursor-pointer"
                      title="Inspect specification"
                    >
                      Spec
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedNode && (
        <div className="absolute bottom-3 left-3 right-3 sm:left-auto sm:right-3 sm:w-80 z-30 bg-surface-2/95 backdrop-blur-md rounded-xl p-3 shadow-2xl">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-xs text-ink truncate">{selectedNode.title}</span>
            <button
              onClick={() => setSelectedNodeId(null)}
              className="text-[11px] text-[#7185a3] hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div className="text-[11px] text-[#8ba0bf] mb-2.5">
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
                    className="inline-flex items-center min-h-[30px] px-2 text-[9px] font-mono rounded bg-surface-2 hover:bg-surface-4 hover:text-ink text-[#8ab1e0] cursor-pointer transition-colors"
                  >
                    #{t}
                  </button>
                ))}
              </div>
            );
          })()}

          {(() => {
            const nodeTentatives = tentativeLinks.filter(
              (l: TentativeLink) => l.sourceNode.id === selectedNode.id || l.targetNode.id === selectedNode.id
            );
            if (nodeTentatives.length === 0) return null;
            return (
              <div className="mb-2.5 pt-2 space-y-1.5">
                <div className="text-[10px] font-mono text-[#d48a37] flex items-center justify-between">
                  <span>Tentative Cross-Links ({nodeTentatives.length})</span>
                  <span className="text-[9px] text-[#869ab8]">Shared tags</span>
                </div>
                {nodeTentatives.map((tLink: TentativeLink) => {
                  const otherNode =
                    tLink.sourceNode.id === selectedNode.id ? tLink.targetNode : tLink.sourceNode;
                  return (
                    <div
                      key={tLink.id}
                      className="flex items-center justify-between p-1.5 rounded bg-surface-2 text-[10px]"
                    >
                      <div className="truncate mr-1">
                        <span className="text-ink font-medium">{otherNode.title}</span>
                        <span className="text-[#d48a37] font-mono ml-1">#{tLink.sharedTags[0]}</span>
                      </div>
                      <button
                        onClick={() => {
                          // Shared-tag intent maps to the domain kind 'relates_to'.
                          onAddEdge(selectedNode.id, otherNode.id, 'relates_to', 0.6);
                        }}
                        className="px-2 py-0.5 rounded bg-surface-3 hover:bg-surface-4 text-[#f5c276] shrink-0 font-mono text-[9px] font-bold cursor-pointer"
                      >
                        + Connect
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {selectedNode.artifactId && (
            <button
              onClick={() => {
                const art = selectedNode.artifact;
                if (art) onSelectArtifact(art);
              }}
              className="w-full py-1.5 bg-[#a33945] hover:bg-[#b8424f] text-ink rounded-lg text-xs font-semibold shadow-md transition-colors"
            >
              Open in Artifacts Desk
            </button>
          )}
        </div>
      )}
    </div>
  );
};
