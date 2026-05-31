/**
 * scripts/initShortReels.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Creates the short_reels collection in Firestore with:
 *   1. A _schema placeholder doc (makes collection visible in Firebase Console)
 *   2. One sample "Welcome" reel so the collection is never empty on first load
 *
 * Run once after deployment:
 *   npx ts-node scripts/initShortReels.ts
 *
 * Safe to re-run — skips if collection already has docs.
 */

import * as admin from "firebase-admin";
import * as fs    from "fs";
import * as path  from "path";

try { require("dotenv").config({ path: path.resolve(__dirname, "../.env") }); } catch {}

if (!admin.apps.length) {
  const svcPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ??
    path.resolve(__dirname, "../serviceAccount.json");

  fs.existsSync(svcPath)
    ? admin.initializeApp({ credential: admin.credential.cert(svcPath) })
    : admin.initializeApp();
}

const db  = admin.firestore();
const NOW = admin.firestore.FieldValue.serverTimestamp();

// ── Firestore indexes needed for short_reels ──────────────────────────────
// These are created via firestore.indexes.json but listed here for reference:
//
//   { status ASC, featured DESC, createdAt DESC }  → personalised feed
//   { status ASC, createdAt DESC }                 → home preview strip
//
// Run: firebase deploy --only firestore:indexes

async function initShortReels() {
  console.log("\n🎬 Initializing short_reels collection…\n");

  const col  = db.collection("short_reels");
  const snap = await col.limit(1).get();

  if (!snap.empty) {
    console.log("⏭  short_reels already exists — skipped.");
    console.log("   (delete existing docs and re-run if you want a fresh seed)\n");
    return;
  }

  const batch = db.batch();

  // ── Doc 1: _schema ── tells every developer exactly what a doc looks like ─
  batch.set(col.doc("_schema"), {
    _isSchema:      true,
    _doc:           "Admin-uploaded short reels. Students watch in Reels → Shorts tab.",

    // Content
    title:          "string — reel title shown in player overlay",
    description:    "string — optional subtitle shown below title",
    category:       "string — one of: Motivation | Study Tips | Science Facts | Math Tricks | Current Affairs | Career Guidance | Life Skills | Exam Hacks | Fun Learning | History | Geography | General",

    // Media
    mediaUrl:       "string — Cloudflare Stream HLS .m3u8 URL",
    thumbnail:      "string — Firebase Storage or Cloudflare thumbnail URL",

    // Targeting (personalisation) — use 'All' to target everyone
    targetClass:    "string[] — ['All'] or ['8','9','10','11','12']",
    targetLanguage: "string[] — ['All'] or ['Hindi','Bengali','Assamese',…]",
    targetState:    "string[] — ['All'] or ['Assam','Delhi','Bihar',…]",
    targetInterest: "string[] — ['All'] or ['Mathematics','Science','Coding',…]",

    // Visibility
    featured:       "boolean — true = appears in home page Shorts preview strip",
    status:         "string — 'active' | 'archived'",

    // Author
    uploadedBy:     "string — always 'admin' for this collection",
    uploadedByUid:  "string — Firebase Auth UID of the admin who uploaded",

    // Engagement (incremented by Cloud Functions / mobile app)
    views:          "number — total views",
    likes:          "number — total likes",
    watchTime:      "number — cumulative seconds watched",

    createdAt:      NOW,
  });

  // ── Doc 2: sample welcome reel ──────────────────────────────────────────
  batch.set(col.doc("sample_welcome"), {
    title:          "Welcome to Vidya AI Shorts! 🎬",
    description:    "Admin-curated reels for every student in India",
    category:       "Motivation",
    mediaUrl:       "",          // replace with real Cloudflare Stream URL
    thumbnail:      "",          // replace with real thumbnail URL
    targetClass:    ["All"],
    targetLanguage: ["All"],
    targetState:    ["All"],
    targetInterest: ["All"],
    featured:       true,        // show on home page preview strip
    status:         "active",
    uploadedBy:     "admin",
    uploadedByUid:  "",
    views:          0,
    likes:          0,
    watchTime:      0,
    _isSample:      true,        // delete this after uploading real reels
    createdAt:      NOW,
  });

  await batch.commit();

  console.log("✅ short_reels/_schema        — field-reference doc created");
  console.log("✅ short_reels/sample_welcome — placeholder reel created");
  console.log("\n📌 Next steps:");
  console.log("   1. Open Firebase Console → Firestore → short_reels");
  console.log("   2. Delete 'sample_welcome' after uploading real reels from admin panel");
  console.log("   3. Deploy Firestore rules:   firebase deploy --only firestore:rules");
  console.log("   4. Deploy indexes:           firebase deploy --only firestore:indexes\n");
}

initShortReels().catch((err) => {
  console.error("\n❌ Failed:", err);
  process.exit(1);
});
