/**
 * Plot Planner Pro - 2D Drafting Engine (Part 1)
 */

// State Management
const state = {
    activeTool: 'select', // 'select', 'line', 'measure'
    scale: '1:100',       // '1:100', '1:50', '1:200'
    unit: 'feet',         // 'feet', 'meters'
    snapToGrid: true,
    gridSize: 25,         // in pixels
    activeColor: '#1e40af', // blueprint blue
    activeWeight: 2,      // line weight
    lines: [],            // List of completed lines: { startX, startY, endX, endY, color, weight }
    drawing: false,
    startPoint: null,     // { x, y } screen coords
    currentPoint: null,   // { x, y } screen coords
    hoverPoint: null,     // { x, y } screen coords for snap preview
    isShiftPressed: false,
    
    // Part 3: Regulatory & Survey Checklist State
    authority: 'lda',     // 'lda', 'cda', 'ruda'
    basement: false,
    roadWidth: 30,        // in feet
    neighborFront: 'road',
    neighborLeft: '1-floor',
    neighborRight: 'empty',
    neighborRear: '2-floor',
    soil: 'clay',
    activePinDrop: null,  // 'water', 'gas', 'electric', or null
    pins: [],             // Array of pins: { x, y, type }
    
    // Part 4: Geo-Energy & Microclimate State
    simOrientation: 'north',
    simTime: 12,          // slider value 6 to 18
    simSeason: 'summer',  // 'summer' or 'winter'
    simSunPath: false,
    simWind: false,
    simNoise: false,

    // Advanced Upgrades State
    floorPlanView: 'board',        // 'board' or 'floor'
    floorPlanCount: 1,            // 1, 2, or 3
    floorPlanActiveFloor: 0,      // 0, 1, or 2
    floorPlanCorridor: true,
    floorPlanData: null,          // Procedural floors layout list
    traceImage: null,             // Background tracing layer object
    imported3DModel: null,        // Imported STL/OBJ Three.js geometry reference

    // Part 5: Collaboration & BOM Estimator State
    activeRole: 'owner',  // 'owner', 'architect', 'engineer', 'client'
    rates: {
        brick: 15,
        cement: 1400,
        sand: 80,
        tiles: 250
    },
    comments: [
        { role: 'architect', text: 'LDA setback limits look compliant. Setback offset is correctly drawn at the front.', time: '01:05' },
        { role: 'engineer', text: 'CDA basement check requires at least 5ft rear setback for proper ventilation. Validated.', time: '01:11' },
        { role: 'owner', text: 'BOM and local cost calculations are aligned with current market rates. Let\'s proceed.', time: '01:14' }
    ]
};

// Conversions
// pixel to physical units based on scale and units settings
// feet:
//   1:100 -> 1 px = 0.1 ft (10px = 1ft)
//   1:50  -> 1 px = 0.05 ft (20px = 1ft)
//   1:200 -> 1 px = 0.2 ft (5px = 1ft)
// meters:
//   1:100 -> 1 px = 0.04 m (25px = 1m)
//   1:50  -> 1 px = 0.02 m (50px = 1m)
//   1:200 -> 1 px = 0.08 m (12.5px = 1m)
const pxPerUnit = () => 1 / getPixelToPhysicalFactor();
const getPixelToPhysicalFactor = () => {
    if (state.unit === 'feet') {
        switch (state.scale) {
            case '1:50': return 0.05;
            case '1:200': return 0.2;
            case '1:100':
            default: return 0.1;
        }
    } else if (state.unit === 'yards') {
        switch (state.scale) {
            case '1:50': return 0.05 / 3;
            case '1:200': return 0.2 / 3;
            case '1:100':
            default: return 0.1 / 3;
        }
    } else { // meters
        switch (state.scale) {
            case '1:50': return 0.02;
            case '1:200': return 0.08;
            case '1:100':
            default: return 0.04;
        }
    }
};

// DOM Elements
const canvas = document.getElementById('drafting-canvas');
const ctx = canvas.getContext('2d');
const canvasContainer = document.getElementById('canvas-container');

// UI Controls
const toolSelectBtn = document.getElementById('tool-select');
const toolLineBtn = document.getElementById('tool-line');
const toolMeasureBtn = document.getElementById('tool-measure');
const toolClearBtn = document.getElementById('tool-clear');

const scaleSelect = document.getElementById('scale-select');
const unitSelect = document.getElementById('unit-select');
const snapToggle = document.getElementById('snap-toggle');
const gridSizeSlider = document.getElementById('grid-size');
const gridSizeVal = document.getElementById('grid-size-val');
const lineWeightSelect = document.getElementById('line-weight');
const colorDots = document.querySelectorAll('.color-dot');

// Status Bar & Diagnostics
const statusActiveTool = document.getElementById('status-active-tool');
const statusActiveScale = document.getElementById('status-active-scale');
const coordX = document.getElementById('coord-x');
const coordY = document.getElementById('coord-y');
const statLinesCount = document.getElementById('stat-lines-count');
const statPerimeter = document.getElementById('stat-perimeter');

// Initialize Canvas Dimension for High DPI
const resizeCanvas = () => {
    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set actual screen width/height for layout
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    
    // Set buffer width/height scaled by pixel ratio
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    // Normalize coordinate system to align with CSS pixels
    ctx.scale(dpr, dpr);
    
    draw();
};

// Helper: Snap to Grid Point
const getSnappedPoint = (x, y) => {
    if (!state.snapToGrid) return { x, y };
    
    const snappedX = Math.round(x / state.gridSize) * state.gridSize;
    const snappedY = Math.round(y / state.gridSize) * state.gridSize;
    
    return { x: snappedX, y: snappedY };
};

// Helper: Format Length string
const formatLength = (pxLength) => {
    const factor = getPixelToPhysicalFactor();
    const physLength = pxLength * factor;
    const suffix = state.unit === 'feet' ? 'ft' : (state.unit === 'yards' ? 'yd' : 'm');
    return `${physLength.toFixed(2)} ${suffix}`;
};

// Calculate all stats
const updateStats = () => {
    statLinesCount.textContent = state.lines.length;
    
    let totalPxLength = 0;
    state.lines.forEach(line => {
        totalPxLength += Math.hypot(line.endX - line.startX, line.endY - line.startY);
    });
    
    statPerimeter.textContent = formatLength(totalPxLength);
    if (typeof recalculateBOM === 'function') {
        recalculateBOM();
    }
};

// Drawing Functions
const drawGrid = (width, height) => {
    ctx.strokeStyle = '#e2e8f0'; // Subtle grid color
    ctx.lineWidth = 0.5;
    
    // Draw vertical grid lines
    for (let x = 0; x < width; x += state.gridSize) {
        ctx.beginPath();
        // Major grid line every 5 steps
        if (x % (state.gridSize * 5) === 0) {
            ctx.strokeStyle = '#cbd5e1'; // Stronger major line
            ctx.lineWidth = 1;
        } else {
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 0.5;
        }
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    
    // Draw horizontal grid lines
    for (let y = 0; y < height; y += state.gridSize) {
        ctx.beginPath();
        // Major grid line every 5 steps
        if (y % (state.gridSize * 5) === 0) {
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1;
        } else {
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 0.5;
        }
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
};

const drawLineWithLabel = (x1, y1, x2, y2, color, weight, isDashed = false) => {
    ctx.save();
    
    // Draw Line
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    if (isDashed) {
        ctx.setLineDash([6, 4]);
    } else {
        ctx.setLineDash([]);
    }
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    // Draw Length Label
    const dx = x2 - x1;
    const dy = y2 - y1;
    const pxLength = Math.hypot(dx, dy);
    
    if (pxLength > 15) { // Only show label if line is reasonably long
        const midX = x1 + dx / 2;
        const midY = y1 + dy / 2;
        let angle = Math.atan2(dy, dx);
        
        // Normalize angle so text is never upside down (between -90 and 90 deg)
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
            angle += Math.PI;
        }
        
        const labelText = formatLength(pxLength);
        
        ctx.translate(midX, midY);
        ctx.rotate(angle);
        
        // Label background shield to keep grid from cluttering text
        ctx.font = '500 11px "Space Grotesk", sans-serif';
        const textWidth = ctx.measureText(labelText).width;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-textWidth/2 - 6, -18, textWidth + 12, 14);
        
        // Label Border
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-textWidth/2 - 6, -18, textWidth + 12, 14);
        
        // Text
        ctx.fillStyle = '#1e3a8a'; // Deep Navy Blue
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, 0, -11);
    }
    
    ctx.restore();
};

const drawSnapIndicator = (point) => {
    if (!point || !state.snapToGrid) return;
    
    ctx.save();
    ctx.strokeStyle = '#3b82f6'; // Sky Blue highlight
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // Architectural crosshair box
    const size = 5;
    ctx.strokeRect(point.x - size, point.y - size, size * 2, size * 2);
    
    // Draw tiny inner dot
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
};

// --- Part 3 Setbacks & Neighbors Visual Draw Helpers ---

const drawAdjacentBlock = (pStart, pEnd, depth, label, type) => {
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    
    // Outward normal vector (pointing outwards from boundary loop)
    const nx = dy / len;
    const ny = -dx / len;
    
    const opStart = { x: pStart.x + nx * depth, y: pStart.y + ny * depth };
    const opEnd = { x: pEnd.x + nx * depth, y: pEnd.y + ny * depth };
    
    ctx.save();
    if (type === 'shadow') {
        ctx.strokeStyle = 'transparent';
        ctx.lineWidth = 0;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
    } else if (type === 'empty') {
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillStyle = 'rgba(241, 245, 249, 0.15)';
    } else {
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(226, 232, 240, 0.6)';
    }
    
    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(opStart.x, opStart.y);
    ctx.lineTo(opEnd.x, opEnd.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.closePath();
    ctx.fill();
    if (type !== 'shadow') ctx.stroke();
    
    // Draw label centered inside neighbor box
    if (type !== 'shadow' && label) {
        const cx = (pStart.x + opEnd.x) / 2;
        const cy = (pStart.y + opEnd.y) / 2;
        let angle = Math.atan2(dy, dx);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
            angle += Math.PI;
        }
        
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        ctx.fillStyle = '#475569';
        ctx.font = '600 9px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 0, 0);
    }
    ctx.restore();
};

const drawAccessRoad = (pStart, pEnd, scaleFactor) => {
    const dx = pEnd.x - pStart.x;
    const dy = pEnd.y - pStart.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    
    const nx = dy / len;
    const ny = -dx / len;
    
    const roadDepth = state.roadWidth * scaleFactor;
    const opStart = { x: pStart.x + nx * roadDepth, y: pStart.y + ny * roadDepth };
    const opEnd = { x: pEnd.x + nx * roadDepth, y: pEnd.y + ny * roadDepth };
    
    ctx.save();
    // Road body
    ctx.fillStyle = '#e2e8f0';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(opStart.x, opStart.y);
    ctx.lineTo(opEnd.x, opEnd.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Yellow centerline
    const midStart = { x: pStart.x + nx * (roadDepth/2), y: pStart.y + ny * (roadDepth/2) };
    const midEnd = { x: pEnd.x + nx * (roadDepth/2), y: pEnd.y + ny * (roadDepth/2) };
    ctx.strokeStyle = '#eab308'; // Amber/Yellow
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(midStart.x, midStart.y);
    ctx.lineTo(midEnd.x, midEnd.y);
    ctx.stroke();
    
    // Label
    const cx = (pStart.x + opEnd.x) / 2;
    const cy = (pStart.y + opEnd.y) / 2;
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
        angle += Math.PI;
    }
    
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = '#475569';
    ctx.font = '700 10px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`ROAD (${state.roadWidth} ft Wide)`, 0, 0);
    ctx.restore();
};

const drawDashedOffsetLine = (pA, pB, offsetPx, color, label) => {
    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    
    // Inward normal vector
    const nx = -dy / len;
    const ny = dx / len;
    
    // Offset points
    const opA = { x: pA.x + nx * offsetPx, y: pA.y + ny * offsetPx };
    const opB = { x: pB.x + nx * offsetPx, y: pB.y + ny * offsetPx };
    
    // Draw dashed line
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(opA.x, opA.y);
    ctx.lineTo(opB.x, opB.y);
    ctx.stroke();
    
    // Draw Label text parallel to the setback line
    ctx.fillStyle = color;
    ctx.font = '700 10px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    
    const midX = (opA.x + opB.x) / 2;
    const midY = (opA.y + opB.y) / 2;
    let angle = Math.atan2(dy, dx);
    if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
        angle += Math.PI;
    }
    
    ctx.translate(midX, midY);
    ctx.rotate(angle);
    ctx.fillText(label, 0, -4);
    ctx.restore();
};

const drawSoilBadge = () => {
    ctx.save();
    const rect = canvas.getBoundingClientRect();
    
    const badgeW = 135;
    const badgeH = 26;
    const x = rect.width - badgeW - 14;
    const y = 14;
    
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, badgeW, badgeH, 6);
    ctx.fill();
    ctx.stroke();
    
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 10px "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const soilLabel = state.soil.charAt(0).toUpperCase() + state.soil.slice(1);
    ctx.fillText(`🌾 Soil Type: ${soilLabel}`, x + 10, y + badgeH / 2);
    ctx.restore();
};

const drawPins = () => {
    state.pins.forEach(pin => {
        ctx.save();
        let color = '#2563eb'; // Water blue
        let label = '💧 Water Pin';
        if (pin.type === 'gas') {
            color = '#ea580c'; // Gas orange
            label = '🔥 Gas Meter';
        } else if (pin.type === 'electric') {
            color = '#dc2626'; // Power red
            label = '⚡ Power Pole';
        }
        
        // Draw pin marker
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 11, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        // Label with background
        ctx.font = 'bold 9px "Space Grotesk", sans-serif';
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.roundRect(pin.x - textW/2 - 6, pin.y + 14, textW + 12, 16, 4);
        ctx.fill();
        ctx.strokeStyle = 'rgba(15, 30, 54, 0.15)';
        ctx.stroke();
        
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, pin.x, pin.y + 22);
        ctx.restore();
    });
};

// Main Rendering Loop
const draw = () => {
    // Clear canvas
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    if (state.floorPlanView === 'floor') {
        drawFloorPlanBlueprint();
        return;
    }
    
    // Draw Technical Grid
    drawGrid(rect.width, rect.height);
    
    // Draw Tracing Layer if exists
    drawTraceLayer();
    
    // Get auto-generated plot template from math engine
    const plotData = getCenteredPlotVertices(rect.width, rect.height);
    
    if (plotData) {
        const { vertices, scaleFactor } = plotData;
        const [P0, P1, P2, P3] = vertices;
        const cx = (P0.x + P2.x) / 2;
        const cy = (P0.y + P2.y) / 2;
        
        // 1. Calculate & Draw Cast Shadows (Part 4)
        let sx = 0, sy = 0;
        if (state.simSunPath) {
            const theta = (state.simTime - 6) / 12 * Math.PI;
            const shadowLen = Math.max(5, Math.abs(12 - state.simTime) * 12);
            sx = -Math.cos(theta) * shadowLen;
            sy = -Math.sin(theta) * shadowLen;
            
            // Plot boundary shadow
            ctx.save();
            ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
            ctx.beginPath();
            ctx.moveTo(P0.x + sx, P0.y + sy);
            ctx.lineTo(P1.x + sx, P1.y + sy);
            ctx.lineTo(P2.x + sx, P2.y + sy);
            ctx.lineTo(P3.x + sx, P3.y + sy);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
            
            // Neighbors shadows
            drawAdjacentBlock({x: P3.x + sx, y: P3.y + sy}, {x: P0.x + sx, y: P0.y + sy}, 45, '', 'shadow');
            drawAdjacentBlock({x: P1.x + sx, y: P1.y + sy}, {x: P2.x + sx, y: P2.y + sy}, 45, '', 'shadow');
            drawAdjacentBlock({x: P2.x + sx, y: P2.y + sy}, {x: P3.x + sx, y: P3.y + sy}, 45, '', 'shadow');
        }
        
        // 2. Draw Access Road
        if (state.roadWidth > 0) {
            drawAccessRoad(P0, P1, scaleFactor);
        }
        
        // 3. Draw Adjacent Neighbors
        const frontType = ['1-floor', '2-floor', 'commercial'].includes(state.neighborFront) ? 'solid' : 'empty';
        const leftType = ['1-floor', '2-floor', 'commercial'].includes(state.neighborLeft) ? 'solid' : 'empty';
        const rightType = ['1-floor', '2-floor', 'commercial'].includes(state.neighborRight) ? 'solid' : 'empty';
        const rearType = ['1-floor', '2-floor', 'commercial'].includes(state.neighborRear) ? 'solid' : 'empty';
        
        if (frontType === 'solid') drawAdjacentBlock(P0, P1, 45, `Front: ${state.neighborFront.toUpperCase()}`, frontType);
        drawAdjacentBlock(P3, P0, 45, `Left: ${state.neighborLeft.toUpperCase()}`, leftType);
        drawAdjacentBlock(P1, P2, 45, `Right: ${state.neighborRight.toUpperCase()}`, rightType);
        drawAdjacentBlock(P2, P3, 45, `Rear: ${state.neighborRear.toUpperCase()}`, rearType);
        
        // 4. Draw Plot Boundary
        ctx.save();
        ctx.strokeStyle = '#1d4ed8'; // blueprint royal blue
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(P0.x, P0.y);
        ctx.lineTo(P1.x, P1.y);
        ctx.lineTo(P2.x, P2.y);
        ctx.lineTo(P3.x, P3.y);
        ctx.closePath();
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(37, 99, 235, 0.02)';
        ctx.fill();
        ctx.restore();
        
        // 5. Draw Boundary Length Labels
        drawLineWithLabel(P0.x, P0.y, P1.x, P1.y, '#1e40af', 1.5, false); // Side A (Top)
        drawLineWithLabel(P1.x, P1.y, P2.x, P2.y, '#1e40af', 1.5, false); // Side B (Right)
        drawLineWithLabel(P2.x, P2.y, P3.x, P3.y, '#1e40af', 1.5, false); // Side C (Bottom)
        drawLineWithLabel(P3.x, P3.y, P0.x, P0.y, '#1e40af', 1.5, false); // Side D (Left)
        
        // 6. Draw Sound Pollution overlay (Part 4)
        if (state.simNoise) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(P0.x, P0.y);
            ctx.lineTo(P1.x, P1.y);
            ctx.lineTo(P2.x, P2.y);
            ctx.lineTo(P3.x, P3.y);
            ctx.closePath();
            ctx.clip(); // clip to plot boundary
            
            // Linear gradient from mid top (road) to mid bottom
            const midTopX = (P0.x + P1.x) / 2;
            const midTopY = (P0.y + P1.y) / 2;
            const midBottomX = (P2.x + P3.x) / 2;
            const midBottomY = (P2.y + P3.y) / 2;
            
            const grad = ctx.createLinearGradient(midTopX, midTopY, midBottomX, midBottomY);
            grad.addColorStop(0, 'rgba(239, 68, 68, 0.45)'); // Red near road
            grad.addColorStop(0.25, 'rgba(249, 115, 22, 0.3)'); // Orange
            grad.addColorStop(0.6, 'rgba(234, 179, 8, 0.15)'); // Yellow
            grad.addColorStop(0.9, 'rgba(34, 197, 94, 0.08)'); // Green
            grad.addColorStop(1, 'rgba(34, 197, 94, 0.02)');
            
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, rect.width, rect.height);
            ctx.restore();
        }
        
        // 7. Draw Regulatory Setbacks
        let setbackFront = 0; // in feet
        let setbackRear = 0;  // in feet
        
        const areaSqFt = parseFloat(mathAreaSqFt.textContent.replace(/,/g, ''));
        const marlaVal = parseFloat(marlaSelect.value);
        const marlaSize = isNaN(areaSqFt) ? 0 : (areaSqFt / marlaVal);
        
        if (state.authority === 'lda' || state.authority === 'ruda' || state.authority === 'pda' || state.authority === 'qda') {
            if (marlaSize >= 3 && marlaSize <= 5) {
                setbackFront = 5;
            } else if (marlaSize >= 10) {
                setbackFront = 5;
                setbackRear = 5;
            }
        } else if (state.authority === 'cda') {
            if (marlaSize >= 15) {
                setbackFront = 15;
                setbackRear = 8;
            } else {
                setbackFront = 10;
                setbackRear = 5;
            }
        } else if (state.authority === 'sbca') {
            // Karachi SBCA rules
            if (marlaSize >= 15) {
                setbackFront = 15;
                setbackRear = 10;
            } else if (marlaSize >= 8) {
                setbackFront = 10;
                setbackRear = 5;
            } else if (marlaSize >= 3) {
                setbackFront = 5;
            }
        } else if (state.authority === 'gulf') {
            setbackFront = 16.4; // 5 meters
            setbackRear = 10;    // 3 meters
        }
        
        let factor = 1;
        if (state.unit === 'meters') {
            factor = 0.3048;
        } else if (state.unit === 'yards') {
            factor = 1 / 3;
        }
        
        if (setbackFront > 0) {
            const frontOffsetPx = (setbackFront * factor) * scaleFactor;
            drawDashedOffsetLine(P0, P1, frontOffsetPx, '#ea580c', `Front Setback: ${setbackFront} ft`);
        }
        if (setbackRear > 0) {
            const rearOffsetPx = (setbackRear * factor) * scaleFactor;
            drawDashedOffsetLine(P2, P3, rearOffsetPx, '#ea580c', `Rear Setback: ${setbackRear} ft`);
        }
        
        // Update badges
        updateSetbackBadgeStatus(setbackFront, setbackRear);
        
        // 8. Render Solar Path Arc on top of plot template (Part 4)
        if (state.simSunPath) {
            drawSolarArc(cx, cy);
        }
        
        // Draw manual lines on top of the template
        state.lines.forEach(line => {
            drawLineWithLabel(line.startX, line.startY, line.endX, line.endY, line.color, line.weight, false);
        });
        
        if (state.drawing && state.startPoint && state.currentPoint) {
            drawLineWithLabel(
                state.startPoint.x, 
                state.startPoint.y, 
                state.currentPoint.x, 
                state.currentPoint.y, 
                state.activeColor, 
                state.activeWeight, 
                true
            );
            drawSnapIndicator(state.startPoint);
            drawSnapIndicator(state.currentPoint);
        } else if (state.activeTool === 'line' && state.hoverPoint) {
            drawSnapIndicator(state.hoverPoint);
        }
        
    } else {
        // Draw manual lines
        state.lines.forEach(line => {
            drawLineWithLabel(line.startX, line.startY, line.endX, line.endY, line.color, line.weight, false);
        });
        
        if (state.drawing && state.startPoint && state.currentPoint) {
            drawLineWithLabel(
                state.startPoint.x, 
                state.startPoint.y, 
                state.currentPoint.x, 
                state.currentPoint.y, 
                state.activeColor, 
                state.activeWeight, 
                true
            );
            drawSnapIndicator(state.startPoint);
            drawSnapIndicator(state.currentPoint);
        } else if (state.activeTool === 'line' && state.hoverPoint) {
            drawSnapIndicator(state.hoverPoint);
        }
        
        badgeSetbackStatus.textContent = 'Draw plot or enter dimensions for setbacks.';
        
        // Render Solar Path Arc centered on canvas if no plot geometry is entered
        if (state.simSunPath) {
            drawSolarArc(rect.width / 2, rect.height / 2);
        }
    }
    
    // 9. Draw Soil Badge (Part 3)
    drawSoilBadge();
    
    // 10. Draw dropped pins (Part 3)
    drawPins();
    
    // 11. Draw Animated Wind Vectors (Part 4)
    if (state.simWind) {
        drawWindOverlays(rect.width, rect.height);
    }
    
    // 12. Draw active pin hover preview
    if (state.activePinDrop && state.hoverPoint) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        let color = '#3b82f6';
        if (state.activePinDrop === 'gas') color = '#f97316';
        if (state.activePinDrop === 'electric') color = '#ef4444';
        
        ctx.beginPath();
        ctx.arc(state.hoverPoint.x, state.hoverPoint.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
    }
};

