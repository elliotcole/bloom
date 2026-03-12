// Hand-engraved musical glyphs — Canvas 2D drawing functions.
//
// Shapes extracted from manuscript reference images (glyph examples folder)
// and parameterised as pure Canvas paths. No music font required.
//
// Anchor conventions
// ──────────────────
//   drawNotehead    cx, cy  = notehead centre
//   drawSharp       cx, cy  = centre of the note's staff position (line or space)
//   drawFlat        cx, cy  = centre of the note's staff position
//   drawTrebleClef  cx      = stem x / visual centre
//                   cy      = G4 line y  (2nd line from bottom of treble staff)
//   drawBassClef    cx      = body visual centre x
//                   cy      = F3 line y  (4th line from bottom, the defining "F" line)
//
// All dimensions are multiples of  s  (= LINE_SPACING, pixels between adjacent staff lines).

// ── Notehead ──────────────────────────────────────────────────────────────────

/**
 * Solid filled ellipse with a slight hand-engraved tilt.
 */
export function drawNotehead(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 13);   // ≈ 13.8° tilt
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.56, s * 0.37, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Sharp ─────────────────────────────────────────────────────────────────────

/**
 * Sharp accidental (♯).
 * Two thin vertical lines + two filled parallelogram bars tilted slightly
 * upward from left to right.
 */
