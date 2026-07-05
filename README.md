# Plot Planner Pro 📐🏠

**Plot Planner Pro** is a premium, agentic web application designed for real-time 2D CAD drafting, procedural floor plan generation, 3D WebGL visualization, and construction cost estimation. Calibrated for standard Pakistani construction bylaws (LDA, CDA, RUDA), it offers a complete suite of tools for builders, architects, and landowners.

## Key Features

*   **2D Blueprint CAD Canvas:** 
    *   Draw, measure, snap-to-grid, and adjust line weights/colors.
    *   Dynamic setbacks rendering (Front, Rear, Side setbacks computed per authority).
    *   Metric / Imperial unit conversion.
*   **Procedural Floor Plan Generator:**
    *   Calculates irregular plot coordinates using the Law of Cosines math engine.
    *   Generates optimized room placements (Bedroom, Washroom, Kitchen, Lounge, Store, Porch, Lawn) per floor.
    *   Interactive rooms resizing and manual dragger repositioning.
*   **3D WebGL Viewport:**
    *   Real-time extruded 3D walls, slabs, roof capping, and adjacent neighborhood blocks.
    *   Time-of-day and seasonal sun angle shadow simulator.
    *   Orbit and Walkthrough (W/A/S/D) cameras.
    *   Camera snapshot exporter.
*   **Bill of Quantities (BOM) & Cost Estimator:**
    *   Auto-estimates raw construction quantities (Bricks, Cement bags, Sand in CFT, Flooring tiles).
    *   Allows manual overrides of quantities and market rates to calculate subtotal and total cost instantly.
*   **Import / Export:**
    *   Imports backdrop tracing images (PNG/JPG), vector boundaries (SVG/DXF), and 3D meshes (OBJ/STL).
    *   Saves and loads full project states in JSON.

## How to Run Locally

This app runs fully in the browser and does not require complex backend configurations.

1.  Clone this repository or download the files.
2.  Open `index.html` directly in a browser, or run a local HTTP server:
    ```bash
    # If python is installed
    python -m http.server 8080
    ```
3.  Access the app at `http://localhost:8080`.

## Technology Stack

*   **Frontend:** HTML5, Vanilla JavaScript, CSS3 Design Tokens
*   **3D Graphics:** Three.js WebGL Engine (using OrbitControls & custom Walkthrough inputs)
*   **Math Math Engine:** Law of Cosines (Irregular Quadrilateral Coordinates Solver)
*   **Layout Engine:** Binary Split Treemap Partitioner
