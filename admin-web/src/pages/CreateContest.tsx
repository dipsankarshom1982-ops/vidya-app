import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../lib/firebase";
import { motion } from "framer-motion";
import ToggleSwitch from "../components/ToggleSwitch";

const ALL_CLASSES = ["6","7","8","9","10","11","12","all"];
const TYPES = ["quiz","essay","project","skill_battle"];

// Period key helpers
const pad = (n: number) => String(n).padStart(2, "0");
function getWeekNumber(d: Date) {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
}
const buildPeriodKey = (type: string, d = new Date()) => {
  if (type === "daily")   return `daily_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  if (type === "weekly")  return `weekly_${d.getFullYear()}-W${pad(getWeekNumber(d))}`;
  if (type === "monthly") return `monthly_${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  return `yearly_${d.getFullYear()}`;
};

const EMPTY = {
  title: "", description: "", rules: "", contestType: "quiz",
  startDate: "", endDate: "", prizePool: 0, totalSpots: 100,
  targetClass: ["all"] as string[], isActive: false,
  entryFee: 0, periodType: "monthly", periodKey: buildPeriodKey("monthly"),
};

const CLOUD_FUNCTION_URL =
  import.meta.env.VITE_CLOUD_FUNCTION_URL ||
  "https://us-central1-" + import.meta.env.VITE_FIREBASE_PROJECT_ID + ".cloudfunctions.net";

type LessonGenStatus = "idle" | "generating" | "completed" | "failed";

export default function CreateContest() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isEdit = !!id && id !== "new";

  const [form, setForm]       = useState(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(isEdit ? id! : null);

  // Lesson generation state
  const [lessonStatus, setLessonStatus]   = useState<LessonGenStatus>("idle");
  const [lessonGenErr, setLessonGenErr]   = useState<string | null>(null);
  const [bannerMeta, setBannerMeta]       = useState<any>(null);
  const [lessonQuestions, setLessonQuestions] = useState<number | null>(null);
  const [lessonScenes, setLessonScenes]       = useState<number | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    getDoc(doc(db, "contests", id!)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setForm({ ...EMPTY, ...data } as typeof EMPTY);
      if (data.lessonStatus) setLessonStatus(data.lessonStatus as LessonGenStatus);
      if (data.bannerMeta)   setBannerMeta(data.bannerMeta);
      if (data.lessonJson?.quiz)    setLessonQuestions(data.lessonJson.quiz.length);
      if (data.lessonJson?.scenes)  setLessonScenes(data.lessonJson.scenes.length);
    });
  }, [id, isEdit]);

  // Live-listen for lessonStatus changes while generating
  useEffect(() => {
    if (!savedId || lessonStatus !== "generating") return;
    const unsub = onSnapshot(doc(db, "contests", savedId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const st = data.lessonStatus as LessonGenStatus;
      setLessonStatus(st);
      if (st === "completed") {
        setBannerMeta(data.bannerMeta ?? null);
        setLessonQuestions(data.lessonJson?.quiz?.length ?? null);
        setLessonScenes(data.lessonJson?.scenes?.length ?? null);
      }
    });
    return () => unsub();
  }, [savedId, lessonStatus]);

  const set = (field: string, value: unknown) => setForm((p) => ({ ...p, [field]: value }));
  const toggleClass = (c: string) =>
    setForm((p) => ({
      ...p,
      targetClass: p.targetClass.includes(c)
        ? p.targetClass.filter((v) => v !== c)
        : [...p.targetClass, c],
    }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        prizePool:  Number(form.prizePool),
        totalSpots: Number(form.totalSpots),
        entryFee:   Number(form.entryFee),
        updatedAt: serverTimestamp(),
      };
      let newId = savedId;
      if (isEdit) {
        await updateDoc(doc(db, "contests", id!), payload);
        newId = id!;
      } else {
        const ref = await addDoc(collection(db, "contests"), {
          ...payload,
          participantCount: 0,
          joinedCount: 0,
          lessonStatus: "pending",
          createdAt: serverTimestamp(),
        });
        newId = ref.id;
        setSavedId(newId);
      }
      setSuccess(true);
      if (!isEdit) {
        setTimeout(() => navigate(`/contests/${newId}`), 800);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateLesson = async () => {
    if (!savedId) return;
    setLessonStatus("generating");
    setLessonGenErr(null);
    setBannerMeta(null);
    setLessonQuestions(null);
    setLessonScenes(null);
    try {
      const token = await getAuth().currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const resp = await fetch(`${CLOUD_FUNCTION_URL}/generateContestLesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contestId: savedId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Generation failed");
      // status will be updated via the Firestore listener
    } catch (err: any) {
      setLessonStatus("failed");
      setLessonGenErr(err.message ?? "Unknown error");
    }
  };

  const inputCls = "w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors";
  const labelCls = "text-slate-300 text-sm font-semibold block mb-2";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-black text-white">
          {isEdit ? "✏️ Edit Contest" : "🏁 Create Contest"}
        </h1>
      </div>

      {success && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-green-500/15 border border-green-500/30 rounded-xl p-4 text-green-400 font-semibold">
          ✅ Saved!
        </motion.div>
      )}

      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div><label className={labelCls}>Title *</label><input value={form.title} onChange={(e) => set("title", e.target.value)} className={inputCls} required /></div>
        <div><label className={labelCls}>Description <span className="text-indigo-400">(AI uses this to generate the lesson)</span></label><textarea value={form.description} onChange={(e) => set("description", e.target.value)} className={`${inputCls} resize-none h-28`} placeholder="Describe the topic students will learn — e.g. 'Photosynthesis in plants, Class 8 Science'" /></div>
        <div><label className={labelCls}>Rules</label><textarea value={form.rules} onChange={(e) => set("rules", e.target.value)} className={`${inputCls} resize-none h-20`} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Contest Type</label><select value={form.contestType} onChange={(e) => set("contestType", e.target.value)} className={inputCls}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className={labelCls}>Total Spots</label><input type="number" min={1} value={form.totalSpots} onChange={(e) => set("totalSpots", e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className={labelCls}>Start Date</label><input type="datetime-local" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>End Date</label><input type="datetime-local" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} className={inputCls} /></div>
        </div>
        <div><label className={labelCls}>Prize Pool (₹)</label><input type="number" min={0} value={form.prizePool} onChange={(e) => set("prizePool", e.target.value)} className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Entry Fee (₹) — 0 = Free</label>
            <input type="number" min={0} value={form.entryFee} onChange={(e) => set("entryFee", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Period Type <span className="text-slate-500 font-normal">(for VidyaStar leaderboard)</span></label>
            <select value={form.periodType} onChange={(e) => { set("periodType", e.target.value); set("periodKey", buildPeriodKey(e.target.value)); }} className={inputCls}>
              {["daily","weekly","monthly","yearly"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls}>Period Key <span className="text-indigo-400 text-xs">(auto-filled · links to VidyaStar prize config)</span></label>
          <input value={form.periodKey} onChange={(e) => set("periodKey", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Target Class</label>
          <div className="flex flex-wrap gap-2">
            {ALL_CLASSES.map((c) => (
              <button key={c} type="button" onClick={() => toggleClass(c)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${form.targetClass.includes(c) ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>{c}</button>
            ))}
          </div>
        </div>
        <ToggleSwitch value={form.isActive} onChange={(v) => set("isActive", v)} label="Active (visible to students)" />
        <button type="submit" disabled={saving} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors">
          {saving ? "Saving…" : isEdit ? "Update Contest" : "Create Contest"}
        </button>
      </form>

      {/* ── AI Lesson Generation Section ── */}
      {savedId && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div>
            <h2 className="text-white font-black text-lg">🤖 AI Lesson & Banner</h2>
            <p className="text-slate-400 text-sm mt-1">
              Gemini AI will generate an interactive lesson and a banner for this contest based on the description above.
            </p>
          </div>

          {/* Status indicator */}
          {lessonStatus === "idle" && (
            <p className="text-slate-500 text-sm">No lesson generated yet.</p>
          )}
          {lessonStatus === "generating" && (
            <div className="flex items-center gap-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-4">
              <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-indigo-300 font-semibold text-sm">Generating lesson… this takes ~30–60 seconds</p>
            </div>
          )}
          {lessonStatus === "completed" && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 space-y-3">
              <p className="text-green-400 font-bold">✅ Lesson generated!</p>
              {lessonScenes != null && lessonQuestions != null && (
                <p className="text-slate-400 text-sm">{lessonScenes} scenes · {lessonQuestions} quiz questions</p>
              )}
              {bannerMeta && (
                <div
                  className="rounded-xl p-4 flex items-center gap-3"
                  style={{ background: `linear-gradient(135deg, ${bannerMeta.gradientStart ?? "#1a0a2e"}, ${bannerMeta.gradientEnd ?? "#7c3aed"})` }}
                >
                  <span className="text-3xl">{bannerMeta.emoji ?? "🌟"}</span>
                  <div>
                    <p className="text-white font-bold text-sm">{form.title}</p>
                    {bannerMeta.tagline && <p className="text-white/70 text-xs">{bannerMeta.tagline}</p>}
                  </div>
                </div>
              )}
            </div>
          )}
          {lessonStatus === "failed" && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 font-bold">❌ Generation failed</p>
              {lessonGenErr && <p className="text-red-300 text-sm mt-1">{lessonGenErr}</p>}
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateLesson}
            disabled={lessonStatus === "generating" || !form.description.trim()}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
          >
            {lessonStatus === "generating"
              ? "Generating…"
              : lessonStatus === "completed"
                ? "🔄 Regenerate Lesson"
                : "✨ Generate AI Lesson & Banner"}
          </button>
          {!form.description.trim() && (
            <p className="text-amber-400 text-xs text-center">Add a description above before generating the lesson.</p>
          )}
        </div>
      )}
    </div>
  );
}