// Event Listeners for Drawing
const getMousePos = (e) => {
    const rect = canvas.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
};

canvas.addEventListener('mousedown', (e) => {
    if (state.floorPlanView === 'floor') {
        floorPlanMousedown(e);
        return;
    }
    
    // If placing utility pin, drop it and exit
    if (state.activePinDrop) {
        const mousePos = getMousePos(e);
        const targetPoint = getSnappedPoint(mousePos.x, mousePos.y);
        state.pins.push({
            x: targetPoint.x,
            y: targetPoint.y,
            type: state.activePinDrop
        });
        
        state.activePinDrop = null;
        updatePinButtonsUI();
        draw();
        return;
    }
    
    if (state.activeTool !== 'line') return;
    
    const mousePos = getMousePos(e);
    let targetPoint = getSnappedPoint(mousePos.x, mousePos.y);
    
    if (!state.drawing) {
        state.drawing = true;
        state.startPoint = targetPoint;
        state.currentPoint = targetPoint;
    } else {
        let endPoint = targetPoint;
        if (state.isShiftPressed && state.startPoint) {
            const dx = Math.abs(endPoint.x - state.startPoint.x);
            const dy = Math.abs(endPoint.y - state.startPoint.y);
            if (dx > dy) {
                endPoint.y = state.startPoint.y;
            } else {
                endPoint.x = state.startPoint.x;
            }
        }
        
        if (state.startPoint.x !== endPoint.x || state.startPoint.y !== endPoint.y) {
            state.lines.push({
                startX: state.startPoint.x,
                startY: state.startPoint.y,
                endX: endPoint.x,
                endY: endPoint.y,
                color: state.activeColor,
                weight: state.activeWeight
            });
            updateStats();
            recalculateBOM();
        }
        
        state.drawing = false;
        state.startPoint = null;
        state.currentPoint = null;
    }
    
    draw();
});

canvas.addEventListener('mousemove', (e) => {
    const mousePos = getMousePos(e);
    
    const factor = getPixelToPhysicalFactor();
    const physX = mousePos.x * factor;
    const physY = mousePos.y * factor;
    
    coordX.textContent = physX.toFixed(2);
    coordY.textContent = physY.toFixed(2);
    
    if (state.floorPlanView === 'floor') {
        floorPlanMousemove(e);
        return;
    }
    
    const targetPoint = getSnappedPoint(mousePos.x, mousePos.y);
    state.hoverPoint = targetPoint;
    
    if (state.drawing && state.startPoint) {
        if (state.isShiftPressed) {
            const dx = Math.abs(targetPoint.x - state.startPoint.x);
            const dy = Math.abs(targetPoint.y - state.startPoint.y);
            if (dx > dy) {
                state.currentPoint = { x: targetPoint.x, y: state.startPoint.y };
            } else {
                state.currentPoint = { x: state.startPoint.x, y: targetPoint.y };
            }
        } else {
            state.currentPoint = targetPoint;
        }
    }
    
    draw();
});

// Key Event Listeners for keyboard helper actions
window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        state.isShiftPressed = true;
        if (state.drawing) draw();
    }
    if (e.key === 'Escape') {
        // Cancel active drawing
        state.drawing = false;
        state.startPoint = null;
        state.currentPoint = null;
        if (state.activePinDrop) {
            state.activePinDrop = null;
            updatePinButtonsUI();
        }
        draw();
    }
    // Ctrl + Z Undo shortcut
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
        state.isShiftPressed = false;
        if (state.drawing) draw();
    }
});

window.addEventListener('mouseup', () => {
    if (state.floorPlanView === 'floor') {
        floorPlanMouseup();
    }
});

// UI Tool Selection Buttons Handlers
const selectTool = (toolName) => {
    state.activeTool = toolName;
    
    // UI active buttons styling
    toolSelectBtn.classList.toggle('active', toolName === 'select');
    toolLineBtn.classList.toggle('active', toolName === 'line');
    toolMeasureBtn.classList.toggle('active', toolName === 'measure');
    
    // Cancel drawing if changing tool
    state.drawing = false;
    state.startPoint = null;
    state.currentPoint = null;
    
    // Update footer
    let toolLabel = 'Select / Move';
    if (toolName === 'line') toolLabel = 'Draw Line';
    if (toolName === 'measure') toolLabel = 'Measure Area';
    statusActiveTool.textContent = toolLabel;
    
    draw();
};

toolSelectBtn.addEventListener('click', () => selectTool('select'));
toolLineBtn.addEventListener('click', () => selectTool('line'));
toolMeasureBtn.addEventListener('click', () => selectTool('measure'));

toolClearBtn.addEventListener('click', () => {
    if (confirm('Clear drafting board? All unsaved drawing lines will be lost.')) {
        state.lines = [];
        state.drawing = false;
        state.startPoint = null;
        state.currentPoint = null;
        updateStats();
        draw();
    }
});

// Sidebar Config Controllers Handlers
scaleSelect.addEventListener('change', (e) => {
    state.scale = e.target.value;
    statusActiveScale.textContent = state.scale;
    updateStats();
    draw();
});

unitSelect.addEventListener('change', (e) => {
    state.unit = e.target.value;
    updateStats();
    draw();
    recalculateIrregularPlot();
});

snapToggle.addEventListener('change', (e) => {
    state.snapToGrid = e.target.checked;
    draw();
});

gridSizeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    state.gridSize = val;
    gridSizeVal.textContent = `${val}px`;
    draw();
});

lineWeightSelect.addEventListener('change', (e) => {
    state.activeWeight = parseInt(e.target.value, 10);
});

colorDots.forEach(dot => {
    dot.addEventListener('click', (e) => {
        // Remove active class from other dots
        colorDots.forEach(d => d.classList.remove('active'));
        // Add active class to clicked dot
        dot.classList.add('active');
        state.activeColor = dot.dataset.color;
    });
});

// Setup resizing and initialize
window.addEventListener('resize', resizeCanvas);

// --- Part 2: Irregular Plot Math Engine & Pakistani Converter ---

// Math Engine DOM Elements
const plotSideA = document.getElementById('plot-side-a');
const plotSideB = document.getElementById('plot-side-b');
const plotSideC = document.getElementById('plot-side-c');
const plotSideD = document.getElementById('plot-side-d');
const plotDiagE = document.getElementById('plot-diag-e');
const marlaSelect = document.getElementById('marla-select');

const mathStatusBanner = document.getElementById('math-status-banner');
const mathStatusText = document.getElementById('math-status-text');
const mathAreaSqFt = document.getElementById('math-area-sqft');
const mathAreaSqM = document.getElementById('math-area-sqm');
const urduKanalMarla = document.getElementById('urdu-kanal-marla');
const urduMarlaSarsahi = document.getElementById('urdu-marla-sarsahi');

/**
 * Abstract function using Shoelace Algorithm (Coordinate Geometry)
 * to calculate area of a polygon from an array of coordinates.
 * Note: Calculates area in pixel units squared. To convert to physical units,
 * multiply the result by (getPixelToPhysicalFactor() ** 2).
 * @param {Array<{x: number, y: number}>} coordinates - Screen or model coordinates of the polygon vertices
 * @returns {number} The calculated area of the polygon
 */
function calculateCanvasPolygonArea(coordinates) {
    if (!coordinates || coordinates.length < 3) return 0;
    
    let sum = 0;
    const n = coordinates.length;
    
    for (let i = 0; i < n; i++) {
        const current = coordinates[i];
        const next = coordinates[(i + 1) % n];
        sum += (current.x * next.y) - (next.x * current.y);
    }
    
    return Math.abs(sum) / 2;
}

let recalculateIrregularPlot = () => {
    const a = parseFloat(plotSideA.value);
    const b = parseFloat(plotSideB.value);
    const c = parseFloat(plotSideC.value);
    const d = parseFloat(plotSideD.value);
    const e = parseFloat(plotDiagE.value);
    
    // Check if any side is missing or invalid
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d) || a <= 0 || b <= 0 || c <= 0 || d <= 0) {
        mathStatusBanner.className = 'status-banner info';
        mathStatusText.textContent = 'Enter plot dimensions to calculate.';
        mathAreaSqFt.textContent = '0.00 sq ft';
        mathAreaSqM.textContent = '0.00 m²';
        urduKanalMarla.textContent = '0 Kanal, 0 Marla, 0 Sarsahi';
        urduMarlaSarsahi.textContent = '(or 0 Marlas, 0 Sarsahi)';
        return;
    }
    
    let area = 0;
    let method = 'average';
    let isValid = true;
    
    if (!isNaN(e) && e > 0) {
        // Heron's Triangulation:
        // Triangle 1: Sides a, d, e
        // Triangle 2: Sides b, c, e
        
        // Triangle inequality checks
        const t1Valid = (a + d > e) && (a + e > d) && (d + e > a);
        const t2Valid = (b + c > e) && (b + e > c) && (c + e > b);
        
        if (!t1Valid || !t2Valid) {
            isValid = false;
        } else {
            // Triangle 1 Area
            const s1 = (a + d + e) / 2;
            const area1 = Math.sqrt(s1 * (s1 - a) * (s1 - d) * (s1 - e));
            
            // Triangle 2 Area
            const s2 = (b + c + e) / 2;
            const area2 = Math.sqrt(s2 * (s2 - b) * (s2 - c) * (s2 - e));
            
            area = area1 + area2;
            method = 'heron';
        }
    } else {
        // Fallback: Average Length x Average Width
        const avgLength = (a + c) / 2;
        const avgWidth = (b + d) / 2;
        area = avgLength * avgWidth;
        method = 'average';
    }
    
    if (!isValid) {
        mathStatusBanner.className = 'status-banner error';
        mathStatusText.textContent = 'Invalid dimensions: The sides and diagonal cannot form valid triangles.';
        mathAreaSqFt.textContent = '0.00 sq ft';
        mathAreaSqM.textContent = '0.00 m²';
        urduKanalMarla.textContent = '0 Kanal, 0 Marla, 0 Sarsahi';
        urduMarlaSarsahi.textContent = '(or 0 Marlas, 0 Sarsahi)';
        return;
    }
    
    // Now determine the calculated area values in both sq ft and sq m.
    // The inputs are in the active project units (feet or meters).
    let areaSqFt = 0;
    let areaSqM = 0;
    
    if (state.unit === 'feet') {
        areaSqFt = area;
        areaSqM = area / 10.7639; // 1 sqm = 10.7639 sqft
    } else if (state.unit === 'yards') {
        areaSqFt = area * 9; // 1 sq yard = 9 sqft
        areaSqM = areaSqFt / 10.7639;
    } else { // meters
        areaSqM = area;
        areaSqFt = area * 10.7639;
    }
    
    // Update the displays
    mathAreaSqFt.textContent = `${areaSqFt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} sq ft`;
    mathAreaSqM.textContent = `${areaSqM.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} m²`;
    
    // Update the status banner
    if (method === 'heron') {
        mathStatusBanner.className = 'status-banner success';
        mathStatusText.textContent = 'Triangulated: Exact area calculated using Heron\'s Formula.';
    } else {
        mathStatusBanner.className = 'status-banner warning';
        mathStatusText.textContent = 'Estimation only. For professional accuracy, input a diagonal or coordinates.';
    }
    
    // Pakistani Revenue Unit conversion
    const marlaSize = parseFloat(marlaSelect.value);
    const totalMarlas = areaSqFt / marlaSize;
    
    let kanals = Math.floor(totalMarlas / 20);
    let remainingMarlas = totalMarlas % 20;
    let marlas = Math.floor(remainingMarlas);
    
    // Sarsahi calculation: 1 Marla = 9 Sarsahi
    let sarsahi = Math.round((remainingMarlas - marlas) * 9 * 10) / 10;
    
    // Handle rounding overflows
    if (sarsahi >= 9) {
        sarsahi = 0;
        marlas += 1;
    }
    if (marlas >= 20) {
        marlas = 0;
        kanals += 1;
    }
    
    // Format output
    // Example: "1 Kanal, 0 Marla, 0 Sarsahi"
    urduKanalMarla.textContent = `${kanals} Kanal, ${marlas} Marla, ${sarsahi} Sarsahi`;
    
    // Sub-format: "(or X Marlas, Y Sarsahi)"
    const totalMarlasInt = Math.floor(totalMarlas);
    const totalSarsahi = Math.round((totalMarlas - totalMarlasInt) * 9 * 10) / 10;
    urduMarlaSarsahi.textContent = `(or ${totalMarlasInt} Marla, ${totalSarsahi} Sarsahi)`;
};

// Bind event listeners for Math Engine
[plotSideA, plotSideB, plotSideC, plotSideD, plotDiagE].forEach(input => {
    input.addEventListener('input', () => {
        recalculateIrregularPlot();
        draw();
    });
});
marlaSelect.addEventListener('change', () => {
    recalculateIrregularPlot();
    draw();
});

// --- Part 3 Setback and Survey Checklist Handlers ---

// DOM Elements
const rulesAuthority = document.getElementById('rules-authority');
const cdaPresetsContainer = document.getElementById('cda-presets-container');
const rulesBasementToggle = document.getElementById('rules-basement-toggle');
const badgeBasement = document.getElementById('badge-basement');
const badgeSetbackStatus = document.getElementById('badge-setback-status');

const presetCDA8Marla = document.getElementById('preset-cda-8marla');
const presetCDA1Kanal = document.getElementById('preset-cda-1kanal');

const surveyRoadWidth = document.getElementById('survey-road-width');
const surveySoil = document.getElementById('survey-soil');
const surveyNeighborFront = document.getElementById('survey-neighbor-front');
const surveyNeighborLeft = document.getElementById('survey-neighbor-left');
const surveyNeighborRight = document.getElementById('survey-neighbor-right');
const surveyNeighborRear = document.getElementById('survey-neighbor-rear');

const btnPinWater = document.getElementById('btn-pin-water');
const btnPinGas = document.getElementById('btn-pin-gas');
const btnPinElectric = document.getElementById('btn-pin-electric');
const pinDropStatus = document.getElementById('pin-drop-status');

