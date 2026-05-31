import * as admin from "firebase-admin";
import {
  Change,
  DocumentSnapshot,
  FirestoreEvent,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

// Aggregates VidyaStar contest scores into vidyastarBoard collection
// Triggered whenever a contest participant doc is written
export const onContestParticipantWrite = onDocumentWritten(
  { document: "contests/{contestId}/participant/{userId}" },
  async (
    event: FirestoreEvent<Change<DocumentSnapshot> | undefined>
  ): Promise<null> => {
    const change = event.data;
    if (!change) return null;

    const after = change.after.exists ? change.after.data() : null;

    // Only aggregate when quiz is completed
    if (!after?.completed) return null;

    const { contestId, userId } = event.params as { contestId: string; userId: string };
    const db = admin.firestore();

    try {
      // Get contest doc to find periodKey
      const contestSnap = await db.collection("contests").doc(contestId).get();
      if (!contestSnap.exists) return null;

      const periodKey = contestSnap.data()?.periodKey as string | undefined;
      if (!periodKey) return null;

      // Fetch student metadata for display
      let name = "";
      let profilePic = "";
      let school = "";
      let cls = "";
      try {
        const studentSnap = await db.collection("students").doc(userId).get();
        if (studentSnap.exists) {
          const s = studentSnap.data()!;
          name       = s.name       ?? "";
          profilePic = s.profilePic ?? "";
          school     = s.school     ?? "";
          cls        = s.class !== undefined ? String(s.class) : "";
        }
      } catch (e) {
        console.warn("vidyastarBoard: failed to get student meta:", e);
      }

      // Find all contests with the same periodKey
      const contestsSnap = await db.collection("contests")
        .where("periodKey", "==", periodKey)
        .get();

      // Sum scores from all completed contests in this period for this user
      let totalScore    = 0;
      let contestCount  = 0;

      await Promise.all(
        contestsSnap.docs.map(async (cDoc) => {
          try {
            const pSnap = await db
              .collection("contests").doc(cDoc.id)
              .collection("participant").doc(userId)
              .get();
            if (pSnap.exists && pSnap.data()?.completed) {
              totalScore   += pSnap.data()?.score ?? 0;
              contestCount += 1;
            }
          } catch (e) {
            console.warn(`vidyastarBoard: failed to read participant ${cDoc.id}:`, e);
          }
        })
      );

      // Write aggregated entry to vidyastarBoard
      const boardDocId = `${userId}_${periodKey}`;
      await db.collection("vidyastarBoard").doc(boardDocId).set({
        userId,
        name,
        profilePic,
        school,
        class: cls,
        period: periodKey,
        totalScore,
        contestCount,
        rank: 0, // recalculated below
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Recalculate ranks for everyone in this period
      await recalculateVidyastarRanks(periodKey, db);
    } catch (e) {
      console.error("onContestParticipantWrite error:", e);
    }

    return null;
  }
);

async function recalculateVidyastarRanks(
  periodKey: string,
  db: admin.firestore.Firestore
): Promise<void> {
  try {
    const snap = await db.collection("vidyastarBoard")
      .where("period", "==", periodKey)
      .orderBy("totalScore", "desc")
      .limit(500)
      .get();

    if (snap.empty) return;

    const batch = db.batch();
    snap.docs.forEach((d, i) => {
      batch.update(d.ref, { rank: i + 1 });
    });
    await batch.commit();

    console.log(`✅ VidyaStar ranks updated: period=${periodKey}, count=${snap.size}`);
  } catch (e) {
    console.error(`recalculateVidyastarRanks(${periodKey}) error:`, e);
  }
}
