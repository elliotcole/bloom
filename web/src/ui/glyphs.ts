// Hand-engraved musical glyphs — Canvas 2D drawing functions.
//
// Shapes extracted from manuscript reference images (the `glyph examples` folder, in git history)
// and parameterised as pure Canvas paths. No music font required.
//
// Anchor conventions
// ──────────────────
//   drawNotehead    cx, cy  = notehead centre
//   drawSharp       cx, cy  = centre of the note's staff position (line or space)
//   drawFlat        cx, cy  = centre of the note's staff position
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