// Geometry coordinates calculation helper
const getPlotVertices = () => {
    const a = parseFloat(plotSideA.value);
    const b = parseFloat(plotSideB.value);
    const c = parseFloat(plotSideC.value);
    const d = parseFloat(plotSideD.value);
    const e = parseFloat(plotDiagE.value);
    
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d) || a <= 0 || b <= 0 || c <= 0 || d <= 0) {
        return null;
    }
    
    let P0 = { x: 0, y: 0 };
    let P1 = { x: a, y: 0 };
    let P2 = { x: 0, y: 0 };
    let P3 = { x: 0, y: 0 };
    
    const diag = (!isNaN(e) && e > 0) ? e : Math.hypot(a, b);
    
    // Law of Cosines for beta (angle at P0 between Side A and Diagonal)
    if (a + b <= diag || a + diag <= b || b + diag <= a) {
        return null;
    }
    const cosBeta = (a*a + diag*diag - b*b) / (2 * a * diag);
    const beta = Math.acos(cosBeta);
    
    P2.x = diag * Math.cos(beta);
    P2.y = diag * Math.sin(beta);
    
    // Law of Cosines for gamma (angle at P0 between Diagonal and Side D)
    if (d + c <= diag || d + diag <= c || c + diag <= d) {
        return null;
    }
    const cosGamma = (d*d + diag*diag - c*c) / (2 * d * diag);
    const gamma = Math.acos(cosGamma);
    
    const totalAngle = beta + gamma;
    P3.x = d * Math.cos(totalAngle);
    P3.y = d * Math.sin(totalAngle);
    
    return [P0, P1, P2, P3];
};

const getCenteredPlotVertices = (canvasWidth, canvasHeight) => {
    const vertices = getPlotVertices();
    if (!vertices) return null;
    
    const xs = vertices.map(p => p.x);
    const ys = vertices.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const w = maxX - minX;
    const h = maxY - minY;
    
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    
    const margin = 120;
    const availW = canvasWidth - 2 * margin;
    const availH = canvasHeight - 2 * margin;
    
    const s = Math.min(availW / w, availH / h);
    
    const scaledVertices = vertices.map(p => {
        return {
            x: cx + (p.x - (minX + w / 2)) * s,
            y: cy + (p.y - (minY + h / 2)) * s
        };
    });
    
    return {
        vertices: scaledVertices,
        scaleFactor: s
    };
};

const updateSetbackBadgeStatus = (setbackFront, setbackRear) => {
    const authName = state.authority.toUpperCase();
    let statusText = `${authName} Compliance Rules Active. `;
    
    if (setbackFront > 0 && setbackRear > 0) {
        statusText += `Front Setback: ${setbackFront}ft, Rear Setback: ${setbackRear}ft required.`;
    } else if (setbackFront > 0) {
        statusText += `Front Setback: ${setbackFront}ft required.`;
    } else {
        statusText += `No setbacks mandatory for this plot size.`;
    }
    
    badgeSetbackStatus.textContent = statusText;
    
    // CDA Basement validation
    if (state.authority === 'cda' && state.basement) {
        badgeBasement.style.display = 'block';
        if (setbackRear < 5) {
            badgeBasement.textContent = `❌ Rear Setback is ${setbackRear}ft (Minimum 5ft required for Basement ventilation!)`;
            badgeBasement.className = 'compliance-badge warning-badge';
        } else {
            badgeBasement.textContent = `🟢 CDA Compliant Basement Check Required (Ventilation Ok)`;
            badgeBasement.className = 'compliance-badge info-badge';
        }
    } else {
        badgeBasement.style.display = 'none';
    }
};

// Toggle Pin Dropping Tool UI
const togglePinDrop = (type) => {
    if (state.activePinDrop === type) {
        state.activePinDrop = null;
    } else {
        state.activePinDrop = type;
        state.drawing = false;
        state.startPoint = null;
        state.currentPoint = null;
    }
    updatePinButtonsUI();
    draw();
};

const updatePinButtonsUI = () => {
    btnPinWater.classList.toggle('active', state.activePinDrop === 'water');
    btnPinGas.classList.toggle('active', state.activePinDrop === 'gas');
    btnPinElectric.classList.toggle('active', state.activePinDrop === 'electric');
    
    if (state.activePinDrop) {
        pinDropStatus.style.display = 'block';
        pinDropStatus.textContent = `Active: Click canvas to drop ${state.activePinDrop.toUpperCase()} pin`;
    } else {
        pinDropStatus.style.display = 'none';
    }
};

// Event Listeners for Part 3 controls
rulesAuthority.addEventListener('change', (e) => {
    state.authority = e.target.value;
    cdaPresetsContainer.style.display = state.authority === 'cda' ? 'block' : 'none';
    draw();
});

rulesBasementToggle.addEventListener('change', (e) => {
    state.basement = e.target.checked;
    draw();
});

surveyRoadWidth.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.roadWidth = isNaN(val) ? 0 : val;
    draw();
});

surveySoil.addEventListener('change', (e) => {
    state.soil = e.target.value;
    draw();
});

if (surveyNeighborFront) {
    surveyNeighborFront.addEventListener('change', (e) => {
        state.neighborFront = e.target.value;
        draw();
    });
}

surveyNeighborLeft.addEventListener('change', (e) => {
    state.neighborLeft = e.target.value;
    draw();
});

surveyNeighborRight.addEventListener('change', (e) => {
    state.neighborRight = e.target.value;
    draw();
});

surveyNeighborRear.addEventListener('change', (e) => {
    state.neighborRear = e.target.value;
    draw();
});

// Preset Buttons
presetCDA8Marla.addEventListener('click', () => {
    plotSideA.value = 30;
    plotSideB.value = 60;
    plotSideC.value = 30;
    plotSideD.value = 60;
    plotDiagE.value = '';
    
    recalculateIrregularPlot();
    draw();
});

presetCDA1Kanal.addEventListener('click', () => {
    plotSideA.value = 50;
    plotSideB.value = 90;
    plotSideC.value = 50;
    plotSideD.value = 90;
    plotDiagE.value = '';
    
    recalculateIrregularPlot();
    draw();
});

// Pin dropping triggers
btnPinWater.addEventListener('click', () => togglePinDrop('water'));
btnPinGas.addEventListener('click', () => togglePinDrop('gas'));
btnPinElectric.addEventListener('click', () => togglePinDrop('electric'));

// --- Part 4 Geo-Energy & Passive Recommendations Engine ---

let windOffset = 0;
let animationFrameId = null;

const animateWind = () => {
    if (state.simWind) {
        windOffset += 0.4;
        draw();
        animationFrameId = requestAnimationFrame(animateWind);
    } else {
        animationFrameId = null;
    }
};

const startWindAnimation = () => {
    if (!animationFrameId && state.simWind) {
        animateWind();
    }
};

const drawWindOverlays = (width, height) => {
    const phi = state.simSeason === 'summer' ? -Math.PI / 4 : 3 * Math.PI / 4;
    const wx = Math.cos(phi);
    const wy = Math.sin(phi);
    
    ctx.save();
    ctx.strokeStyle = state.simSeason === 'summer' ? 'rgba(59, 130, 246, 0.35)' : 'rgba(14, 165, 233, 0.35)';
    ctx.lineWidth = 1.5;
    
    const spacing = 80;
    for (let gx = -spacing; gx < width + spacing; gx += spacing) {
        for (let gy = -spacing; gy < height + spacing; gy += spacing) {
            const ox = (gx + windOffset * wx * 15) % (width + spacing * 2);
            const oy = (gy + windOffset * wy * 15) % (height + spacing * 2);
            
            const startX = ox < 0 ? ox + width + spacing * 2 : ox;
            const startY = oy < 0 ? oy + height + spacing * 2 : oy;
            
            const arrowLen = 18;
            const endX = startX + wx * arrowLen;
            const endY = startY + wy * arrowLen;
            
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            
            const headLen = 5;
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - Math.cos(phi - Math.PI/6) * headLen, endY - Math.sin(phi - Math.PI/6) * headLen);
            ctx.moveTo(endX, endY);
            ctx.lineTo(endX - Math.cos(phi + Math.PI/6) * headLen, endY - Math.sin(phi + Math.PI/6) * headLen);
            ctx.stroke();
        }
    }
    ctx.restore();
};

const drawSolarArc = (cx, cy) => {
    const R = 150;
    ctx.save();
    
    // East-West Line
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - R - 20, cy);
    ctx.lineTo(cx + R + 20, cy);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(234, 179, 8, 0.5)';
    ctx.font = '600 9px "Space Grotesk", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('W', cx - R - 5, cy - 3);
    ctx.textAlign = 'left';
    ctx.fillText('E', cx + R + 5, cy - 3);
    
    // Solar Arc (South transit)
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI, false);
    ctx.stroke();
    
    // Sun position
    const t = state.simTime;
    const theta = (t - 6) / 12 * Math.PI;
    const sunX = cx + R * Math.cos(theta);
    const sunY = cy + R * Math.sin(theta);
    
    // Sun Glow
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(sunX, sunY, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.shadowBlur = 0; // reset
    
    // Rays
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(sunX + Math.cos(angle) * 11, sunY + Math.sin(angle) * 11);
        ctx.lineTo(sunX + Math.cos(angle) * 14, sunY + Math.sin(angle) * 14);
        ctx.stroke();
    }
    
    // Label
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const hrs = Math.floor(t);
    const mins = t % 1 === 0.5 ? '30' : '00';
    ctx.fillText(`${hrs}:${mins}`, sunX, sunY + 22);
    ctx.restore();
};

const updatePassiveRecommendations = () => {
    const recText = document.getElementById('sim-recommendations');
    if (!recText) return;
    
    let tip = "";
    switch (state.simOrientation) {
        case 'east':
            tip = "Your plot faces East, capturing intense morning sunlight. Bedrooms and kitchens benefit from this early warmth. To manage glare and rapid thermal heat gain in the morning, consider low-emissivity glass coatings or adjustable vertical louvers on the front facade.";
            break;
        case 'south':
            tip = "Your plot faces South. The southern facade receives high-angle summer sun (which can be easily blocked with roof overhangs/pergolas) and low-angle winter sun (providing ideal passive heating). Design deep horizontal overhangs to maximize winter solar entry and block summer heat.";
            break;
        case 'west':
            tip = "Your plot faces West. West facades receive the lowest, harshest solar heat loads during hot summer afternoons. Consider a double-skin facade, vertical louvers, thick insulation, or minimal window openings on the western walls to prevent severe thermal discomfort.";
            break;
        case 'north':
        default:
            tip = "Your plot faces North, providing consistent, cool, glare-free daylight. Southern orientations in the rear will gain major heat. Maximize window openings on the northern wall for natural illumination and use deep setbacks in the rear to manage cooling.";
            break;
    }
    
    recText.textContent = tip;
};

// Part 4 DOM Elements
const simOrientation = document.getElementById('sim-orientation');
const simTimeSlider = document.getElementById('sim-time-slider');
const simTimeVal = document.getElementById('sim-time-val');
const simSeasonToggle = document.getElementById('sim-season-toggle');
const simSeasonLabel = document.getElementById('sim-season-label');

const toggleSunPath = document.getElementById('toggle-sun-path');
const toggleWind = document.getElementById('toggle-wind');
const toggleNoise = document.getElementById('toggle-noise');

// Event Listeners for Part 4
simOrientation.addEventListener('change', (e) => {
    state.simOrientation = e.target.value;
    updatePassiveRecommendations();
    draw();
});

simTimeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.simTime = val;
    
    const hrs = Math.floor(val);
    const mins = val % 1 === 0.5 ? '30' : '00';
    simTimeVal.textContent = `${hrs}:${mins}`;
    
    draw();
});

simSeasonToggle.addEventListener('change', (e) => {
    state.simSeason = e.target.checked ? 'winter' : 'summer';
    simSeasonLabel.textContent = `Season: ${state.simSeason.charAt(0).toUpperCase() + state.simSeason.slice(1)}`;
    draw();
});

toggleSunPath.addEventListener('change', (e) => {
    state.simSunPath = e.target.checked;
    draw();
});

toggleWind.addEventListener('change', (e) => {
    state.simWind = e.target.checked;
    if (state.simWind) {
        startWindAnimation();
    } else {
        draw();
    }
});

toggleNoise.addEventListener('change', (e) => {
    state.simNoise = e.target.checked;
    draw();
});

// --- Part 5 Collaboration, BOM Cost Estimator & Project Exporter ---

// BOM Calculation & Rendering
const recalculateBOM = (isInit = false) => {
    // 1. Calculate total wall length from user lines
    let totalPxLength = 0;
    state.lines.forEach(line => {
        totalPxLength += Math.hypot(line.endX - line.startX, line.endY - line.startY);
    });
    
    // Convert pixels to physical units
    let totalWallLengthFeet = 0;
    const factor = getPixelToPhysicalFactor(); // returns ft/px or m/px
    if (state.unit === 'meters') {
        const totalWallLengthMeters = totalPxLength * factor;
        totalWallLengthFeet = totalWallLengthMeters * 3.28084;
    } else if (state.unit === 'yards') {
        const totalWallLengthYards = totalPxLength * factor;
        totalWallLengthFeet = totalWallLengthYards * 3;
    } else {
        totalWallLengthFeet = totalPxLength * factor;
    }
    
    // 2. Fetch plot footprint area (in Sq Ft)
    const areaSqFtText = mathAreaSqFt.textContent.replace(/,/g, '');
    let plotAreaSqFt = parseFloat(areaSqFtText);
    if (isNaN(plotAreaSqFt)) plotAreaSqFt = 0;
    
    const finalPlotAreaSqFt = plotAreaSqFt;

    // 3. Apply Pakistani Construction Benchmarks
    // Standard Height: 10 ft, Standard Thickness: 9 inches (0.75 ft)
    const wallHeight = 10;
    const wallThickness = 0.75;
    const wallVolumeCFT = totalWallLengthFeet * wallHeight * wallThickness;

    // Auto-calculated default quantities
    const autoQtyBricks = Math.round(wallVolumeCFT * 13.5);
    const autoQtyCement = Math.round(wallVolumeCFT * 0.05 * 10) / 10; // round to 1 decimal place
    const autoQtySand = Math.round(wallVolumeCFT * 0.25);
    const autoQtyTiles = Math.round(finalPlotAreaSqFt);

    // DOM references
    const inputBricks = document.getElementById('bom-qty-bricks');
    const inputCement = document.getElementById('bom-qty-cement');
    const inputSand = document.getElementById('bom-qty-sand');
    const inputTiles = document.getElementById('bom-qty-tiles');

    // Populate auto-calculated quantities if initializing (modal opening)
    if (isInit === true) {
        if (inputBricks) inputBricks.value = autoQtyBricks;
        if (inputCement) inputCement.value = autoQtyCement;
        if (inputSand) inputSand.value = autoQtySand;
        if (inputTiles) inputTiles.value = autoQtyTiles;
    }

    // Read the current quantities (either auto-populated or user-customized)
    const qtyBricks = inputBricks ? (parseFloat(inputBricks.value) || 0) : 0;
    const qtyCement = inputCement ? (parseFloat(inputCement.value) || 0) : 0;
    const qtySand = inputSand ? (parseFloat(inputSand.value) || 0) : 0;
    const qtyTiles = inputTiles ? (parseFloat(inputTiles.value) || 0) : 0;

    // Read editable rates from DOM
    const rateBricks = parseFloat(document.getElementById('rate-bricks').value) || 0;
    const rateCement = parseFloat(document.getElementById('rate-cement').value) || 0;
    const rateSand = parseFloat(document.getElementById('rate-sand').value) || 0;
    const rateTiles = parseFloat(document.getElementById('rate-tiles').value) || 0;

    // Save rates back to state
    state.rates.brick = rateBricks;
    state.rates.cement = rateCement;
    state.rates.sand = rateSand;
    state.rates.tiles = rateTiles;

    // Calculate Subtotals
    const subtotalBricks = qtyBricks * rateBricks;
    const subtotalCement = qtyCement * rateCement;
    const subtotalSand = qtySand * rateSand;
    const subtotalTiles = qtyTiles * rateTiles;
    const totalCost = subtotalBricks + subtotalCement + subtotalSand + subtotalTiles;

    // Render Stats
    document.getElementById('bom-wall-length').textContent = `${totalWallLengthFeet.toFixed(2)} ft`;
    document.getElementById('bom-footprint-area').textContent = `${finalPlotAreaSqFt.toFixed(2)} sq ft`;

    // Render Subtotals
    document.getElementById('bom-total-bricks').textContent = subtotalBricks.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('bom-total-cement').textContent = subtotalCement.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('bom-total-sand').textContent = subtotalSand.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('bom-total-tiles').textContent = subtotalTiles.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    // Render Total Cost
    document.getElementById('bom-total-cost').textContent = `${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PKR`;
};

// Collaboration Comments Log Rendering
const renderComments = () => {
    const commentsList = document.getElementById('collab-comments-list');
    if (!commentsList) return;
    
    commentsList.innerHTML = '';
    state.comments.forEach(comment => {
        const item = document.createElement('div');
        item.className = 'comment-item';
        
        let roleLabel = "";
        switch (comment.role) {
            case 'owner': roleLabel = 'Admin/Owner'; break;
            case 'architect': roleLabel = 'Lead Architect'; break;
            case 'engineer': roleLabel = 'Structural Eng'; break;
            case 'client': roleLabel = 'Client'; break;
        }
        
        item.innerHTML = `
            <div class="comment-header">
                <span class="role-badge role-${comment.role}">${roleLabel}</span>
                <span class="comment-time">${comment.time}</span>
            </div>
            <div class="comment-body">${comment.text}</div>
        `;
        commentsList.appendChild(item);
    });
    
    // Auto scroll comments box to bottom
    const box = document.querySelector('.collab-comments-box');
    if (box) {
        box.scrollTop = box.scrollHeight;
    }
};

// JSON Project Exporter
const exportProjectData = () => {
    const projectData = {
        projectName: "Plot Planner Pro Project",
        exportTimestamp: new Date().toISOString(),
        settings: {
            scale: state.scale,
            unit: state.unit,
            gridSize: state.gridSize,
            authority: state.authority,
            basement: state.basement,
            roadWidth: state.roadWidth,
            neighborLeft: state.neighborLeft,
            neighborRight: state.neighborRight,
            neighborRear: state.neighborRear,
            soil: state.soil
        },
        mathEngineInputs: {
            sideA: parseFloat(plotSideA.value) || 0,
            sideB: parseFloat(plotSideB.value) || 0,
            sideC: parseFloat(plotSideC.value) || 0,
            sideD: parseFloat(plotSideD.value) || 0,
            diagonalE: parseFloat(plotDiagE.value) || 0,
            marlaStandard: parseFloat(marlaSelect.value),
            calculatedAreaSqFt: parseFloat(mathAreaSqFt.textContent.replace(/,/g, '')) || 0
        },
        bomRates: state.rates,
        drawnLines: state.lines,
        droppedPins: state.pins,
        collaborationComments: state.comments
    };

    const jsonString = JSON.stringify(projectData, null, 4);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    
    const exportFileDefaultName = 'plot_planner_project.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
};

// DOM References for Part 5
const collabRoleSelect = document.getElementById('collab-role-select');
const btnOpenBOM = document.getElementById('btn-open-bom');
const btnCloseBOM = document.getElementById('btn-close-bom');
const bomModal = document.getElementById('bom-modal');
const btnExportProject = document.getElementById('btn-export-project');
const collabCommentInput = document.getElementById('collab-comment-input');
const btnPostComment = document.getElementById('btn-post-comment');

// DOM Rate Inputs References
const rateInputs = [
    document.getElementById('rate-bricks'),
    document.getElementById('rate-cement'),
    document.getElementById('rate-sand'),
    document.getElementById('rate-tiles'),
    document.getElementById('bom-qty-bricks'),
    document.getElementById('bom-qty-cement'),
    document.getElementById('bom-qty-sand'),
    document.getElementById('bom-qty-tiles')
];

