/**
 * Sprite bullets (docs/PROJECTILE_ART.md §3, PA4): pure view logic for the client's SpriteBulletPool. Plain numbers
 * only (headless specs).
 *
 *   config.ts   BULLET_ART_VIEW (flicker rate, reduced-motion frame, size quantum, the Top-face canvas turn, anchor
 *               thickness, layers and pool lifts, the flicker write budget) and BULLET_IMPACT_VIEW
 *   looks.ts    ENEMY_BULLET_LOOK_IDS and enemyBulletLookOf (BulletKind -> small / medium / large / needle)
 *   art.ts      bulletFrame (flicker with a per-slot phase), bulletYawAxes / bulletYaw (a floor-flat sprite turned
 *               along the velocity), bulletPartSize, bulletSizeKey, screenHeading (for billboards)
 *   impacts.ts  BulletImpacts: player bullets that vanished with life left (hits), as a fixed-size feed for PA7
 */
export * from "./config";
export * from "./looks";
export * from "./art";
export * from "./impacts";
