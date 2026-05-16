import * as admin from "firebase-admin";
import {
  Change,
  DocumentSnapshot,
  FirestoreEvent,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

admin.initializeApp();
const db = admin.firestore();

// ───────────────────────────────────────────────────────────
// TYPES
// ───────────────────────────────────────────────────────────

interface PostData {
  userId?: string;
  name?: string;
  profilePic?: string;
  school?: string;
  class?: string | number;
  postType?: string;
  isSkillBattle?: boolean;
  battleId?: string;
  month?: string;
  likes?: number;
  views?: number;
  watchTime?: number;
  shares?: number;
  comments?: number;
  location?: {
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
}

interface StudentData {
  location?: {
    city?: string;
    district?: string;
    state?: string;
    pincode?: string;
  };
}

interface RanksMap {
  local: number;
  district: number;
  state: number;
  india: number;
}

interface SkillboardDoc {
  userId: string;
  name: string;
  profilePic: string;
  school: string;
  class: string;
  location: {
    city: string;
    district: string;
    state: string;
    pincode: string;
    country: string;
  };
  month: string;
  totalLikes: number;
  totalViews: number;
  totalWatchtime: number;
  totalShares: number;
  totalComments: number;
  totalScore: number;
  ranks: RanksMap;
  updatedAt: admin.firestore.FieldValue;
}

// ───────────────────────────────────────────────────────────
// FUNCTION 1: updateSkillboard
// Triggers on any post write — updates skillboard + ranks
// ───────────────────────────────────────────────────────────

export const updateSkillboard = onDocumentWritten(
  "posts/{postId}",
  async (
    event: FirestoreEvent<Change<DocumentSnapshot> | undefined>
  ): Promise<null> => {
    const change = event.data;
    if (!change) return null;

    const after = change.after.exists
      ? (change.after.data() as PostData)
      : null;

    // Only process skill battle reels
    if (!after || after.postType !== "reel" || !after.isSkillBattle) {
      return null;
    }

    const userId = after.userId;
    const month  = after.month;
    const cls    = after.class !== undefined ? String(after.class) : "";

    if (!userId || !month || !cls) {
      console.warn("⚠️ Missing userId, month or class — skipping");
      return null;
    }

    // ── Get location from post ────────────────────────────
    let city     = after.location?.city     ?? "";
    let district = after.location?.district ?? "";
    let state    = after.location?.state    ?? "";
    let pincode  = after.location?.pincode  ?? "";

    // ── Fallback: fetch location from students collection ─
    // This runs when post location fields are empty
    if (!district || !state || !pincode) {
      try {
        const studentSnap = await db
          .collection("students")
          .doc(userId)
          .get();

        if (studentSnap.exists) {
          const student = studentSnap.data() as StudentData;
          city     = city     || student.location?.city     || "";
          district = district || student.location?.district || "";
          state    = state    || student.location?.state    || "";
          pincode  = pincode  || student.location?.pincode  || "";
          console.log(`📍 Location from students: ${pincode}/${district}/${state}`);
        }
      } catch (err) {
        console.error("❌ Failed to fetch student location:", err);
      }
    }

    // ── Aggregate all qualifying posts for this user+month ─
    const postsSnap = await db
      .collection("posts")
      .where("userId",        "==", userId)
      .where("month",         "==", month)
      .where("postType",      "==", "reel")
      .where("isSkillBattle", "==", true)
      .get();

    let totalLikes     = 0;
    let totalViews     = 0;
    let totalWatchtime = 0;
    let totalShares    = 0;
    let totalComments  = 0;

    postsSnap.forEach((postDoc: admin.firestore.QueryDocumentSnapshot) => {
      const p = postDoc.data() as PostData;
      totalLikes     += p.likes     ?? 0;
      totalViews     += p.views     ?? 0;
      totalWatchtime += p.watchTime ?? 0;
      totalShares    += p.shares    ?? 0;
      totalComments  += p.comments  ?? 0;
    });

    // ── Score formula ─────────────────────────────────────
    // (likes×5) + (comments×3) + (shares×4) + (views×1) + (watchtime×2)
    const totalScore: number =
      totalLikes     * 5 +
      totalComments  * 3 +
      totalShares    * 4 +
      totalViews     * 1 +
      totalWatchtime * 2;

    console.log(
      `📊 Score for ${userId}: ${totalScore} | ` +
      `likes=${totalLikes} comments=${totalComments} ` +
      `shares=${totalShares} views=${totalViews} watchtime=${totalWatchtime}`
    );

    // ── Write skillboard doc ──────────────────────────────
    // Doc ID: userId_class_month  e.g. "XkxPlrf_8_2026-05"
    const skillboardId  = `${userId}_${cls}_${month}`;
    const skillboardRef = db.collection("skillboard").doc(skillboardId);

    const docData: SkillboardDoc = {
      userId,
      name:       after.name       ?? "",
      profilePic: after.profilePic ?? "",
      school:     after.school     ?? "",
      class:      cls,
      location: {
        city,
        district,
        state,
        pincode,
        country: "India",
      },
      month,
      totalLikes,
      totalViews,
      totalWatchtime,
      totalShares,
      totalComments,
      totalScore,
      // ✅ Always initialize ranks to 0 — recalculated below
      ranks: {
        local:    0,
        district: 0,
        state:    0,
        india:    0,
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // ✅ merge: false — ensures ranks map is always freshly written
    // If merge:true, existing ranks from previous run persist even if score dropped
    await skillboardRef.set(docData);

    console.log(`✅ Skillboard doc written: ${skillboardId} | score: ${totalScore}`);

    // ── Recalculate all 4 location-scoped ranks ───────────
    await Promise.all([
      recalculateRank("india",    { class: cls, month }),
      recalculateRank("state",    { class: cls, month, "location.state":    state    }),
      recalculateRank("district", { class: cls, month, "location.district": district }),
      recalculateRank("local",    { class: cls, month, "location.pincode":  pincode  }),
    ]);

    return null;
  }
);

// ───────────────────────────────────────────────────────────
// FUNCTION 2: onPostCreated
// Increments participantCount on skillBattles when new post added
// ───────────────────────────────────────────────────────────

export const onPostCreated = onDocumentWritten(
  "posts/{postId}",
  async (
    event: FirestoreEvent<Change<DocumentSnapshot> | undefined>
  ): Promise<null> => {
    const change = event.data;
    if (!change) return null;

    // Only trigger on CREATE (before didn't exist, after exists)
    const wasCreated = !change.before.exists && change.after.exists;
    if (!wasCreated) return null;

    const post = change.after.data() as PostData;

    // Only count skill battle posts
    if (!post?.battleId || !post?.isSkillBattle) return null;

    try {
      await db
        .collection("skillBattles")
        .doc(post.battleId)
        .update({
          participantCount: admin.firestore.FieldValue.increment(1),
        });

      console.log(`✅ participantCount incremented for battle: ${post.battleId}`);
    } catch (err) {
      console.error("❌ Failed to increment participantCount:", err);
    }

    return null;
  }
);

// ───────────────────────────────────────────────────────────
// HELPER: recalculateRank
// Recalculates rank for one location scope (india/state/district/local)
// ───────────────────────────────────────────────────────────

async function recalculateRank(
  scopeKey: keyof RanksMap,
  filters: Record<string, string>
): Promise<void> {

  // ✅ Skip if scope value is empty string
  // e.g. if pincode is "" — don't rank by empty pincode
  if (scopeKey !== "india") {
    const scopeFieldMap: Record<string, string> = {
      state:    "location.state",
      district: "location.district",
      local:    "location.pincode",
    };
    const scopeField = scopeFieldMap[scopeKey];
    const scopeValue = filters[scopeField] ?? "";

    if (!scopeValue) {
      console.warn(`⚠️ Skipping ${scopeKey} rank — scope value is empty`);
      return;
    }
  }

  try {
    // Build query with all filters
    let q: admin.firestore.Query = db.collection("skillboard");

    for (const [field, value] of Object.entries(filters)) {
      if (value && value.trim() !== "") {
        q = q.where(field, "==", value);
      }
    }

    const snap = await q
      .orderBy("totalScore", "desc")
      .limit(100)
      .get();

    if (snap.empty) {
      console.log(`ℹ️ No docs found for ${scopeKey} rank — skipping batch`);
      return;
    }

    const batch = db.batch();

    snap.docs.forEach(
      (rankDoc: admin.firestore.QueryDocumentSnapshot, index: number) => {
        // ✅ Dot notation update — safe since ranks map always exists (set above)
        batch.update(rankDoc.ref, {
          [`ranks.${scopeKey}`]: index + 1,
        });
      }
    );

    await batch.commit();

    console.log(
      `✅ ${scopeKey} ranks updated for ${snap.size} students ` +
      `(class=${filters.class}, month=${filters.month})`
    );
  } catch (err) {
    console.error(`❌ recalculateRank(${scopeKey}) failed:`, err);
  }
}