// Event Listeners for Part 5
btnOpenBOM.addEventListener('click', () => {
    recalculateBOM(true); // initialize calculations on open
    bomModal.style.display = 'flex';
});

btnCloseBOM.addEventListener('click', () => {
    bomModal.style.display = 'none';
});

// Close modal if user clicks outside of modal card
bomModal.addEventListener('click', (e) => {
    if (e.target === bomModal) {
        bomModal.style.display = 'none';
    }
});

// Rate & Quantity Inputs keyup/change triggers
rateInputs.forEach(input => {
    if (input) {
        input.addEventListener('input', () => recalculateBOM(false));
    }
});

collabRoleSelect.addEventListener('change', (e) => {
    state.activeRole = e.target.value;
});

btnPostComment.addEventListener('click', () => {
    const text = collabCommentInput.value.trim();
    if (!text) return;
    
    const now = new Date();
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${hrs}:${mins}`;
    
    state.comments.push({
        role: state.activeRole,
        text: text,
        time: timeStr
    });
    
    collabCommentInput.value = '';
    renderComments();
});

btnExportProject.addEventListener('click', exportProjectData);

// Hook into existing callbacks to update BOM when lines or areas change
const originalRecalculatePlot = recalculateIrregularPlot;
recalculateIrregularPlot = () => {
    originalRecalculatePlot();
    recalculateBOM();
};

// --- Help & Slides Carousel Behaviors ---

const slidesData = [
    {
        title: "Plot Planner Pro",
        subtitle: "The Ultimate 2D Drafting & Environmental Zoning Application",
        points: [
            "Unified drafting canvas designed for Pakistani housing schemes.",
            "Integrates mathematical area tools and revenue unit conversions.",
            "Implements municipal compliance logic and energy simulations.",
            "Automates material inventory costing and role-based approvals."
        ]
    },
    {
        title: "Part 1 & 2: Drafting & Math Engine",
        subtitle: "Precision Coordinate Geometry & Revenue Estimations",
        points: [
            "Interactive CAD workspace with grid snapping and real-time scaling.",
            "Exact triangulation of irregular plot boundaries using Heron's Formula.",
            "Shoelace polygon area algorithm to measure custom-drawn walls.",
            "Urdu revenue unit conversions (Kanal, Marla, Sarsahi) with fractional rounding.",
            "Supports Feet (ft), Meters (m), and Yards (Karachi Yard - sq yds / yds) units."
        ]
    },
    {
        title: "Part 3: Municipal Regulations",
        subtitle: "Setback Compliance & Site Context Surveys",
        points: [
            "Supports LDA, CDA, RUDA, SBCA (Karachi), PDA (Peshawar), and QDA (Quetta).",
            "Automatic rendering of statutory setback borders on canvas.",
            "Adjacent neighborhood context boxes (floors count, empty lands).",
            "Geo-tagged pins (Water, Gas, Electric) mapped on canvas clicks."
        ]
    },
    {
        title: "Part 4: Microclimate Simulator",
        subtitle: "Geo-Energy Solar Shadows & Seasonal Wind Overlays",
        points: [
            "Solar Arc representing Southern sun transit path with active sun icon.",
            "Dynamic cast shadow projection from building blocks shifting with time.",
            "Animated vector flow arrows indicating summer/winter monsoon winds.",
            "Paved road noise decay zoning and orientation-aware passive advice."
        ]
    },
    {
        title: "Part 5: Cost Sheet & Collaboration",
        subtitle: "Interactive Material BOQ Estimations & Exporter",
        points: [
            "Bricks, cement bags, sand, and tiles auto-estimated from drafted walls.",
            "Editable unit market rates with dynamic grand total cost in PKR.",
            "Role-based multi-disciplinary annotation workspace (Owner, Architect, Engineer).",
            "Single-click export of canvas vectors and cost sheets to JSON files."
        ]
    },
    {
        title: "Part 6: 3D WebGL Viewport & Floor Plan Generator",
        subtitle: "Procedural Architectural Layouts & Interactive 3D Visualizer",
        points: [
            "Procedural multi-story floor plan layout generator based on room requirements.",
            "Interactive 2D blueprint rendering with wall thicknesses (9\" & 4.5\"), swings, and symbols.",
            "Drag-and-drop capability to manually rearrange room positions in real-time.",
            "3D viewport rendering with extruded walls, stairs, furniture, sun angles, and roof toggles.",
            "Multi-format file importer supporting JSON, DXF, SVG vector imports, and OBJ/STL 3D meshes.",
            "Drag-and-drop files directly onto the canvas with background tracing image scaling/opacity."
        ]
    },
    {
        title: "Future System Roadmap",
        subtitle: "Scale Expansion Plan for Development",
        points: [
            "Real API connections to municipal submission portals for auto approvals.",
            "Real-time multiplayer collaboration for architects and structural engineers.",
            "Extended passive heat gain calculation tools for material insulation analysis."
        ]
    }
];

let currentSlideIndex = 0;

const renderActiveSlide = () => {
    const slide = slidesData[currentSlideIndex];
    const card = document.getElementById('active-slide-card');
    if (!card) return;
    
    let bulletsHtml = "";
    slide.points.forEach(pt => {
        bulletsHtml += `<li style="font-size: 0.82rem; line-height: 1.45; color: var(--text-dark); margin-bottom: 6px;">${pt}</li>`;
    });
    
    card.innerHTML = `
        <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 1.25rem; font-weight: 700; color: var(--primary-blue); margin-bottom: 2px;">${slide.title}</h3>
        <h4 style="font-size: 0.88rem; font-weight: 600; color: #0284c7; margin-bottom: 12px; border-bottom: 1px solid var(--border-light); padding-bottom: 8px;">${slide.subtitle}</h4>
        <ul style="margin-left: 20px; display: flex; flex-direction: column; gap: 4px; padding: 0;">
            ${bulletsHtml}
        </ul>
    `;
    
    document.getElementById('slide-indicator').textContent = `Slide ${currentSlideIndex + 1} of ${slidesData.length}`;
};

// Help Modal Elements
const btnOpenHelp = document.getElementById('btn-open-help');
const btnCloseHelp = document.getElementById('btn-close-help');
const helpModal = document.getElementById('help-modal');
const docTabBtns = document.querySelectorAll('.doc-tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

const btnPrevSlide = document.getElementById('btn-prev-slide');
const btnNextSlide = document.getElementById('btn-next-slide');

// Open / Close Modal
btnOpenHelp.addEventListener('click', () => {
    helpModal.style.display = 'flex';
    renderActiveSlide();
});

btnCloseHelp.addEventListener('click', () => {
    helpModal.style.display = 'none';
});

helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
        helpModal.style.display = 'none';
    }
});

// Tab Switcher
docTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // Toggle tabs headers styling
        docTabBtns.forEach(b => {
            b.classList.remove('active');
            b.style.borderBottom = '3px solid transparent';
            b.style.color = 'var(--text-muted)';
            b.style.fontWeight = '600';
        });
        
        btn.classList.add('active');
        btn.style.borderBottom = '3px solid var(--primary-blue)';
        btn.style.color = 'var(--primary-blue)';
        btn.style.fontWeight = '700';
        
        // Toggle panes visibility
        const tabName = btn.dataset.tab;
        tabPanes.forEach(pane => {
            pane.style.display = pane.id === `tab-${tabName}` ? 'block' : 'none';
            if (pane.id === `tab-${tabName}` && tabName === 'slides') {
                pane.style.display = 'flex';
            }
        });
    });
});

// Slide Controls
btnPrevSlide.addEventListener('click', () => {
    currentSlideIndex = (currentSlideIndex - 1 + slidesData.length) % slidesData.length;
    renderActiveSlide();
});

btnNextSlide.addEventListener('click', () => {
    currentSlideIndex = (currentSlideIndex + 1) % slidesData.length;
    renderActiveSlide();
});

// ============================================================
// ADVANCED FEATURES: STEPPER, IMPORT, BLUEPRINT & 3D VIEWPORT
// ============================================================

const WALL_OUT_FT = 0.75;
const WALL_IN_FT = 0.375;

// --- 1. Stepper Manager ---
const stepBtns = document.querySelectorAll('.step-btn');
const stepPanes = document.querySelectorAll('.step-panel');

stepBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const stepNum = btn.dataset.step;
        
        stepBtns.forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        
        stepPanes.forEach(pane => {
            pane.classList.toggle('on', pane.dataset.step === stepNum);
        });
    });
});

// --- 2. Undo Implementation ---
const toolUndoBtn = document.getElementById('tool-undo');
if (toolUndoBtn) {
    toolUndoBtn.addEventListener('click', () => {
        undo();
    });
}

// --- 3. Drag-and-Drop & File Importers ---
const fileImportInput = document.getElementById('file-import-input');
const toolImportBtn = document.getElementById('tool-import');

if (toolImportBtn && fileImportInput) {
    toolImportBtn.addEventListener('click', () => fileImportInput.click());
    fileImportInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleImportedFile(e.target.files[0]);
        e.target.value = '';
    });
}

// Drag over canvas container highlight
if (canvasContainer) {
    canvasContainer.addEventListener('dragenter', (e) => {
        e.preventDefault();
        canvasContainer.classList.add('dragover');
    });
    canvasContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        canvasContainer.classList.add('dragover');
    });
    canvasContainer.addEventListener('dragleave', (e) => {
        if (e.target === canvasContainer || !canvasContainer.contains(e.relatedTarget)) {
            canvasContainer.classList.remove('dragover');
        }
    });
    canvasContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        canvasContainer.classList.remove('dragover');
        if (e.dataTransfer.files[0]) {
            handleImportedFile(e.dataTransfer.files[0]);
        }
    });
}

const handleImportedFile = (file) => {
    if (!file) return;
    const maxMb = 25;
    if (file.size > maxMb * 1024 * 1024) {
        alert('File size exceeds 25MB limit.');
        return;
    }
    const name = file.name.toLowerCase();
    const ext = name.slice(name.lastIndexOf('.') + 1);
    
    const allowed = ['json', 'png', 'jpg', 'jpeg', 'svg', 'dxf', 'obj', 'stl'];
    if (!allowed.includes(ext)) {
        alert(`Format .${ext} is not supported.`);
        return;
    }
    
    const reader = new FileReader();
    if (ext === 'json') {
        reader.onload = () => importJSON(reader.result);
        reader.readAsText(file);
    } else if (['png', 'jpg', 'jpeg'].includes(ext)) {
        reader.onload = () => importImage(reader.result);
        reader.readAsDataURL(file);
    } else if (ext === 'svg') {
        reader.onload = () => importSVG(reader.result);
        reader.readAsText(file);
    } else if (ext === 'dxf') {
        reader.onload = () => importDXF(reader.result);
        reader.readAsText(file);
    } else if (ext === 'obj') {
        reader.onload = () => import3D('obj', reader.result);
        reader.readAsText(file);
    } else if (ext === 'stl') {
        reader.onload = () => import3D('stl', reader.result);
        reader.readAsArrayBuffer(file);
    }
};

// JSON Project Importer
const importJSON = (text) => {
    try {
        const d = JSON.parse(text);
        if (!d.part1_canvas) throw new Error('Not a valid Plot Planner database.');
        
        state.lines = d.part1_canvas.lines || [];
        state.pins = d.part1_canvas.utilityPins || d.part1_canvas.pins || [];
        
        if (d.part2_area && d.part2_area.sides) {
            const s = d.part2_area.sides;
            const aInput = document.getElementById('plot-side-a');
            const bInput = document.getElementById('plot-side-b');
            const cInput = document.getElementById('plot-side-c');
            const dInput = document.getElementById('plot-side-d');
            const eInput = document.getElementById('plot-diag-e');
            
            if (aInput) aInput.value = s.A || '';
            if (bInput) bInput.value = s.B || '';
            if (cInput) cInput.value = s.C || '';
            if (dInput) dInput.value = s.D || '';
            if (eInput) eInput.value = s.diagonal || s.E || '';
        }
        
        if (d.part3_regulatory) {
            state.authority = d.part3_regulatory.authority || state.authority;
            const authSel = document.getElementById('rules-authority');
            if (authSel) authSel.value = state.authority;
            
            state.roadWidth = d.part3_regulatory.survey?.roadWidthFt || state.roadWidth;
            const rw = document.getElementById('survey-road-width');
            if (rw) rw.value = state.roadWidth;
        }
        
        if (d.part5_costSheet && d.part5_costSheet.rates) {
            state.rates = d.part5_costSheet.rates;
            const rB = document.getElementById('rate-bricks');
            const rC = document.getElementById('rate-cement');
            const rS = document.getElementById('rate-sand');
            const rT = document.getElementById('rate-tiles');
            if (rB) rB.value = state.rates.brick || 15;
            if (rC) rC.value = state.rates.cement || 1400;
            if (rS) rS.value = state.rates.sand || 80;
            if (rT) rT.value = state.rates.tiles || 250;
        }
        
        recalculateIrregularPlot();
        updateStats();
        recalculateBOM();
        draw();
        alert('Project database restored successfully.');
    } catch (e) {
        alert(`Load Failed: ${e.message}`);
    }
};

// Tracing Image
const traceCtrlPanel = document.getElementById('trace-ctrl-panel');
const traceOpacitySlider = document.getElementById('trace-opacity-slider');
const traceOpacityVal = document.getElementById('trace-opacity-val');
const traceScaleSlider = document.getElementById('trace-scale-slider');
const traceScaleVal = document.getElementById('trace-scale-val');
const traceLockCheckbox = document.getElementById('trace-lock-checkbox');
const btnTraceRemove = document.getElementById('btn-trace-remove');

const importImage = (dataUrl) => {
    const img = new Image();
    img.onload = () => {
        const rect = canvas.getBoundingClientRect();
        const fit = Math.min(rect.width * 0.8 / img.width, rect.height * 0.8 / img.height, 1);
        state.traceImage = {
            img,
            w: img.width * fit,
            h: img.height * fit,
            x: (rect.width - img.width * fit) / 2,
            y: (rect.height - img.height * fit) / 2,
            baseW: img.width * fit,
            baseH: img.height * fit,
            opacity: 0.55,
            scale: 1.0,
            locked: false
        };
        if (traceCtrlPanel) traceCtrlPanel.classList.add('show');
        if (traceOpacitySlider) traceOpacitySlider.value = 55;
        if (traceScaleSlider) traceScaleSlider.value = 100;
        if (traceLockCheckbox) traceLockCheckbox.checked = false;
        draw();
    };
    img.src = dataUrl;
};

if (traceOpacitySlider) {
    traceOpacitySlider.addEventListener('input', (e) => {
        if (state.traceImage) {
            state.traceImage.opacity = e.target.value / 100;
            if (traceOpacityVal) traceOpacityVal.textContent = `${e.target.value}%`;
            draw();
        }
    });
}
if (traceScaleSlider) {
    traceScaleSlider.addEventListener('input', (e) => {
        if (state.traceImage) {
            state.traceImage.scale = e.target.value / 100;
            if (traceScaleVal) traceScaleVal.textContent = `${e.target.value}%`;
            draw();
        }
    });
}
if (traceLockCheckbox) {
    traceLockCheckbox.addEventListener('change', (e) => {
        if (state.traceImage) {
            state.traceImage.locked = e.target.checked;
            draw();
        }
    });
}
if (btnTraceRemove) {
    btnTraceRemove.addEventListener('click', () => {
        state.traceImage = null;
        if (traceCtrlPanel) traceCtrlPanel.classList.remove('show');
        draw();
    });
}

// Drag trace image logic
let traceDragState = null;
canvas.addEventListener('mousedown', (e) => {
    const t = state.traceImage;
    if (!t || t.locked || state.floorPlanView === 'floor') return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    // Shift + drag to reposition
    if (e.shiftKey && mx >= t.x && mx <= t.x + t.baseW * t.scale && my >= t.y && my <= t.y + t.baseH * t.scale) {
        traceDragState = { dx: mx - t.x, dy: my - t.y };
        e.stopImmediatePropagation(); // prevent starting line drawing
    }
}, true);

window.addEventListener('mousemove', (e) => {
    if (!traceDragState || !state.traceImage) return;
    const rect = canvas.getBoundingClientRect();
    state.traceImage.x = e.clientX - rect.left - traceDragState.dx;
    state.traceImage.y = e.clientY - rect.top - traceDragState.dy;
    draw();
});

window.addEventListener('mouseup', () => {
    traceDragState = null;
});

const drawTraceLayer = () => {
    const t = state.traceImage;
    if (!t) return;
    ctx.save();
    ctx.globalAlpha = t.opacity;
    ctx.drawImage(t.img, t.x, t.y, t.baseW * t.scale, t.baseH * t.scale);
    ctx.restore();
    
    if (!t.locked) {
        ctx.save();
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(t.x, t.y, t.baseW * t.scale, t.baseH * t.scale);
        ctx.restore();
    }
};

// SVG Vector Importer
const importSVG = (text) => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'image/svg+xml');
        const lines = [];
        
        doc.querySelectorAll('line').forEach(el => {
            lines.push({
                a: [+el.getAttribute('x1'), +el.getAttribute('y1')],
                b: [+el.getAttribute('x2'), +el.getAttribute('y2')]
            });
        });
        doc.querySelectorAll('polyline, polygon').forEach(el => {
            const ptsStr = (el.getAttribute('points') || '').trim();
            const pts = ptsStr.split(/\s+/).map(p => p.split(',').map(Number));
            for (let i = 0; i < pts.length - 1; i++) {
                lines.push({ a: pts[i], b: pts[i+1] });
            }
            if (el.tagName === 'polygon' && pts.length > 2) {
                lines.push({ a: pts[pts.length - 1], b: pts[0] });
            }
        });
        doc.querySelectorAll('rect').forEach(el => {
            const x = +el.getAttribute('x') || 0;
            const y = +el.getAttribute('y') || 0;
            const w = +el.getAttribute('width');
            const h = +el.getAttribute('height');
            lines.push(
                { a: [x, y], b: [x + w, y] },
                { a: [x + w, y], b: [x + w, y + h] },
                { a: [x + w, y + h], b: [x, y + h] },
                { a: [x, y + h], b: [x, y] }
            );
        });
        
        if (!lines.length) throw new Error('No compatible vector lines found inside SVG.');
        fitImportedLines(lines, 'SVG');
    } catch (e) {
        alert(e.message);
    }
};

// DXF Importer
const importDXF = (text) => {
    try {
        const fileLines = text.split(/\r\n|\r|\n/);
        const lines = [];
        let i = 0;
        
        while (i < fileLines.length) {
            const code = fileLines[i].trim();
            const val = (fileLines[i+1] || '').trim();
            if (code === '0' && val === 'LINE') {
                const e = {};
                let j = i + 2;
                while (j < fileLines.length && fileLines[j].trim() !== '0') {
                    e[fileLines[j].trim()] = fileLines[j+1]?.trim();
                    j += 2;
                }
                if (e['10'] != null && e['11'] != null) {
                    lines.push({
                        a: [+e['10'], -+e['20']],
                        b: [+e['11'], -+e['21']]
                    });
                }
            }
            i += 2;
        }
        if (!lines.length) throw new Error('No LINE entities found inside DXF.');
        fitImportedLines(lines, 'DXF');
    } catch (e) {
        alert(e.message);
    }
};

const fitImportedLines = (lines, format) => {
    const xs = lines.flatMap(l => [l.a[0], l.b[0]]);
    const ys = lines.flatMap(l => [l.a[1], l.b[1]]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width * 0.7 / (maxX - minX || 1), rect.height * 0.7 / (maxY - minY || 1));
    const ox = (rect.width - (maxX - minX) * scale) / 2;
    const oy = (rect.height - (maxY - minY) * scale) / 2;
    
    lines.forEach(l => {
        state.lines.push({
            startX: ox + (l.a[0] - minX) * scale,
            startY: oy + (l.a[1] - minY) * scale,
            endX: ox + (l.b[0] - minX) * scale,
            endY: oy + (l.b[1] - minY) * scale,
            color: state.activeColor,
            weight: state.activeWeight
        });
    });
    
    updateStats();
    recalculateBOM();
    draw();
    alert(`Successfully imported ${lines.length} lines from ${format}.`);
};

// 3D Object Mesh Importer (OBJ / STL)
const import3D = (format, data) => {
    try {
        if (!window.THREE) {
            alert('Please open 3D View first to load the WebGL engine before importing 3D files.');
            return;
        }
        
        let geometry = null;
        if (format === 'obj') {
            const THREE = window.THREE;
            const vertices = [];
            const indices = [];
            
            data.split(/\r?\n/).forEach(line => {
                const tokens = line.trim().split(/\s+/);
                if (tokens[0] === 'v') {
                    vertices.push(+tokens[1], +tokens[2], +tokens[3]);
                } else if (tokens[0] === 'f') {
                    const faceIdx = tokens.slice(1).map(s => parseInt(s.split('/')[0]) - 1);
                    for (let k = 1; k < faceIdx.length - 1; k++) {
                        indices.push(faceIdx[0], faceIdx[k], faceIdx[k+1]);
                    }
                }
            });
            if (vertices.length) {
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
                if (indices.length) geometry.setIndex(indices);
                geometry.computeVertexNormals();
            }
        } else if (format === 'stl') {
            const THREE = window.THREE;
            const view = new DataView(data);
            const triangles = view.getUint32(80, true);
            const positions = [];
            let offset = 84;
            
            for (let i = 0; i < triangles; i++) {
                offset += 12; // skip normal vector
                for (let j = 0; j < 3; j++) {
                    positions.push(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
                    offset += 12;
                }
                offset += 2; // skip attribute bytes
            }
            if (positions.length) {
                geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
                geometry.computeVertexNormals();
            }
        }
        
        if (geometry) {
            state.imported3DModel = geometry;
            alert(`${format.toUpperCase()} 3D model loaded successfully. Click '3D View' to traverse!`);
            if (!V3D.on) {
                open3DView();
            } else {
                build3DModel();
            }
        } else {
            throw new Error('Failed to parse 3D mesh.');
        }
    } catch (e) {
        alert(`3D Import Failed: ${e.message}`);
    }
};

// --- 4. Requirements Checklist & 2D Floor Plan Generator ---
const REQS_CONFIG = [
    { id: 'bed', en: 'Bedrooms', ur: 'بیڈ روم', type: 'count', def: 2 },
    { id: 'bath', en: 'Bathrooms', ur: 'واش روم', type: 'count', def: 2 },
    { id: 'kitchen', en: 'Kitchen', ur: 'کچن', type: 'count', def: 1 },
    { id: 'draw', en: 'Drawing / Guest Room', ur: 'ڈرائنگ روم', type: 'count', def: 1 },
    { id: 'lounge', en: 'TV Lounge / Living', ur: 'ٹی وی لاؤنج', type: 'count', def: 1 },
    { id: 'majlis_men', en: "Men's Majlis (Guest)", ur: 'مجلس الرجال', type: 'count', def: 0 },
    { id: 'majlis_women', en: "Women's Majlis (Ladies)", ur: 'مجلس النساء', type: 'count', def: 0 },
    { id: 'porch', en: 'Porch / Car Parking', ur: 'پورچ / گاڑی', type: 'opt', opts: ['Small', 'Large'], def: 'Small' },
    { id: 'stair', en: 'Staircase', ur: 'سیڑھیاں', type: 'opt', opts: ['Inside', 'Outside'], def: 'Inside' },
    { id: 'store', en: 'Store Room', ur: 'اسٹور روم', type: 'count', def: 1 },
    { id: 'laundry', en: 'Laundry Area', ur: 'لانڈری', type: 'flag' },
    { id: 'open', en: 'Open Space / Lawn', ur: 'صحن / لان', type: 'opt', opts: ['Front', 'Back', 'Side'], def: 'Front' }
];

const requirementsState = {};
const floorPlanState = {
    floors: null,
    view: 0,
    count: 1,
    corridor: true
};

const initRequirementsUI = () => {
    const listContainer = document.getElementById('requirements-list-container');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    REQS_CONFIG.forEach(r => {
        const isDefault = ['bed', 'bath', 'kitchen', 'lounge', 'porch', 'open'].includes(r.id);
        requirementsState[r.id] = {
            on: isDefault,
            count: r.def || 1,
            opt: r.def,
            floorQty: [r.def || 1, 0, 0], // qty per floor Ground, 1st, 2nd
            size: { w: 0, h: 0 }
        };
        
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'req-item';
        
        const reqRow = document.createElement('div');
        reqRow.className = `req ${isDefault ? 'on' : ''}`;
        
        let rightSideHtml = '';
        if (r.type === 'count') {
            rightSideHtml = `<span class="req-sum" id="req-sum-${r.id}">${r.def}</span><button class="req-tog" type="button">▼</button>`;
        } else if (r.type === 'opt') {
            rightSideHtml = `<select class="form-control" style="width: 90px; padding: 4px; font-size: 0.78rem;" id="req-opt-${r.id}">${r.opts.map(o => `<option value="${o}" ${o === r.def ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
        }
        
        reqRow.innerHTML = `
            <input type="checkbox" id="req-cb-${r.id}" ${isDefault ? 'checked' : ''}>
            <div class="nm">${r.en} <span class="urdu">${r.ur}</span></div>
            ${rightSideHtml}
        `;
        itemWrapper.appendChild(reqRow);
        
        if (r.type === 'count') {
            const detailPane = document.createElement('div');
            detailPane.className = 'req-detail';
            detailPane.innerHTML = `
                <div class="rd-title">Per-floor Quantity</div>
                <div class="rd-floors-list" id="rd-floors-list-${r.id}"></div>
                <div class="rd-title" style="margin-top: 8px;">Custom Size (Feet)</div>
                <div class="rd-size">
                    <label>W</label><input type="number" class="sz-in" id="sz-w-${r.id}" placeholder="Auto" min="0">
                    <span class="sz-x">×</span>
                    <label>H</label><input type="number" class="sz-in" id="sz-h-${r.id}" placeholder="Auto" min="0">
                    <button class="sz-auto" id="btn-sz-auto-${r.id}" type="button">Auto</button>
                </div>
                <div class="sz-hint">Dimensions honor spatial allocation on rendering.</div>
            `;
            itemWrapper.appendChild(detailPane);
            
            // Render floor rows helper
            requirementsState[r.id].renderFloorCounters = () => {
                const floorsList = detailPane.querySelector('.rd-floors-list');
                if (!floorsList) return;
                floorsList.innerHTML = '';
                
                const names = ['Ground Floor', 'First Floor', 'Second Floor'];
                for (let f = 0; f < floorPlanState.count; f++) {
                    const row = document.createElement('div');
                    row.className = 'rd-floor';
                    row.innerHTML = `
                        <span class="fl-nm">${names[f]}</span>
                        <div class="rd-ctr">
                            <button type="button" class="btn-dec">−</button>
                            <span class="v">${requirementsState[r.id].floorQty[f]}</span>
                            <button type="button" class="btn-inc">+</button>
                        </div>
                    `;
                    const countSpan = row.querySelector('.v');
                    row.querySelector('.btn-dec').onclick = () => {
                        requirementsState[r.id].floorQty[f] = Math.max(0, requirementsState[r.id].floorQty[f] - 1);
                        countSpan.textContent = requirementsState[r.id].floorQty[f];
                        updateSummaryCount(r.id);
                    };
                    row.querySelector('.btn-inc').onclick = () => {
                        requirementsState[r.id].floorQty[f] = Math.min(9, requirementsState[r.id].floorQty[f] + 1);
                        countSpan.textContent = requirementsState[r.id].floorQty[f];
                        updateSummaryCount(r.id);
                    };
                    floorsList.appendChild(row);
                }
            };
        }
        
        listContainer.appendChild(itemWrapper);
        
        // Hooks
        const checkbox = reqRow.querySelector('input[type=checkbox]');
        checkbox.addEventListener('change', () => {
            requirementsState[r.id].on = checkbox.checked;
            reqRow.classList.toggle('on', checkbox.checked);
            if (!checkbox.checked) itemWrapper.classList.remove('open');
            if (floorPlanState.floors) generateFloorPlan();
        });
        
        const optSelect = reqRow.querySelector('select');
        if (optSelect) {
            optSelect.addEventListener('change', (e) => {
                requirementsState[r.id].opt = e.target.value;
                if (floorPlanState.floors) generateFloorPlan();
            });
        }
        
        if (r.type === 'count') {
            const toggle = reqRow.querySelector('.req-tog');
            toggle.addEventListener('click', () => {
                if (!requirementsState[r.id].on) {
                    checkbox.checked = true;
                    checkbox.dispatchEvent(new Event('change'));
                }
                itemWrapper.classList.toggle('open');
            });
            
            requirementsState[r.id].renderFloorCounters();
            
            const wInput = itemWrapper.querySelector(`#sz-w-${r.id}`);
            const hInput = itemWrapper.querySelector(`#sz-h-${r.id}`);
            wInput.addEventListener('input', (e) => {
                requirementsState[r.id].size.w = parseFloat(e.target.value) || 0;
                if (floorPlanState.floors) generateFloorPlan();
            });
            hInput.addEventListener('input', (e) => {
                requirementsState[r.id].size.h = parseFloat(e.target.value) || 0;
                if (floorPlanState.floors) generateFloorPlan();
            });
            itemWrapper.querySelector(`#btn-sz-auto-${r.id}`).onclick = () => {
                wInput.value = '';
                hInput.value = '';
                requirementsState[r.id].size.w = 0;
                requirementsState[r.id].size.h = 0;
                if (floorPlanState.floors) generateFloorPlan();
            };
        }
    });
};