export function drawSharp(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle   = color;
  ctx.strokeStyle = color;
  ctx.lineCap     = 'butt';

  // Two thin vertical lines
  const vx1 = cx - s * 0.22;
  const vx2 = cx + s * 0.22;
  ctx.lineWidth = s * 0.085;
  ctx.beginPath();
  ctx.moveTo(vx1, cy - s * 1.15); ctx.lineTo(vx1, cy + s * 1.15);
  ctx.moveTo(vx2, cy - s * 1.15); ctx.lineTo(vx2, cy + s * 1.15);
  ctx.stroke();

  // Two angled bars — filled parallelograms, right side slightly higher
  const barHW = s * 0.50;
  const barTH = s * 0.115;
  const tilt  = s * 0.11;

  for (const barY of [cy - s * 0.35, cy + s * 0.38]) {
    const tl = barY + tilt / 2 - barTH;
    const tr = barY - tilt / 2 - barTH;
    const bl = barY + tilt / 2 + barTH;
    const br = barY - tilt / 2 + barTH;
    ctx.beginPath();
    ctx.moveTo(cx - barHW, tl);
    ctx.lineTo(cx + barHW, tr);
    ctx.lineTo(cx + barHW, br);
    ctx.lineTo(cx - barHW, bl);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// ── Flat ──────────────────────────────────────────────────────────────────────

/**
 * Flat accidental (♭).
 * A tall vertical stem with a filled teardrop body curving to the right.
 */
export function drawFlat(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.fillStyle   = color;
  ctx.strokeStyle = color;
  ctx.lineCap     = 'round';

  ctx.lineWidth = s * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 2.75);
  ctx.lineTo(cx, cy + s * 0.45);
  ctx.stroke();

  const bW  = s * 0.80;
  const bT  = cy - s * 0.82;
  const bB  = cy + s * 0.42;
  const bMY = cy - s * 0.08;

  ctx.beginPath();
  ctx.moveTo(cx, bT);
  ctx.bezierCurveTo(cx + bW * 0.82, bT + s * 0.04, cx + bW, bMY - s * 0.22, cx + bW, bMY);
  ctx.bezierCurveTo(cx + bW, bMY + s * 0.34, cx + bW * 0.46, bB + s * 0.06, cx, bB);
  ctx.fill();

  ctx.restore();
}

// ── Treble Clef ───────────────────────────────────────────────────────────────

/**
 * G clef (treble clef) — two-layer Canvas draw:
 *
 *  Layer 1 — ONE continuous stem stroke:
 *    scroll tip → backward-J curl → rising body → through G-line → top hook.
 *    The stem passes through the center of the G-ring.
 *
 *  Layer 2 — G-ring arc drawn ON TOP of the stem:
 *    The ring overlaps the stem at its top and bottom, creating the appearance
 *    of the stem threading through the ring — exactly as in the reference image.
 *
 * cy = G4 line.  Glyph spans: ~3.0 s above cy … ~4.2 s below cy.
 */
export function drawTrebleClef(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  const lw = s * 0.095;

  // ── Layer 1: continuous stem (scroll → body → top hook) ──────────────────
  ctx.lineWidth = lw;
  ctx.beginPath();

  // Scroll tip (backward J at bottom — reference shows it sitting ~4 s below G line)
  ctx.moveTo(cx + s * 0.22, cy + s * 3.85);

  // Scroll curl: sweeps right then returns
  ctx.bezierCurveTo(
    cx + s * 0.80, cy + s * 4.22,
    cx + s * 1.00, cy + s * 3.28,
    cx + s * 0.38, cy + s * 2.60,
  );

  // Rising from scroll toward G line — stem passes through cx at cy
  ctx.bezierCurveTo(
    cx + s * 0.02, cy + s * 1.90,
    cx - s * 0.06, cy + s * 1.08,
    cx + s * 0.00, cy + s * 0.52,
  );

  // Smooth through the G-line region (ring will be drawn here, layer 2)
  ctx.bezierCurveTo(
    cx + s * 0.00, cy + s * 0.25,
    cx + s * 0.00, cy - s * 0.25,
    cx + s * 0.00, cy - s * 0.55,
  );

  // Rising above the G circle and on above the staff
  ctx.bezierCurveTo(
    cx + s * 0.00, cy - s * 1.42,
    cx + s * 0.00, cy - s * 2.08,
    cx + s * 0.04, cy - s * 2.55,
  );

  // Top hook (small leftward flourish)
  ctx.bezierCurveTo(
    cx + s * 0.10, cy - s * 2.80,
    cx - s * 0.20, cy - s * 2.98,
    cx - s * 0.09, cy - s * 2.70,
  );

  ctx.stroke();

  // ── Layer 2: G-ring drawn over the stem ───────────────────────────────────
  // Centered exactly on the stem (cx, cy) so the stem threads through it.
  // Radius: ~0.50 s (circle spans one full staff space diameter).
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.50, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

// ── Bass Clef ─────────────────────────────────────────────────────────────────

/**
 * F clef (bass clef) — a broad backward-C stroke with two filled dots.
 *
 * The C body sweeps well to the left of cx and spans ~3 s vertically.
 * The two dots straddle the F3 defining line to the right of the mouth.
 *
 * cy = F3 line.
 */
export function drawBassClef(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  s: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  // Main backward-C body — opens to the right, sweeps wide left
  ctx.lineWidth = s * 0.14;
  ctx.beginPath();
  // Start: upper-right notch (where the F line defines the opening)
  ctx.moveTo(cx + s * 0.72, cy - s * 0.50);
  ctx.bezierCurveTo(
    cx + s * 0.18, cy - s * 1.50,   // sweep up and left
    cx - s * 0.92, cy - s * 1.25,   // top-left of the C arc
    cx - s * 0.96, cy - s * 0.05,   // far-left midpoint
  );
  ctx.bezierCurveTo(
    cx - s * 0.92, cy + s * 1.00,   // bottom-left of the C arc
    cx - s * 0.05, cy + s * 1.55,   // sweeping back right
    cx + s * 0.72, cy + s * 0.72,   // lower-right notch
  );
  ctx.stroke();

  // Two dots straddling the F line (to the right of the mouth)
  const dotR = s * 0.15;
  const dotX = cx + s * 1.12;
  ctx.beginPath();
  ctx.arc(dotX, cy - s * 0.38, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(dotX, cy + s * 0.38, dotR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── Staff lines ───────────────────────────────────────────────────────────────

/**
 * Draw a single 5-line staff between x1 and x2.
 * baseY = y of the bottom staff line; lines extend upward at intervals of s.
 */
export function drawStaff(
  ctx: CanvasRenderingContext2D,
  x1: number, x2: number,
  baseY: number,
  s: number,
  color: string,
  lineWidth = 0.7,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = lineWidth;
  for (let i = 0; i < 5; i++) {
    const y = baseY - i * s;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  }
  ctx.restore();
}