const updateSummaryCount = (id) => {
    const s = requirementsState[id];
    s.count = s.floorQty.reduce((tot, val) => tot + val, 0);
    const sum = document.getElementById(`req-sum-${id}`);
    if (sum) sum.textContent = s.count;
    if (floorPlanState.floors) generateFloorPlan();
};

const floorSelectorBtns = document.querySelectorAll('#floor-select-container button');
floorSelectorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        floorSelectorBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        floorPlanState.count = parseInt(btn.dataset.v, 10);
        floorPlanState.view = 0;
        
        REQS_CONFIG.forEach(r => {
            if (requirementsState[r.id] && requirementsState[r.id].renderFloorCounters) {
                requirementsState[r.id].renderFloorCounters();
            }
        });
        if (floorPlanState.floors) generateFloorPlan();
    });
});

const chkCorridor = document.getElementById('checkbox-corridor');
if (chkCorridor) {
    chkCorridor.addEventListener('change', (e) => {
        floorPlanState.corridor = e.target.checked;
        if (floorPlanState.floors) generateFloorPlan();
    });
}

// Procedural 2D Layout Generator (Split Treemap)
const createRoomObject = (id, label, x, y, w, h, customDim) => {
    return { id, label, x, y, w, h, customDim: customDim || '' };
};

const generateRoomsList = (floorIdx) => {
    const list = [];
    const addRoom = (id, label, weight, customDim) => {
        list.push({ id, label, w: weight, customDim: customDim || '' });
    };
    const getQty = (id) => requirementsState[id].on ? (requirementsState[id].floorQty[floorIdx] || 0) : 0;
    const getCustomSize = (id, defaultWeight) => {
        const sz = requirementsState[id].size;
        return (sz.w > 0 && sz.h > 0) ? { w: (sz.w * sz.h) / 100, lbl: `${sz.w}'×${sz.h}'` } : { w: defaultWeight, lbl: '' };
    };
    
    // Core room weights
    for (let i = 0; i < getQty('draw'); i++) {
        const sizeInfo = getCustomSize('draw', 1.1);
        addRoom('draw', 'Drawing Room', sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('lounge'); i++) {
        const sizeInfo = getCustomSize('lounge', 1.4);
        addRoom('lounge', 'TV Lounge', sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('majlis_men'); i++) {
        const sizeInfo = getCustomSize('majlis_men', 1.3);
        addRoom('majlis_men', "Men's Majlis", sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('majlis_women'); i++) {
        const sizeInfo = getCustomSize('majlis_women', 1.2);
        addRoom('majlis_women', "Women's Majlis", sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('kitchen'); i++) {
        const sizeInfo = getCustomSize('kitchen', 0.8);
        addRoom('kitchen', 'Kitchen', sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('bed'); i++) {
        const sizeInfo = getCustomSize('bed', 1.0);
        addRoom('bed', `Bedroom ${i + 1}`, sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('bath'); i++) {
        const sizeInfo = getCustomSize('bath', 0.35);
        addRoom('bath', 'Bathroom', sizeInfo.w, sizeInfo.lbl);
    }
    for (let i = 0; i < getQty('store'); i++) {
        const sizeInfo = getCustomSize('store', 0.4);
        addRoom('store', 'Store', sizeInfo.w, sizeInfo.lbl);
    }
    if (requirementsState.laundry.on && floorIdx === 0) {
        addRoom('laundry', 'Laundry', 0.3, '');
    }
    if (requirementsState.stair.on && floorPlanState.count > 1) {
        addRoom('stair', 'Staircase', 0.45, '');
    }
    if (!list.length) {
        addRoom('terrace', 'Terrace Space', 1.0, '');
    }
    return list;
};

const sliceRooms = (x, y, w, h, items) => {
    if (!items.length || w < 2 || h < 2) return [];
    const placed = [];
    
    const splitNode = (xNode, yNode, wNode, hNode, list) => {
        if (!list.length) return;
        if (list.length === 1) {
            placed.push(createRoomObject(list[0].id, list[0].label, xNode, yNode, wNode, hNode, list[0].customDim));
            return;
        }
        
        const totalW = list.reduce((tot, it) => tot + it.w, 0);
        let acc = 0;
        let cutIdx = 0;
        while (cutIdx < list.length - 1 && acc + list[cutIdx].w < totalW / 2) {
            acc += list[cutIdx].w;
            cutIdx++;
        }
        cutIdx = Math.max(1, cutIdx);
        
        const g1 = list.slice(0, cutIdx);
        const g2 = list.slice(cutIdx);
        const ratio = g1.reduce((tot, it) => tot + it.w, 0) / totalW;
        
        if (wNode >= hNode) {
            splitNode(xNode, yNode, wNode * ratio, hNode, g1);
            splitNode(xNode + wNode * ratio, yNode, wNode * (1 - ratio), hNode, g2);
        } else {
            splitNode(xNode, yNode, wNode, hNode * ratio, g1);
            splitNode(xNode, yNode + hNode * ratio, wNode, hNode * (1 - ratio), g2);
        }
    };
    
    splitNode(x, y, w, h, items);
    return placed;
};

const layoutFloorWithCorridor = (x, y, w, h, rooms) => {
    if (!floorPlanState.corridor || rooms.length < 4 || Math.min(w, h) < 14) {
        return sliceRooms(x, y, w, h, rooms);
    }
    const placed = [];
    const totalW = rooms.reduce((tot, it) => tot + it.w, 0);
    let acc = 0;
    let cutIdx = 0;
    while (cutIdx < rooms.length - 1 && acc + rooms[cutIdx].w < totalW / 2) {
        acc += rooms[cutIdx].w;
        cutIdx++;
    }
    cutIdx = Math.max(1, Math.min(rooms.length - 1, cutIdx));
    
    const g1 = rooms.slice(0, cutIdx);
    const g2 = rooms.slice(cutIdx);
    const ratio = g1.reduce((tot, it) => tot + it.w, 0) / totalW;
    
    if (w >= h) {
        const corrH = Math.max(3, Math.min(4, h * 0.12));
        const remH = h - corrH;
        const topH = Math.max(6, remH * ratio);
        const botH = remH - topH;
        placed.push(...sliceRooms(x, y, w, topH, g1));
        placed.push(createRoomObject('corridor', 'Corridor', x, y + topH, w, corrH, ''));
        placed.push(...sliceRooms(x, y + topH + corrH, w, botH, g2));
    } else {
        const corrW = Math.max(3, Math.min(4, w * 0.12));
        const remW = w - corrW;
        const leftW = Math.max(6, remW * ratio);
        const rightW = remW - leftW;
        placed.push(...sliceRooms(x, y, leftW, h, g1));
        placed.push(createRoomObject('corridor', 'Corridor', x + leftW, y, corrW, h, ''));
        placed.push(...sliceRooms(x + leftW + corrW, y, rightW, h, g2));
    }
    return placed;
};

const generateFloorPlan = () => {
    try {
        const areaSqFt = parseFloat(mathAreaSqFt.textContent.replace(/,/g, ''));
        if (isNaN(areaSqFt) || areaSqFt <= 0) {
            alert('Please define plot sides or calculate the irregular plot area first.');
            return;
        }
        
        const rect = canvas.getBoundingClientRect();
        const plotData = getCenteredPlotVertices(rect.width, rect.height);
        let W = 0, H = 0;
        if (plotData) {
            // Derive boundary rectangle widths in feet
            const factor = getPixelToPhysicalFactor();
            const pts = plotData.vertices;
            const dx = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const dy = Math.hypot(pts[2].x - pts[1].x, pts[2].y - pts[1].y);
            W = dx * factor;
            H = dy * factor;
        } else {
            const side = Math.sqrt(areaSqFt);
            W = side;
            H = side;
        }
        
        const floors = [];
        for (let fl = 0; fl < floorPlanState.count; fl++) {
            let x = 0, y = 0, w = W, h = H;
            const placed = [];
            
            // Open Lawn placement (Front or Back)
            if (requirementsState.open.on && fl === 0) {
                const lawnDepth = Math.max(6, H * 0.14);
                const side = requirementsState.open.opt;
                if (side === 'Front') {
                    placed.push(createRoomObject('open', 'Lawn / Yard', x, y, w, lawnDepth));
                    y += lawnDepth;
                    h -= lawnDepth;
                } else if (side === 'Back') {
                    placed.push(createRoomObject('open', 'Lawn / Yard', x, y + h - lawnDepth, w, lawnDepth));
                    h -= lawnDepth;
                } else {
                    const lawnWidth = Math.max(5, W * 0.14);
                    placed.push(createRoomObject('open', 'Open Side Passage', x + w - lawnWidth, y, lawnWidth, h));
                    w -= lawnWidth;
                }
            }
            
            // Car Porch placement
            if (requirementsState.porch.on && fl === 0) {
                const isLarge = requirementsState.porch.opt === 'Large';
                const porchW = Math.min(w * 0.42, isLarge ? 16 : 11);
                const porchH = Math.min(h * 0.3, isLarge ? 20 : 16);
                placed.push(createRoomObject('porch', 'Car Porch', x, y, porchW, porchH));
                
                const rooms = generateRoomsList(fl);
                const frontRooms = rooms.splice(0, Math.max(1, Math.round(rooms.length * 0.3)));
                placed.push(...sliceRooms(x + porchW, y, w - porchW, porchH, frontRooms));
                placed.push(...layoutFloorWithCorridor(x, y + porchH, w, h - porchH, rooms));
            } else {
                placed.push(...layoutFloorWithCorridor(x, y, w, h, generateRoomsList(fl)));
            }
            
            floors.push({ placed, W, H });
        }
        
        floorPlanState.floors = floors;
        buildFloorPlanTabsUI();
        setCanvasView('floor');
    } catch (err) {
        console.error(err);
        alert("Error generating floor plan: " + err.message + "\n" + err.stack);
    }
};

const btnGenerateFloorplan = document.getElementById('btn-generate-floorplan');
if (btnGenerateFloorplan) {
    btnGenerateFloorplan.addEventListener('click', generateFloorPlan);
}

// Tabs UI builder
const buildFloorPlanTabsUI = () => {
    const tabsContainer = document.getElementById('floor-tabs-container');
    if (!tabsContainer) return;
    if (!floorPlanState.floors || floorPlanState.count < 2) {
        tabsContainer.style.display = 'none';
        return;
    }
    
    tabsContainer.style.display = 'flex';
    tabsContainer.innerHTML = '';
    const names = ['Ground', '1st Floor', '2nd Floor'];
    for (let f = 0; f < floorPlanState.count; f++) {
        const btn = document.createElement('button');
        btn.textContent = names[f];
        btn.className = f === floorPlanState.view ? 'on' : '';
        btn.onclick = () => {
            floorPlanState.view = f;
            buildFloorPlanTabsUI();
            draw();
        };
        tabsContainer.appendChild(btn);
    }
};

const setCanvasView = (viewMode) => {
    state.floorPlanView = viewMode;
    const viewBtns = document.querySelectorAll('.bt-btn');
    viewBtns.forEach(btn => {
        btn.classList.toggle('on', btn.dataset.view === viewMode);
    });
    buildFloorPlanTabsUI();
    draw();
};

const viewToggleBtns = document.querySelectorAll('.bt-btn');
viewToggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        setCanvasView(btn.dataset.view);
    });
});

// Drag and drop room layout adjustments
let activeDragRoom = null;
const getFloorLayout = () => {
    if (!floorPlanState.floors) return null;
    return floorPlanState.floors[Math.min(floorPlanState.view, floorPlanState.floors.length - 1)];
};

const getFloorTransform = () => {
    const fl = getFloorLayout();
    if (!fl) return null;
    const rect = canvas.getBoundingClientRect();
    const pad = 100;
    const sc = Math.min((rect.width - pad * 2) / fl.W, (rect.height - pad * 2) / fl.H);
    return {
        ox: (rect.width - fl.W * sc) / 2,
        oy: (rect.height - fl.H * sc) / 2,
        sc,
        fl
    };
};

const getRoomAtCoords = (mx, my) => {
    const t = getFloorTransform();
    if (!t) return null;
    for (let i = t.fl.placed.length - 1; i >= 0; i--) {
        const r = t.fl.placed[i];
        const x = t.ox + r.x * t.sc;
        const y = t.oy + r.y * t.sc;
        const rw = r.w * t.sc;
        const rh = r.h * t.sc;
        if (mx >= x && mx <= x + rw && my >= y && my <= y + rh) {
            return {
                idx: i,
                room: r,
                offX: mx - x,
                offY: my - y,
                sc: t.sc,
                ox: t.ox,
                oy: t.oy
            };
        }
    }
    return null;
};

const floorPlanMousedown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = getRoomAtCoords(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
        activeDragRoom = hit;
        canvas.style.cursor = 'grabbing';
        e.preventDefault();
    }
};

const floorPlanMousemove = (e) => {
    if (!activeDragRoom) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const r = activeDragRoom.room;
    r.x = Math.max(0, (mx - activeDragRoom.offX - activeDragRoom.ox) / activeDragRoom.sc);
    r.y = Math.max(0, (my - activeDragRoom.offY - activeDragRoom.oy) / activeDragRoom.sc);
    draw();
};

const floorPlanMouseup = () => {
    if (activeDragRoom) {
        activeDragRoom = null;
        canvas.style.cursor = 'crosshair';
    }
};

// --- 5. 2D Blueprint Renderer ---
const BP_PALETTE = {
    paper: '#0b1320',      // dark drafting blueprint background
    floor: '#0c1827',
    poche: '#2c3e5a',      // solid wall fill color
    wallEdge: '#aec6f7',   // clean wall outline line
    furn: '#7992b9',       // block symbols
    furnFill: 'rgba(121, 146, 185, 0.08)',
    door: '#cedcf5',
    win: '#7cd1ff',
    dim: '#eab308',
    dimTxt: '#fef08a',
    label: '#f1f5f9',
    sub: '#94a3b8'
};

const ROOM_LABELS = {
    bed: ['Bedroom', 'بیڈ روم'],
    bath: ['Bathroom', 'واش روم'],
    kitchen: ['Kitchen', 'کچن'],
    draw: ['Drawing Room', 'ڈرائنگ روم'],
    lounge: ['TV Lounge', 'ٹی وی لاؤنج'],
    majlis_men: ["Men's Majlis", 'مجلس الرجال'],
    majlis_women: ["Women's Majlis", 'مجلس النساء'],
    store: ['Store Room', 'اسٹور'],
    laundry: ['Laundry', 'لانڈری'],
    stair: ['Staircase', 'سیڑھیاں'],
    porch: ['Car Porch', 'پورچ'],
    open: ['Lawn / Open Yard', 'صحن'],
    terrace: ['Terrace', 'ٹیرس'],
    corridor: ['Corridor', 'طرقہ تقسیم']
};

const drawDimensionHead = (x, y, angle, size, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - 0.45), y - size * Math.sin(angle - 0.45));
    ctx.lineTo(x - size * Math.cos(angle + 0.45), y - size * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
};

const drawDimensionH = (x1, x2, y, label) => {
    if (x2 - x1 < 24) return;
    ctx.strokeStyle = BP_PALETTE.dim;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    
    drawDimensionHead(x1, y, Math.PI, 4.5, BP_PALETTE.dim);
    drawDimensionHead(x2, y, 0, 4.5, BP_PALETTE.dim);
    
    ctx.font = 'bold 9px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = BP_PALETTE.dimTxt;
    ctx.fillText(label, (x1 + x2) / 2, y - 2);
    ctx.textBaseline = 'alphabetic';
};

const drawDimensionV = (y1, y2, x, label) => {
    if (y2 - y1 < 24) return;
    ctx.strokeStyle = BP_PALETTE.dim;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();
    
    drawDimensionHead(x, y1, -Math.PI / 2, 4.5, BP_PALETTE.dim);
    drawDimensionHead(x, y2, Math.PI / 2, 4.5, BP_PALETTE.dim);
    
    ctx.save();
    ctx.translate(x - 2, (y1 + y2) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = 'bold 9px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = BP_PALETTE.dimTxt;
    ctx.fillText(label, 0, 0);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
};

const drawExtensionLine = (x1, y1, x2, y2) => {
    ctx.strokeStyle = BP_PALETTE.dim;
    ctx.lineWidth = 0.7;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
};

const drawBlueprintDoor = (hx, hy, ax, ay, nx, ny, len) => {
    const aw = Math.atan2(ay, ax);
    const an = Math.atan2(ny, nx);
    ctx.strokeStyle = BP_PALETTE.door;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + nx * len, hy + ny * len);
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(206, 220, 245, 0.45)';
    ctx.lineWidth = 1.0;
    ctx.save();
    ctx.setLineDash([3, 3]);
    let diff = an - aw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    ctx.beginPath();
    ctx.arc(hx, hy, len, aw, aw + diff, diff < 0);
    ctx.stroke();
    ctx.restore();
};

const drawBlueprintWindow = (cx, cy, along, wallT, length) => {
    const [ax, ay] = along;
    const nx = -ay;
    const ny = ax;
    const half = length / 2;
    const t = wallT / 2;
    ctx.strokeStyle = BP_PALETTE.win;
    ctx.lineWidth = 1.2;
    [-t * 0.55, 0, t * 0.55].forEach(offset => {
        ctx.beginPath();
        ctx.moveTo(cx - ax * half + nx * offset, cy - ay * half + ny * offset);
        ctx.lineTo(cx + ax * half + nx * offset, cy + ay * half + ny * offset);
        ctx.stroke();
    });
};

const drawRoundedFurnitureRect = (x, y, w, h, r) => {
    ctx.beginPath();
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
};

const drawRoomFurnitureBlock = (r, fx, fy, fw, fh) => {
    if (fw < 32 || fh < 24) return;
    ctx.save();
    ctx.strokeStyle = BP_PALETTE.furn;
    ctx.fillStyle = BP_PALETTE.furnFill;
    ctx.lineWidth = 1.0;
    ctx.lineJoin = 'round';
    
    const cx = fx + fw / 2;
    const cy = fy + fh / 2;
    
    if (r.id === 'bed') {
        const bw = Math.min(fw * 0.62, fh * 0.9);
        const bh = Math.min(fh * 0.7, fw * 0.9);
        const bx = cx - bw / 2;
        const by = cy - bh / 2;
        drawRoundedFurnitureRect(bx, by, bw, bh, 4);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(bx, by + bh * 0.24);
        ctx.lineTo(bx + bw, by + bh * 0.24);
        ctx.stroke();
        
        drawRoundedFurnitureRect(bx + bw * 0.12, by + bh * 0.05, bw * 0.32, bh * 0.15, 3);
        ctx.stroke();
        drawRoundedFurnitureRect(bx + bw * 0.56, by + bh * 0.05, bw * 0.32, bh * 0.15, 3);
        ctx.stroke();
    } else if (r.id === 'lounge' || r.id === 'draw') {
        const sw = fw * 0.7;
        const sh = Math.min(fh * 0.26, 26);
        const sx = cx - sw / 2;
        const sy = fy + fh - sh - 6;
        drawRoundedFurnitureRect(sx, sy, sw, sh, 5);
        ctx.fill();
        ctx.stroke();
        
        drawRoundedFurnitureRect(sx, sy - 6, sw, 10, 4);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(sx + sw / 3, sy);
        ctx.lineTo(sx + sw / 3, sy + sh);
        ctx.moveTo(sx + 2 * sw / 3, sy);
        ctx.lineTo(sx + 2 * sw / 3, sy + sh);
        ctx.stroke();
        
        drawRoundedFurnitureRect(cx - 16, sy - 30, 32, 18, 3);
        ctx.stroke();
        
        if (r.id === 'draw' && fw > 85) {
            ctx.strokeRect(cx - 20, fy + 8, 40, 20);
            [[-28, 0], [28, 0], [-28, 20], [28, 20]].forEach(([dx, dy]) => {
                ctx.strokeRect(cx - 4 + dx, fy + 8 + dy - 2, 8, 8);
            });
        }
    } else if (r.id === 'kitchen') {
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(fx + 5, fy + 14);
        ctx.lineTo(fx + fw - 6, fy + 14);
        ctx.stroke();
        
        ctx.strokeRect(fx + 5, fy + 5, fw - 10, 9);
        
        ctx.beginPath();
        ctx.arc(fx + fw * 0.3, fy + 9.5, 3.2, 0, 7);
        ctx.stroke();
        
        ctx.strokeRect(fx + fw * 0.55, fy + 6, 12, 7);
        ctx.beginPath();
        ctx.arc(fx + fw * 0.55 + 3, fy + 9.5, 1.5, 0, 7);
        ctx.arc(fx + fw * 0.55 + 9, fy + 9.5, 1.5, 0, 7);
        ctx.stroke();
    } else if (r.id === 'bath') {
        drawRoundedFurnitureRect(fx + 5, fy + 6, 11, 14, 3);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.ellipse(fx + 10.5, fy + 15, 3.8, 4.8, 0, 0, 7);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.ellipse(fx + fw - 11, fy + 11, 4.8, 3.2, 0, 0, 7);
        ctx.stroke();
    } else if (r.id === 'stair') {
        const stairsCount = 6;
        const stepH = fh / stairsCount;
        ctx.lineWidth = 0.9;
        for (let i = 1; i < stairsCount; i++) {
            ctx.beginPath();
            ctx.moveTo(fx + 4, fy + i * stepH);
            ctx.lineTo(fx + fw - 4, fy + i * stepH);
            ctx.stroke();
        }
        ctx.strokeRect(fx + 3, fy + 3, fw - 6, fh - 6);
        drawDimensionHead(fx + fw / 2, fy + 6, -Math.PI / 2, 6, BP_PALETTE.furn);
        ctx.beginPath();
        ctx.moveTo(fx + fw / 2, fy + fh - 6);
        ctx.lineTo(fx + fw / 2, fy + 8);
        ctx.stroke();
    } else if (r.id === 'porch') {
        drawRoundedFurnitureRect(cx - fw * 0.24, cy - fh * 0.34, fw * 0.48, fh * 0.68, 7);
        ctx.stroke();
        [[-0.14, -0.24], [0.14, -0.24], [-0.14, 0.24], [0.14, 0.24]].forEach(([dx, dy]) => {
            ctx.fillStyle = BP_PALETTE.furn;
            ctx.beginPath();
            ctx.ellipse(cx + fw * dx, cy + fh * dy, 3, 5, 0, 0, 7);
            ctx.fill();
        });
    } else if (r.id === 'store' || r.id === 'laundry') {
        ctx.strokeRect(fx + 5, fy + 5, fw - 10, 6);
        ctx.strokeRect(fx + 5, fy + 14, fw - 10, 6);
    } else if (r.id === 'open' || r.id === 'terrace') {
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
        for (let i = 0; i < 5; i++) {
            const gx = fx + 8 + i * (fw - 16) / 4;
            ctx.beginPath();
            ctx.moveTo(gx, fy + fh - 6);
            ctx.lineTo(gx - 3, fy + fh - 13);
            ctx.moveTo(gx, fy + fh - 6);
            ctx.lineTo(gx + 3, fy + fh - 13);
            ctx.stroke();
        }
    }
    ctx.restore();
};

const drawFloorPlanBlueprint = () => {
    try {
        const rect = canvas.getBoundingClientRect();
            ctx.fillStyle = BP_PALETTE.paper;
            ctx.fillRect(0, 0, rect.width, rect.height);
            
            // Draw Blueprint fine grid
            ctx.strokeStyle = '#101e30';
            ctx.lineWidth = 0.8;
            for (let x = 0; x < rect.width; x += 24) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, rect.height);
                ctx.stroke();
            }
            for (let y = 0; y < rect.height; y += 24) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(rect.width, y);
                ctx.stroke();
            }
            
            if (!floorPlanState.floors) {
                ctx.font = '500 14px "Space Grotesk", sans-serif';
                ctx.fillStyle = '#64748b';
                ctx.textAlign = 'center';
                ctx.fillText('Configure checklist requirements and click "Generate Floor Plan".', rect.width / 2, rect.height / 2 - 10);
                ctx.font = '500 12px "Space Grotesk", sans-serif';
                ctx.fillStyle = '#475569';
                ctx.fillText('(Plot size must be calculated first)', rect.width / 2, rect.height / 2 + 12);
                return;
            }
            
            const fl = floorPlanState.floors[Math.min(floorPlanState.view, floorPlanState.floors.length - 1)];
            const pad = 100;
            const sc = Math.min((rect.width - pad * 2) / fl.W, (rect.height - pad * 2) / fl.H);
            const ox = (rect.width - fl.W * sc) / 2;
            const oy = (rect.height - fl.H * sc) / 2;
            
            const OW = WALL_OUT_FT * sc;
            const IW = Math.max(2, WALL_IN_FT * sc);
            const eps = 0.06;
            
            const PX = ft => ox + ft * sc;
            const PY = ft => oy + ft * sc;
            const bx0 = PX(0);
            const by0 = PY(0);
            const bW = fl.W * sc;
            const bH = fl.H * sc;
            
            // Drop shadow under building layout
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.5)';
            ctx.shadowBlur = 20;
            ctx.shadowOffsetY = 6;
            ctx.fillStyle = BP_PALETTE.poche;
            ctx.fillRect(bx0, by0, bW, bH);
            ctx.restore();
            
            // 1. solid wall base poche
            ctx.fillStyle = BP_PALETTE.poche;
            ctx.fillRect(bx0, by0, bW, bH);
            
            // 2. carve room floor segments
            fl.placed.forEach(r => {
                const onL = r.x <= eps;
                const onT = r.y <= eps;
                const onR = r.x + r.w >= fl.W - eps;
                const onB = r.y + r.h >= fl.H - eps;
                const L = onL ? OW : IW / 2;
                const T = onT ? OW : IW / 2;
                const R = onR ? OW : IW / 2;
                const B = onB ? OW : IW / 2;
                
                const fx = PX(r.x) + L;
                const fy = PY(r.y) + T;
                const fw = r.w * sc - L - R;
                const fh = r.h * sc - T - B;
                
                r._fr = { fx, fy, fw, fh, onL, onT, onR, onB };
                if (fw <= 0 || fh <= 0) return;
                
                ctx.fillStyle = BP_PALETTE.floor;
                ctx.fillRect(fx, fy, fw, fh);
                
                // Add subtle indicator color overlay
                const fillCol = RCOL[r.id] || 'rgba(255,255,255,0.02)';
                ctx.fillStyle = fillCol;
                ctx.fillRect(fx, fy, fw, fh);
            });
            
            // 3. Render clean wall faces
            ctx.strokeStyle = BP_PALETTE.wallEdge;
            ctx.lineWidth = 1.8;
            ctx.strokeRect(bx0 + 0.8, by0 + 0.8, bW - 1.6, bH - 1.6);
            ctx.lineWidth = 1.0;
            ctx.strokeRect(bx0 + OW, by0 + OW, bW - 2 * OW, bH - 2 * OW);
            
            fl.placed.forEach(r => {
                const f = r._fr;
                if (f && f.fw > 0 && f.fh > 0) {
                    ctx.strokeStyle = 'rgba(174, 198, 247, 0.45)';
                    ctx.lineWidth = 1.0;
                    ctx.strokeRect(f.fx - 0.5, f.fy - 0.5, f.fw + 1, f.fh + 1);
                }
            });
            
            // 4. Windows on exterior boundaries
            fl.placed.forEach(r => {
                const f = r._fr;
                if (!f || f.fw <= 0 || f.fh <= 0 || ['open', 'terrace', 'corridor'].includes(r.id)) return;
                const segH = Math.min(f.fw * 0.5, 4 * sc);
                const segV = Math.min(f.fh * 0.5, 4 * sc);
                if (f.onT && f.fw > 44) drawBlueprintWindow(f.fx + f.fw / 2, by0 + OW / 2, [1, 0], OW, segH);
                if (f.onB && f.fw > 44) drawBlueprintWindow(f.fx + f.fw / 2, by0 + bH - OW / 2, [1, 0], OW, segH);
                if (f.onL && f.fh > 44) drawBlueprintWindow(bx0 + OW / 2, f.fy + f.fh / 2, [0, 1], OW, segV);
                if (f.onR && f.fh > 44) drawBlueprintWindow(bx0 + bW - OW / 2, f.fy + f.fh / 2, [0, 1], OW, segV);
            });
            
            // 5. Doors on interior walls
            fl.placed.forEach(r => {
                const f = r._fr;
                if (!f || f.fw < 36 || f.fh < 26 || ['open', 'porch', 'terrace', 'corridor'].includes(r.id)) return;
                const dl = Math.min(2.5 * sc, f.fw * 0.5, f.fh * 0.5);
                const edges = [];
                if (!f.onB) edges.push({ s: 'B', x: f.fx + Math.min(dl * 0.9, f.fw * 0.3), y: f.fy + f.fh, ax: 1, ay: 0, nx: 0, ny: -1, len: f.fw });
                if (!f.onR) edges.push({ s: 'R', x: f.fx + f.fw, y: f.fy + Math.min(dl * 0.9, f.fh * 0.3), ax: 0, ay: 1, nx: -1, ny: 0, len: f.fh });
                if (!f.onT) edges.push({ s: 'T', x: f.fx + Math.min(dl * 0.9, f.fw * 0.3), y: f.fy, ax: 1, ay: 0, nx: 0, ny: 1, len: f.fw });
                if (!f.onL) edges.push({ s: 'L', x: f.fx, y: f.fy + Math.min(dl * 0.9, f.fh * 0.3), ax: 0, ay: 1, nx: 1, ny: 0, len: f.fh });
                if (!edges.length) return;
                const d = edges[0];
                drawBlueprintDoor(d.x, d.y, d.ax, d.ay, d.nx, d.ny, dl);
            });
            
            // 6. Draw furniture blocks, titles, room dims
            fl.placed.forEach(r => {
                const f = r._fr;
                if (!f || f.fw <= 0 || f.fh <= 0) return;
                
                if (r.id === 'corridor') {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
                    ctx.lineWidth = 1.0;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    if (f.fw >= f.fh) {
                        ctx.moveTo(f.fx + 4, f.fy + f.fh / 2);
                        ctx.lineTo(f.fx + f.fw - 4, f.fy + f.fh / 2);
                    } else {
                        ctx.moveTo(f.fx + f.fw / 2, f.fy + 4);
                        ctx.lineTo(f.fx + f.fw / 2, f.fy + f.fh - 4);
                    }
                    ctx.stroke();
                    ctx.restore();
                    
                    ctx.fillStyle = '#64748b';
                    ctx.font = 'bold 9px "Space Grotesk", sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    const cx = f.fx + f.fw / 2;
                    const cy = f.fy + f.fh / 2;
                    if (f.fh > f.fw) {
                        ctx.save();
                        ctx.translate(cx, cy);
                        ctx.rotate(-Math.PI / 2);
                        ctx.fillText('Corridor · طرقہ تقسیم', 0, 0);
                        ctx.restore();
                    } else {
                        ctx.fillText('Corridor · طرقہ تقسیم', cx, cy);
                    }
                    ctx.textBaseline = 'alphabetic';
                    return;
                }
                
                drawRoomFurnitureBlock(r, f.fx, f.fy, f.fw, f.fh);
                const labelText = ROOM_LABELS[r.id] || [r.label || r.nm, ''];
                let enName = labelText[0];
                if (r.id === 'bed') {
                    const numMatch = (r.label || r.nm).match(/(\d+)/);
                    const numStr = numMatch ? numMatch[1] : '';
                    enName = numStr === '1' ? 'Master Bedroom' : `Bedroom ${numStr}`;
                }
                
                if (f.fw > 36 && f.fh > 26) {
                    ctx.textAlign = 'center';
                    ctx.font = 'bold 11px "Space Grotesk", sans-serif';
                    ctx.fillStyle = BP_PALETTE.label;
                    ctx.fillText(enName, f.fx + f.fw / 2, f.fy + f.fh / 2 - 3, f.fw - 6);
                    
                    if (labelText[1]) {
                        ctx.font = 'bold 9.5px "Space Grotesk", sans-serif';
                        ctx.fillStyle = BP_PALETTE.sub;
                        ctx.fillText(labelText[1], f.fx + f.fw / 2, f.fy + f.fh / 2 + 10, f.fw - 6);
                    }
                    
                    // Area in m2/sqft
                    if (f.fh > 56 && r.id !== 'open' && r.id !== 'porch' && r.id !== 'terrace') {
                        const areaSqFtVal = r.w * r.h;
                        const areaM2Val = areaSqFtVal / 10.7639;
                        ctx.font = '500 8.5px "Space Grotesk", sans-serif';
                        ctx.fillStyle = '#738aa6';
                        ctx.fillText(`${(r.w / FT_PER_M).toFixed(1)}m × ${(r.h / FT_PER_M).toFixed(1)}m · ${areaM2Val.toFixed(1)} m²`, f.fx + f.fw / 2, f.fy + f.fh / 2 + 24, f.fw - 6);
                    }
                    
                    // Dimension arrow line
                    const labelStr = r.customDim ? r.customDim : `${r.w.toFixed(0)}'×${r.h.toFixed(0)}'`;
                    if (f.fw > 60 && f.fh > 48) drawDimensionH(f.fx + 4, f.fx + f.fw - 4, f.fy + 11, labelStr);
                }
            });
            
            // 7. Outer overall dimensions
            const offsetDistance = 34;
            const extensionExt = 8;
            drawExtensionLine(bx0, by0, bx0, by0 - offsetDistance - extensionExt);
            drawExtensionLine(bx0 + bW, by0, bx0 + bW, by0 - offsetDistance - extensionExt);
            drawDimensionH(bx0, bx0 + bW, by0 - offsetDistance, `${fl.W.toFixed(1)} ft`);
            
            drawExtensionLine(bx0, by0, bx0 - offsetDistance - extensionExt, by0);
            drawExtensionLine(bx0, by0 + bH, bx0 - offsetDistance - extensionExt, by0 + bH);
            drawDimensionV(by0, by0 + bH, bx0 - offsetDistance, `${fl.H.toFixed(1)} ft`);
            
            // 8. Header text, North compass, scale bar
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            const totalAreaSqFtVal = fl.W * fl.H;
            const totalAreaM2Val = totalAreaSqFtVal / 10.7639;
            
            ctx.font = 'bold 12.5px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#f1f5f9';
            ctx.fillText(`TOTAL FOOTPRINT: ${totalAreaM2Val.toFixed(1)} m² · ${Math.round(totalAreaSqFtVal)} ft² (${(fl.W/FT_PER_M).toFixed(2)}m × ${(fl.H/FT_PER_M).toFixed(2)}m)`, bx0 + bW/2, by0 - offsetDistance - 40);
            
            ctx.font = 'bold 11px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#eab308';
            ctx.fillText('◄ FRONT ROAD — سامنے (Road Side) ►', bx0 + bW/2, by0 - offsetDistance - 20);
            
            const names = ['GROUND FLOOR PLAN', 'FIRST FLOOR PLAN', 'SECOND FLOOR PLAN'];
            ctx.fillStyle = '#cbd5e1';
            ctx.font = 'bold 12px "Space Grotesk", sans-serif';
            ctx.fillText(names[Math.min(floorPlanState.view, 2)], bx0 + bW/2, by0 + bH + 28);
            
            ctx.font = '500 9.5px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#475569';
            ctx.fillText('🔲 9" Outer Walls · 4.5" Partitions · Doors + Windows + Furniture blocks · Drag rooms to reposition', bx0 + bW/2, by0 + bH + 44);
            
            // North compass (top-left)
            const compassX = bx0 - 75;
            const compassY = by0 + 35;
            ctx.strokeStyle = '#cbd5e1';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(compassX, compassY, 14, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(compassX, compassY + 10);
            ctx.lineTo(compassX, compassY - 10);
            ctx.stroke();
            drawDimensionHead(compassX, compassY - 10, -Math.PI / 2, 6, '#cbd5e1');
            ctx.font = 'bold 10px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#f1f5f9';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('N', compassX, compassY - 20);
            ctx.textBaseline = 'alphabetic';
            
            // Scale bar (bottom-left)
            let metricUnit = 5;
            let barPixels = metricUnit * FT_PER_M * sc;
            if (barPixels > bW * 0.6) {
                metricUnit = 2;
                barPixels = metricUnit * FT_PER_M * sc;
            }
            if (barPixels > bW * 0.6) {
                metricUnit = 1;
                barPixels = metricUnit * FT_PER_M * sc;
            }
            const scaleBarX = bx0;
            const scaleBarY = by0 + bH + 54;
            const segment = barPixels / metricUnit;
            ctx.lineWidth = 1.0;
            ctx.strokeStyle = '#cbd5e1';
            for (let i = 0; i < metricUnit; i++) {
                ctx.fillStyle = (i % 2 === 0) ? '#cbd5e1' : '#0b1320';
                ctx.fillRect(scaleBarX + i * segment, scaleBarY, segment, 6);
                ctx.strokeRect(scaleBarX + i * segment, scaleBarY, segment, 6);
            }
            ctx.strokeRect(scaleBarX, scaleBarY, barPixels, 6);
            ctx.font = '500 8.5px "Space Grotesk", sans-serif';
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText('0', scaleBarX - 1, scaleBarY + 8);
            ctx.fillText(`${metricUnit} m`, scaleBarX + barPixels - 6, scaleBarY + 8);
            
            // Compass labels (sides)
            ctx.fillStyle = '#64748b';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.font = 'bold 10.5px "Space Grotesk", sans-serif';
            ctx.fillText('▲ REAR SIDE — پچھلی جانب ▲', bx0 + bW/2, by0 + bH + 14);
            
            ctx.font = 'bold 9.5px "Space Grotesk", sans-serif';
            ctx.save();
            ctx.translate(bx0 - 52, by0 + bH/2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText('◄ LEFT FACADE — بائیں جانب ►', 0, 0);
            ctx.restore();
            
            ctx.save();
            ctx.translate(bx0 + bW + 15, by0 + bH/2);
            ctx.rotate(Math.PI / 2);
            ctx.fillText('◄ RIGHT FACADE — دائیں جانب ►', 0, 0);
            ctx.restore();
            
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
    } catch (err) {
        console.error(err);
        alert("Error rendering blueprint: " + err.message + "\n" + err.stack);
    }
};

const RCOL = {
    open: 'rgba(34, 197, 94, 0.08)',
    porch: 'rgba(234, 179, 8, 0.08)',
    bed: 'rgba(59, 130, 246, 0.07)',
    bath: 'rgba(14, 165, 233, 0.08)',
    kitchen: 'rgba(249, 115, 22, 0.08)',
    draw: 'rgba(168, 85, 247, 0.07)',
    lounge: 'rgba(59, 130, 246, 0.04)',
    majlis_men: 'rgba(168, 85, 247, 0.07)',
    majlis_women: 'rgba(236, 72, 153, 0.06)',
    store: 'rgba(100, 116, 139, 0.08)',
    laundry: 'rgba(14, 165, 233, 0.05)',
    stair: 'rgba(234, 179, 8, 0.05)',
    terrace: 'rgba(34, 197, 94, 0.05)',
    corridor: 'rgba(100, 116, 139, 0.04)'
};

// --- 6. Three.js 3D Viewport Setup ---
const V3D = {
    on: false,
    mode: 'orbit',
    useSun: true,
    roof: false,
    scene: null,
    camera: null,
    renderer: null,
    rafId: null,
    yaw: 0.6,
    pitch: 0.5,
    radius: 0,
    target: null,
    walk: { x: 0, z: 0, ang: 0, pitch: 0, keys: {} },
    dragging: false,
    lastX: 0,
    lastY: 0,
    sunLight: null,
    hemiLight: null,
    group: null,
    floorView: 0,
    ppf: 1
};

const FT_PER_M = 3.28084;
const WALL_HEIGHT_FT = 10;

const convertPixelTo3D = (px, py, ppf, cx, cy) => {
    return [(px - cx) / ppf, (py - cy) / ppf];
};

const add3DFurnitureMesh = (T, group, r, ox, oz) => {
    if (r.w < 4 || r.h < 4) return;
    const rx = r.x + r.w / 2 - ox;
    const rz = r.y + r.h / 2 - oz;
    
    const boxMesh = (w, h, d, y, color, dx = 0, dz = 0) => {
        const mesh = new T.Mesh(
            new T.BoxGeometry(w, h, d),
            new T.MeshStandardMaterial({ color, roughness: 0.7 })
        );
        mesh.position.set(rx + dx, y, rz + dz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    };
    
    if (r.id === 'bed') {
        boxMesh(Math.min(r.w * 0.62, 7.5), 1.7, Math.min(r.h * 0.72, 7), 1.0, 0x5a7ab8);
        boxMesh(Math.min(r.w * 0.55, 6), 0.5, 1.2, 1.9, 0xaec6f7, 0, -Math.min(r.h * 0.28, 2.4));
    } else if (r.id === 'lounge' || r.id === 'draw') {
        boxMesh(Math.min(r.w * 0.72, 10), 1.6, 2.2, 1.0, 0x4e5a7d, 0, r.h * 0.26);
        boxMesh(2.6, 1.0, 1.6, 0.7, 0x826442, 0, -r.h * 0.02);
        if (r.id === 'draw') {
            boxMesh(4.2, 1.2, 2.6, 0.9, 0x4f5a70, 0, -r.h * 0.3);
        }
    } else if (r.id === 'kitchen') {
        boxMesh(r.w * 0.82, 2.4, 1.5, 1.4, 0x93654e, 0, -r.h * 0.34);
    } else if (r.id === 'bath') {
        boxMesh(1.8, 1.6, 2.4, 1.0, 0xaec6f7, -r.w * 0.24, r.h * 0.18);
    } else if (r.id === 'stair') {
        const steps = 5;
        for (let i = 0; i < steps; i++) {
            boxMesh(Math.min(r.w * 0.6, 4), 1.1 * (i + 1), 1.3, 0.55 * (i + 1), 0xa0a8b5, 0, -r.h * 0.3 + i * 1.3);
        }
    } else if (r.id === 'porch') {
        boxMesh(Math.min(r.w * 0.5, 7), 2.2, Math.min(r.h * 0.5, 13), 1.4, 0x42526e);
    } else if (r.id === 'store' || r.id === 'laundry') {
        boxMesh(r.w * 0.7, 2.0, 1.2, 1.2, 0x4f5869, 0, -r.h * 0.3);
    }
};

const build3DViewportScene = () => {
    const T = window.THREE;
    if (!T) return false;
    const host = document.getElementById('view3d');
    const w = host.clientWidth;
    const h = host.clientHeight;
    
    if (!V3D.renderer) {
        V3D.renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        V3D.renderer.shadowMap.enabled = true;
        V3D.renderer.shadowMap.type = T.PCFSoftShadowMap;
        host.appendChild(V3D.renderer.domElement);
        attachV3DControls(V3D.renderer.domElement);
    }
    V3D.renderer.setSize(w, h);
    V3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    
    const scene = new T.Scene();
    scene.background = new T.Color('#0a0f18');
    scene.fog = new T.Fog('#0a0f18', 120, 520);
    V3D.scene = scene;
    
    V3D.camera = new T.PerspectiveCamera(55, w / h, 0.5, 4000);
    
    V3D.hemiLight = new T.HemisphereLight('#bcd3ff', '#20304a', 0.75);
    scene.add(V3D.hemiLight);
    
    const ambientLight = new T.AmbientLight('#ffffff', 0.18);
    scene.add(ambientLight);
    
    V3D.sunLight = new T.DirectionalLight('#fff4d6', 1.15);
    V3D.sunLight.castShadow = true;
    V3D.sunLight.shadow.mapSize.set(2048, 2048);
    const shadowCam = V3D.sunLight.shadow.camera;
    shadowCam.near = 1;
    shadowCam.far = 1200;
    shadowCam.left = -300;
    shadowCam.right = 300;
    shadowCam.top = 300;
    shadowCam.bottom = -300;
    scene.add(V3D.sunLight);
    scene.add(V3D.sunLight.target);
    
    V3D.group = new T.Group();
    scene.add(V3D.group);
    
    build3DModel();
    applyV3DSunAngle();
    frameV3DCamera();
    return true;
};

const getNeighbor3DBlocks = (plotData) => {
    const pts = plotData.vertices;
    const cx = (pts[0].x + pts[2].x) / 2;
    const cy = (pts[0].y + pts[2].y) / 2;
    const factor = getPixelToPhysicalFactor();
    const ppf = pxPerUnit() / (state.unit === 'meters' ? 0.3048 : 1);
    
    const sides = [
        { key: state.neighborFront, edgeIdx: 0, label: 'Front' },
        { key: state.neighborLeft, edgeIdx: 3, label: 'Left' },
        { key: state.neighborRight, edgeIdx: 1, label: 'Right' },
        { key: state.neighborRear, edgeIdx: 2, label: 'Rear' }
    ];
    
    const out = [];
    sides.forEach(s => {
        if (!['1-floor', '2-floor', 'commercial'].includes(s.key)) return;
        const p1 = pts[s.edgeIdx];
        const p2 = pts[(s.edgeIdx + 1) % 4];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const len = Math.hypot(dx, dy);
        let nx = -dy / len;
        let ny = dx / len;
        
        // Ensure pointing outward
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        if ((cx - mx) * nx + (cy - my) * ny > 0) {
            nx = -nx;
            ny = -ny;
        }
        
        const d = 26; // adjacent depth
        const [x1, z1] = convertPixelTo3D(p1.x, p1.y, ppf, cx, cy);
        const [x2, z2] = convertPixelTo3D(p2.x, p2.y, ppf, cx, cy);
        const [x3, z3] = convertPixelTo3D(p2.x + nx * d, p2.y + ny * d, ppf, cx, cy);
        const [x4, z4] = convertPixelTo3D(p1.x + nx * d, p1.y + ny * d, ppf, cx, cy);
        
        out.push({
            h: s.key === '2-floor' ? 1.4 : 0.7,
            pts: [[x1, z1], [x2, z2], [x3, z3], [x4, z4]]
        });
    });
    return out;
};

const build3DModel = () => {
    const T = window.THREE;
    const g = V3D.group;
    if (!g) return;
    
    while (g.children.length) g.remove(g.children[0]);
    
    // ground plane
    const ground = new T.Mesh(
        new T.PlaneGeometry(2000, 2000),
        new T.MeshStandardMaterial({ color: '#101a2b', roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.1;
    ground.receiveShadow = true;
    g.add(ground);
    
    // grid helper
    const grid = new T.GridHelper(600, 60, 0x1d2f4c, 0x111c2e);
    grid.position.y = 0;
    g.add(grid);
    
    const rect = canvas.getBoundingClientRect();
    const plotData = getCenteredPlotVertices(rect.width, rect.height);
    if (!plotData) return;
    
    const pts = plotData.vertices;
    const cx = (pts[0].x + pts[2].x) / 2;
    const cy = (pts[0].y + pts[2].y) / 2;
    const ppf = pxPerUnit() / (state.unit === 'meters' ? 0.3048 : 1);
    V3D.ppf = ppf;
    V3D._cx = cx;
    V3D._cy = cy;
    
    // Plot slab extrude
    const shape = new T.Shape();
    pts.forEach((p, i) => {
        const [x, z] = convertPixelTo3D(p.x, p.y, ppf, cx, cy);
        if (i === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
    });
    const floorGeo = new T.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false });
    floorGeo.rotateX(Math.PI / 2);
    const floorMesh = new T.Mesh(floorGeo, new T.MeshStandardMaterial({ color: '#16233d', roughness: 0.95 }));
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    g.add(floorMesh);
    
    // Blue boundary line in 3D
    const boundaryPoints = pts.map(p => {
        const [x, z] = convertPixelTo3D(p.x, p.y, ppf, cx, cy);
        return new T.Vector3(x, 0.6, z);
    });
    boundaryPoints.push(boundaryPoints[0].clone());
    const boundaryLine = new T.Line(
        new T.BufferGeometry().setFromPoints(boundaryPoints),
        new T.LineBasicMaterial({ color: 0x3b82f6 })
    );
    g.add(boundaryLine);
    
    // 2D lines to 3D walls (only if no procedural floor plan has been generated)
    const wallMat = new T.MeshStandardMaterial({ color: '#cfd8e5', roughness: 0.85 });
    if (!floorPlanState.floors) {
        state.lines.forEach(l => {
            const [x1, z1] = convertPixelTo3D(l.startX, l.startY, ppf, cx, cy);
            const [x2, z2] = convertPixelTo3D(l.endX, l.endY, ppf, cx, cy);
            const len = Math.hypot(x2 - x1, z2 - z1);
            if (len < 0.3) return;
            const wall = new T.Mesh(new T.BoxGeometry(len, WALL_HEIGHT_FT, 0.75), wallMat);
            wall.position.set((x1 + x2) / 2, WALL_HEIGHT_FT / 2, (z1 + z2) / 2);
            wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
            wall.castShadow = true;
            wall.receiveShadow = true;
            g.add(wall);
        });
    } else {
        // Floor Plan procedural model builder
        const ROOM_COLORS_3D = {
            open: 0x22c55e, porch: 0xeab308, bed: 0x3b82f6, bath: 0x0ea5e9,
            kitchen: 0xf97316, draw: 0xa855f7, lounge: 0x5a8ff7, store: 0x64748b,
            laundry: 0x0ea5e9, stair: 0xeab308, terrace: 0x22c55e, corridor: 0x475569
        };
        
        const fv = Math.min(V3D.floorView, floorPlanState.floors.length - 1);
        const fl = floorPlanState.floors[fv];
        const OX = fl.W / 2;
        const OZ = fl.H / 2;
        const WH = WALL_HEIGHT_FT;
        const eps = 0.06;
        
        // solid base slab for this story
        const base = new T.Mesh(
            new T.BoxGeometry(fl.W, 0.4, fl.H),
            new T.MeshStandardMaterial({ color: 0x0c1626, roughness: 1 })
        );
        base.position.set(0, -0.2, 0);
        base.receiveShadow = true;
        g.add(base);
        
        // per-room floor color slab extrusion + furniture meshes
        fl.placed.forEach(r => {
            const col = ROOM_COLORS_3D[r.id] || 0x3b82f6;
            const slab = new T.Mesh(
                new T.BoxGeometry(Math.max(0.5, r.w - 0.25), 0.3, Math.max(0.5, r.h - 0.25)),
                new T.MeshStandardMaterial({ color: col, roughness: 0.85 })
            );
            slab.position.set(r.x + r.w / 2 - OX, 0.15, r.y + r.h / 2 - OZ);
            slab.receiveShadow = true;
            g.add(slab);
            add3DFurnitureMesh(T, g, r, OX, OZ);
        });
        
        // partition interior walls
        const seen = new Set();
        const partMat = new T.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.85 });
        const isBoundary = (p1, p2) => {
            return (Math.abs(p1[0]) < eps && Math.abs(p2[0]) < eps) ||
                   (Math.abs(p1[0] - fl.W) < eps && Math.abs(p2[0] - fl.W) < eps) ||
                   (Math.abs(p1[1]) < eps && Math.abs(p2[1]) < eps) ||
                   (Math.abs(p1[1] - fl.H) < eps && Math.abs(p2[1] - fl.H) < eps);
        };
        
        fl.placed.forEach(r => {
            const corners = [
                [r.x, r.y], [r.x + r.w, r.y],
                [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]
            ];
            for (let i = 0; i < 4; i++) {
                const p1 = corners[i];
                const p2 = corners[(i + 1) % 4];
                const key1 = `${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
                const key2 = `${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
                const edgeKey = key1 < key2 ? `${key1}|${key2}` : `${key2}|${key1}`;
                
                if (seen.has(edgeKey)) continue;
                seen.add(edgeKey);
                if (isBoundary(p1, p2)) continue;
                
                const ax = p1[0] - OX;
                const az = p1[1] - OZ;
                const bx = p2[0] - OX;
                const bz = p2[1] - OZ;
                const len = Math.hypot(bx - ax, bz - az);
                if (len < 0.5) continue;
                
                const w = new T.Mesh(new T.BoxGeometry(len, WH * 0.9, 0.42), partMat);
                w.position.set((ax + bx) / 2, WH * 0.45, (az + bz) / 2);
                w.rotation.y = -Math.atan2(bz - az, bx - ax);
                w.castShadow = true;
                w.receiveShadow = true;
                g.add(w);
            }
        });
        
        // thick outer boundary walls
        const OWt = 0.75;
        const outerMat = new T.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.8 });
        [
            [0, 0, fl.W, 0], [fl.W, 0, fl.W, fl.H],
            [fl.W, fl.H, 0, fl.H], [0, fl.H, 0, 0]
        ].forEach(([x1, y1, x2, y2]) => {
            const ax = x1 - OX;
            const az = y1 - OZ;
            const bx = x2 - OX;
            const bz = y2 - OZ;
            const len = Math.hypot(bx - ax, bz - az);
            const w = new T.Mesh(new T.BoxGeometry(len + OWt, WH, OWt), outerMat);
            w.position.set((ax + bx) / 2, WH / 2, (az + bz) / 2);
            w.rotation.y = -Math.atan2(bz - az, bx - ax);
            w.castShadow = true;
            w.receiveShadow = true;
            g.add(w);
        });
    }
    
    // Neighbor block masses
    getNeighbor3DBlocks(plotData).forEach(b => {
        const bh = b.h * WALL_HEIGHT_FT;
        
        const shape = new T.Shape();
        b.pts.forEach((p, idx) => {
            if (idx === 0) shape.moveTo(p[0], p[1]);
            else shape.lineTo(p[0], p[1]);
        });
        
        const geo = new T.ExtrudeGeometry(shape, { depth: bh, bevelEnabled: false });
        geo.rotateX(-Math.PI / 2); // Extrude upwards on XZ plane
        
        const nb = new T.Mesh(
            geo,
            new T.MeshStandardMaterial({ color: 0x27364d, roughness: 1.0, transparent: true, opacity: 0.4 })
        );
        nb.position.y = 0;
        nb.castShadow = true;
        nb.receiveShadow = true;
        g.add(nb);
    });
    
    // Utility pins posts
    state.pins.forEach(pin => {
        const [x, z] = convertPixelTo3D(pin.x, pin.y, ppf, cx, cy);
        const col = pin.type === 'gas' ? 0xf97316 : (pin.type === 'electric' ? 0xef4444 : 0x3b82f6);
        
        const post = new T.Mesh(
            new T.CylinderGeometry(0.3, 0.3, 6, 12),
            new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 })
        );
        post.position.set(x, 3, z);
        post.castShadow = true;
        g.add(post);
        
        const sphere = new T.Mesh(
            new T.SphereGeometry(0.9, 14, 14),
            new T.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5 })
        );
        sphere.position.set(x, 6.3, z);
        g.add(sphere);
    });
    
    // Optional roof extrude mesh
    if (V3D.roof && plotData) {
        const shapeR = new T.Shape();
        pts.forEach((p, i) => {
            const [x, z] = convertPixelTo3D(p.x, p.y, ppf, cx, cy);
            if (i === 0) shapeR.moveTo(x, z);
            else shapeR.lineTo(x, z);
        });
        const roofGeo = new T.ExtrudeGeometry(shapeR, { depth: 0.6, bevelEnabled: false });
        roofGeo.rotateX(Math.PI / 2);
        const roofMesh = new T.Mesh(roofGeo, new T.MeshStandardMaterial({ color: '#7c2d12', roughness: 0.85, transparent: true, opacity: 0.9 }));
        roofMesh.position.y = WALL_HEIGHT_FT + 0.3;
        roofMesh.castShadow = true;
        g.add(roofMesh);
    }
    
    // Imported mesh rendering scaling to fit plot bounds
    if (state.imported3DModel) {
        const mesh3D = new T.Mesh(
            state.imported3DModel,
            new T.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.65, flatShading: true })
        );
        state.imported3DModel.computeBoundingBox();
        const bbox = state.imported3DModel.boundingBox;
        const size = new T.Vector3();
        bbox.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const targetFt = Math.min(rect.width, rect.height) / ppf * 0.4;
        const scalar = targetFt / maxDim;
        mesh3D.scale.setScalar(scalar);
        
        const center = new T.Vector3();
        bbox.getCenter(center);
        mesh3D.position.set(-center.x * scalar, -bbox.min.y * scalar, -center.z * scalar);
        mesh3D.castShadow = true;
        mesh3D.receiveShadow = true;
        g.add(mesh3D);
    }
};

const applyV3DSunAngle = () => {
    const T = window.THREE;
    if (!V3D.sunLight) return;
    
    if (V3D.useSun) {
        // az: East(90) noon(180) West(270)
        const azDeg = 90 + 15 * (state.simTime - 6);
        const peak = state.simSeason === 'summer' ? 72 : 38;
        const elDeg = Math.max(2, peak * Math.sin(Math.PI * (state.simTime - 6) / 12));
        
        // facing rotation adjustment
        const SIM_COMPASS_ROT = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 };
        const rot = SIM_COMPASS_ROT[state.simOrientation] || 0;
        
        const az = (azDeg - 90) * Math.PI / 180 + rot;
        const el = elDeg * Math.PI / 180;
        const radius = 250;
        
        V3D.sunLight.position.set(
            Math.cos(az) * Math.cos(el) * radius,
            Math.sin(el) * radius + 15,
            Math.sin(az) * Math.cos(el) * radius
        );
        V3D.sunLight.intensity = state.simSeason === 'summer' ? 1.25 : 0.95;
        V3D.sunLight.color.set(elDeg < 15 ? '#ff9d47' : '#fff3d1');
        V3D.hemiLight.intensity = 0.4 + 0.45 * Math.sin(el);
    } else {
        V3D.sunLight.position.set(120, 240, 90);
        V3D.sunLight.intensity = 1.1;
        V3D.sunLight.color.set('#ffffff');
        V3D.hemiLight.intensity = 0.75;
    }
    V3D.sunLight.target.position.set(0, 0, 0);
};

const frameV3DCamera = () => {
    const T = window.THREE;
    let span = 80;
    const rect = canvas.getBoundingClientRect();
    const plotData = getCenteredPlotVertices(rect.width, rect.height);
    if (plotData) {
        const pts = plotData.vertices;
        const xs = pts.map(p => p.x);
        const ys = pts.map(p => p.y);
        span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / V3D.ppf;
    }
    V3D.radius = Math.max(60, span * 1.85);
    V3D.target = new T.Vector3(0, WALL_HEIGHT_FT * 0.4, 0);
    updateV3DOrbitCamera();
};

const updateV3DOrbitCamera = () => {
    const r = V3D.radius;
    const p = V3D.pitch;
    V3D.camera.position.set(
        V3D.target.x + r * Math.cos(V3D.yaw) * Math.cos(p),
        V3D.target.y + r * Math.sin(p),
        V3D.target.z + r * Math.sin(V3D.yaw) * Math.cos(p)
    );
    V3D.camera.lookAt(V3D.target);
};

const attachV3DControls = (dom) => {
    dom.addEventListener('mousedown', (e) => {
        V3D.dragging = true;
        V3D.lastX = e.clientX;
        V3D.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { V3D.dragging = false; });
    window.addEventListener('mousemove', (e) => {
        if (!V3D.dragging || !V3D.on) return;
        const dx = e.clientX - V3D.lastX;
        const dy = e.clientY - V3D.lastY;
        V3D.lastX = e.clientX;
        V3D.lastY = e.clientY;
        
        if (V3D.mode === 'orbit') {
            V3D.yaw += dx * 0.008;
            V3D.pitch = Math.max(0.08, Math.min(1.42, V3D.pitch - dy * 0.008));
            updateV3DOrbitCamera();
        } else {
            V3D.walk.ang -= dx * 0.005;
            V3D.walk.pitch = Math.max(-0.6, Math.min(0.6, V3D.walk.pitch - dy * 0.004));
        }
    });
    dom.addEventListener('wheel', (e) => {
        if (!V3D.on || V3D.mode !== 'orbit') return;
        e.preventDefault();
        V3D.radius = Math.max(12, Math.min(1300, V3D.radius * (1 + Math.sign(e.deltaY) * 0.1)));
        updateV3DOrbitCamera();
    }, { passive: false });
    
    window.addEventListener('keydown', (e) => {
        if (V3D.on && V3D.mode === 'walk') V3D.walk.keys[e.key.toLowerCase()] = true;
    });
    window.addEventListener('keyup', (e) => {
        if (V3D.on) V3D.walk.keys[e.key.toLowerCase()] = false;
    });
};

const stepV3DWalkMovement = () => {
    const wk = V3D.walk;
    const k = wk.keys;
    const speed = 0.95;
    const fx = Math.cos(wk.ang);
    const fz = Math.sin(wk.ang);
    
    if (k['w']) { wk.x += fx * speed; wk.z += fz * speed; }
    if (k['s']) { wk.x -= fx * speed; wk.z -= fz * speed; }
    if (k['a']) { wk.x += fz * speed; wk.z -= fx * speed; }
    if (k['d']) { wk.x -= fz * speed; wk.z += fx * speed; }
    
    V3D.camera.position.set(wk.x, 5.5, wk.z);
    V3D.camera.lookAt(wk.x + Math.cos(wk.ang), 5.5 + Math.sin(wk.pitch), wk.z + Math.sin(wk.ang));
};

const runV3DRenderLoop = () => {
    if (!V3D.on) {
        V3D.rafId = null;
        return;
    }
    if (V3D.mode === 'walk') {
        stepV3DWalkMovement();
    }
    V3D.renderer.render(V3D.scene, V3D.camera);
    V3D.rafId = requestAnimationFrame(runV3DRenderLoop);
};

const buildV3DFloorsUI = () => {
    const container = document.getElementById('v3d-floors-container');
    if (!container) return;
    if (!floorPlanState.floors || floorPlanState.count < 2) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'inline-flex';
    container.innerHTML = '';
    const names = ['Ground', '1st Floor', '2nd Floor'];
    for (let f = 0; f < floorPlanState.count; f++) {
        const btn = document.createElement('button');
        btn.textContent = names[f];
        btn.className = `v3d-btn ${f === V3D.floorView ? 'on' : ''}`;
        btn.onclick = () => {
            V3D.floorView = f;
            buildV3DFloorsUI();
            if (V3D.on) {
                build3DModel();
                applyV3DSunAngle();
                frameV3DCamera();
            }
        };
        container.appendChild(btn);
    }
};

const open3DView = () => {
    if (!window.THREE) {
        alert('Waiting for WebGL engine to bootstrap from CDN...');
        setTimeout(() => {
            if (!window.THREE) {
                alert('WebGL Engine (Three.js) failed to load. Please check your internet connection or reload the app.');
                close3DView();
            } else {
                open3DView();
            }
        }, 2000);
        return;
    }
    
    document.getElementById('view3d').classList.add('open');
    V3D.on = true;
    V3D.floorView = Math.min(floorPlanState.view || 0, floorPlanState.count - 1);
    build3DViewportScene();
    buildV3DFloorsUI();
    
    if (!V3D.rafId) runV3DRenderLoop();
    document.getElementById('btn-open-3d').classList.add('on');
};

const close3DView = () => {
    V3D.on = false;
    document.getElementById('view3d').classList.remove('open');
    document.getElementById('btn-open-3d').classList.remove('on');
};

const btnOpen3D = document.getElementById('btn-open-3d');
if (btnOpen3D) {
    btnOpen3D.addEventListener('click', () => {
        if (V3D.on) close3DView();
        else open3DView();
    });
}
document.getElementById('v3d-btn-close').addEventListener('click', close3DView);

document.getElementById('v3d-btn-orbit').onclick = () => {
    V3D.mode = 'orbit';
    document.getElementById('v3d-btn-orbit').classList.add('on');
    document.getElementById('v3d-btn-walk').classList.remove('on');
    document.getElementById('v3d-hint').textContent = 'Drag mouse to rotate · Scroll to zoom · Walk button to traverse inside';
    frameV3DCamera();
};

document.getElementById('v3d-btn-walk').onclick = () => {
    V3D.mode = 'walk';
    document.getElementById('v3d-btn-orbit').classList.remove('on');
    document.getElementById('v3d-btn-walk').classList.add('on');
    document.getElementById('v3d-hint').textContent = 'Walk: WASD to move · Drag mouse to look around · Orbit to return';
    V3D.walk.x = 0;
    V3D.walk.z = -V3D.radius * 0.35;
    V3D.walk.ang = Math.PI / 2;
    V3D.walk.pitch = 0;
};

document.getElementById('v3d-btn-sun').onclick = () => {
    V3D.useSun = !V3D.useSun;
    document.getElementById('v3d-btn-sun').classList.toggle('on', V3D.useSun);
    applyV3DSunAngle();
};

document.getElementById('v3d-btn-roof').onclick = () => {
    V3D.roof = !V3D.roof;
    document.getElementById('v3d-btn-roof').classList.toggle('on', V3D.roof);
    build3DModel();
};

document.getElementById('v3d-btn-png').onclick = () => {
    V3D.renderer.render(V3D.scene, V3D.camera);
    const url = V3D.renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'plot-planner-3d-model.png';
    link.href = url;
    link.click();
};

// Sync 3D with Simulator slider changes
const timeSlider = document.getElementById('sim-time-slider');
if (timeSlider) {
    timeSlider.addEventListener('input', () => {
        if (V3D.on && V3D.useSun) applyV3DSunAngle();
    });
}
const seasonToggle = document.getElementById('sim-season-toggle');
if (seasonToggle) {
    seasonToggle.addEventListener('change', () => {
        if (V3D.on && V3D.useSun) applyV3DSunAngle();
    });
}
const sunToggle = document.getElementById('toggle-sun-path');
if (sunToggle) {
    sunToggle.addEventListener('change', () => {
        if (V3D.on && V3D.useSun) applyV3DSunAngle();
    });
}

// Window resizing for WebGL
window.addEventListener('resize', () => {
    if (V3D.on && V3D.renderer) {
        const host = document.getElementById('view3d');
        const w = host.clientWidth;
        const h = host.clientHeight;
        V3D.renderer.setSize(w, h);
        V3D.camera.aspect = w / h;
        V3D.camera.updateProjectionMatrix();
    }
});

// Kick off
initRequirementsUI();
resizeCanvas();
updateStats();
recalculateIrregularPlot();
updatePassiveRecommendations();
renderComments();
recalculateBOM();
draw();
console.log("Drafting engine loaded successfully.");
