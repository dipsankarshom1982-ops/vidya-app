/**
 * admin-web/src/pages/ShortReels.tsx
 *
 * FIXES vs previous version:
 *   1. Upload uses two-step approach:
 *        Step A — call worker /create-upload-url → get uploadURL + uid + playbackUrl
 *        Step B — PUT the raw video file directly to uploadURL (Cloudflare TUS endpoint)
 *      This is the same flow the mobile app uses and is guaranteed to work.
 *
 *   2. Firestore stores BOTH:
 *        mediaUrl  = full HLS URL  (customer-{code}.cloudflarestream.com/{uid}/manifest/...)
 *        cfVideoId = raw UID       (fallback — reels.tsx can always rebuild the URL)
 *
 *   3. Real upload progress via XMLHttpRequest.upload.onprogress.
 *
 *   4. Debug overlay shows exact error from worker so you can diagnose quickly.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { db } from "../lib/firebase";

// ── Constants ──────────────────────────────────────────────────────────────
const WORKER_URL      = (import.meta.env.VITE_CF_WORKER_URL ?? "").replace(/\/$/, "");
const CF_CUSTOMER_CODE = "cif09s9962jkfc36";   // same as lib/cloudflareStream.ts

function cfPlaybackUrl(uid: string) {
  return `https://customer-${CF_CUSTOMER_CODE}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
}
function cfThumbnailUrl(uid: string) {
  return `https://customer-${CF_CUSTOMER_CODE}.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg?time=1s`;
}

const CATEGORIES = [
  "Motivation", "Study Tips", "Science Facts", "Math Tricks",
  "Current Affairs", "Career Guidance", "Life Skills",
  "Exam Hacks", "Fun Learning", "History", "Geography", "General",
];

const CLASS_OPTIONS    = ["All","5","6","7","8","9","10","11","12"];
const LANGUAGE_OPTIONS = ["All","Hindi","English","Bengali","Assamese","Odia","Telugu","Tamil","Kannada","Malayalam","Marathi","Gujarati"];
const STATE_OPTIONS    = ["All","Assam","Bihar","Delhi","Gujarat","Jharkhand","Karnataka","Kerala","Madhya Pradesh","Maharashtra","Nagaland","Odisha","Rajasthan","Tamil Nadu","Telangana","Uttar Pradesh","West Bengal"];
const INTEREST_OPTIONS = ["All","Mathematics","Science","History","Geography","English","Coding","Arts","Sports","Career","Exam Prep","General Knowledge"];

// ── Types ──────────────────────────────────────────────────────────────────
interface ShortReel {
  id: string;
  title: string;
  description: string;
  category: string;
  targetClass: string[];
  targetLanguage: string[];
  targetState: string[];
  targetInterest: string[];
  mediaUrl: string;
  cfVideoId: string;
  thumbnail: string;
  featured: boolean;
  status: "active" | "archived";
  views: number;
  likes: number;
  createdAt?: any;
}

interface FormState {
  title: string;
  description: string;
  category: string;
  targetClass: string[];
  targetLanguage: string[];
  targetState: string[];
  targetInterest: string[];
  featured: boolean;
}

type UploadPhase =
  | "idle"
  | "requesting_url"
  | "uploading_video"
  | "uploading_thumb"
  | "saving"
  | "done";

const emptyForm = (): FormState => ({
  title: "",
  description: "",
  category: "Motivation",
  targetClass: ["All"],
  targetLanguage: ["All"],
  targetState: ["All"],
  targetInterest: ["All"],
  featured: false,
});

// ── Cloudflare upload (two-step, same as mobile app) ───────────────────────
/**
 * Step 1 — ask worker for a direct-upload URL
 * Worker endpoint: POST /create-upload-url
 * Returns: { uploadURL, uid, playbackUrl, thumbnailUrl }
 */
async function getUploadUrl(title: string): Promise<{
  uploadURL: string;
  uid: string;
  playbackUrl: string;
  thumbnailUrl: string;
}> {
  if (!WORKER_URL) throw new Error("VITE_CF_WORKER_URL is not set in admin-web/.env");

  const res = await fetch(`${WORKER_URL}/create-upload-url`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ title }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Worker /create-upload-url failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.uploadURL || !data.uid) {
    throw new Error(`Worker response missing uploadURL or uid: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    uploadURL:    data.uploadURL,
    uid:          data.uid,
    playbackUrl:  data.playbackUrl  ?? cfPlaybackUrl(data.uid),
    thumbnailUrl: data.thumbnailUrl ?? cfThumbnailUrl(data.uid),
  };
}

/**
 * Step 2 — PUT video file directly to Cloudflare's direct-upload URL
 * This is a Cloudflare TUS-style endpoint that accepts raw video binary.
 */
async function uploadFileToCF(
  uploadURL: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        // 5–95% during upload; first 5% reserved for URL fetch
        onProgress(5 + Math.round((e.loaded / e.total) * 90));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(
          `Cloudflare direct upload failed (HTTP ${xhr.status}): ${xhr.responseText?.slice(0, 300)}`
        ));
      }
    };

    xhr.onerror   = () => reject(new Error("Network error during video upload to Cloudflare"));
    xhr.ontimeout = () => reject(new Error("Video upload timed out"));
    xhr.timeout   = 10 * 60 * 1000; // 10 min for large files

    xhr.open("POST", uploadURL);
    // Cloudflare direct upload expects multipart form data
    const form = new FormData();
    form.append("file", file, "reel.mp4");
    xhr.send(form);
  });
}

// ── Multi-select chips ─────────────────────────────────────────────────────
function MultiChips({
  label, options, value, onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (opt: string) => {
    if (opt === "All") { onChange(["All"]); return; }
    const without = value.filter((v) => v !== "All");
    if (without.includes(opt)) {
      const next = without.filter((v) => v !== opt);
      onChange(next.length === 0 ? ["All"] : next);
    } else {
      onChange([...without, opt]);
    }
  };
  return (
    <div>
      <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              value.includes(opt)
                ? "bg-indigo-600 border-indigo-600 text-white"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-500"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Upload Modal ───────────────────────────────────────────────────────────
function ReelModal({
  editReel, onClose, onSaved,
}: {
  editReel: ShortReel | null;
  onClose: () => void;
  onSaved: (reel: ShortReel) => void;
}) {
  const isEdit = !!editReel;

  const [form, setForm] = useState<FormState>(
    isEdit
      ? {
          title:          editReel.title,
          description:    editReel.description,
          category:       editReel.category,
          targetClass:    editReel.targetClass    ?? ["All"],
          targetLanguage: editReel.targetLanguage ?? ["All"],
          targetState:    editReel.targetState    ?? ["All"],
          targetInterest: editReel.targetInterest ?? ["All"],
          featured:       editReel.featured       ?? false,
        }
      : emptyForm()
  );

  const [videoFile,    setVideoFile]    = useState<File | null>(null);
  const [thumbFile,    setThumbFile]    = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(editReel?.thumbnail ?? null);

  const [phase,    setPhase]    = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  const isBusy = phase !== "idle" && phase !== "done";

  const log = (msg: string) => {
    console.log("[ShortReels]", msg);
    setDebugLog((prev) => [...prev.slice(-4), msg]);
  };

  const phaseLabel: Record<UploadPhase, string> = {
    idle:           "",
    requesting_url: "Getting upload URL from Cloudflare…",
    uploading_video:`Uploading video… ${progress}%`,
    uploading_thumb:"Uploading thumbnail…",
    saving:         "Saving to Firestore…",
    done:           "✅ Published!",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim())    { setError("Title is required."); return; }
    if (!isEdit && !videoFile) { setError("Please select a video file."); return; }
    setError(null);
    setDebugLog([]);

    try {
      let mediaUrl  = editReel?.mediaUrl  ?? "";
      let cfVideoId = editReel?.cfVideoId ?? "";
      let thumbnail = editReel?.thumbnail ?? "";

      // ── Step 1: Upload video ──────────────────────────────────
      if (videoFile) {
        // 1a — Get Cloudflare direct-upload URL from our worker
        setPhase("requesting_url");
        setProgress(0);
        log(`Requesting upload URL from ${WORKER_URL}/create-upload-url`);

        const { uploadURL, uid, playbackUrl, thumbnailUrl } = await getUploadUrl(form.title);
        cfVideoId = uid;
        mediaUrl  = playbackUrl;
        thumbnail = thumbnailUrl;
        log(`Got uid=${uid}, uploadURL=${uploadURL.slice(0, 60)}…`);

        // 1b — Upload file directly to Cloudflare's endpoint
        setPhase("uploading_video");
        setProgress(5);
        log(`Uploading ${(videoFile.size / 1024 / 1024).toFixed(1)} MB to Cloudflare…`);

        await uploadFileToCF(uploadURL, videoFile, (pct) => {
          setProgress(pct);
        });
        log(`Upload complete. uid=${uid}`);
      }

      // ── Step 2: Upload custom thumbnail (optional) ────────────
      if (thumbFile) {
        setPhase("uploading_thumb");
        log("Uploading thumbnail to Firebase Storage…");
        const storage  = getStorage();
        const thumbRef = storageRef(storage, `short_reel_thumbnails/${Date.now()}_thumb.jpg`);
        await new Promise<void>((resolve, reject) => {
          const task = uploadBytesResumable(thumbRef, thumbFile, { contentType: "image/jpeg" });
          task.on("state_changed", undefined, reject, async () => {
            try { thumbnail = await getDownloadURL(task.snapshot.ref); } catch (_) {}
            resolve();
          });
        });
        log("Thumbnail uploaded.");
      }

      // ── Step 3: Save to Firestore ─────────────────────────────
      setPhase("saving");
      log("Saving to Firestore short_reels…");

      const payload: Omit<ShortReel, "id" | "views" | "likes" | "createdAt"> = {
        title:          form.title.trim(),
        description:    form.description.trim(),
        category:       form.category,
        targetClass:    form.targetClass,
        targetLanguage: form.targetLanguage,
        targetState:    form.targetState,
        targetInterest: form.targetInterest,
        featured:       form.featured,
        status:         "active",
        mediaUrl,       // full HLS URL — used by mobile reels.tsx
        cfVideoId,      // raw UID — fallback for URL reconstruction
        thumbnail,
      };

      if (isEdit) {
        await updateDoc(doc(db, "short_reels", editReel.id), payload);
        onSaved({ ...editReel, ...payload });
        log("Updated existing reel.");
      } else {
        const docRef = await addDoc(collection(db, "short_reels"), {
          ...payload,
          views:         0,
          likes:         0,
          watchTime:     0,
          uploadedBy:    "admin",
          uploadedByUid: "",
          createdAt:     serverTimestamp(),
        });
        onSaved({ id: docRef.id, ...payload, views: 0, likes: 0 } as ShortReel);
        log(`Created doc id=${docRef.id}`);
      }

      setPhase("done");
      setTimeout(() => { onClose(); }, 1200);
    } catch (err: any) {
      console.error("[ShortReels] upload error:", err);
      setError(err?.message ?? "Upload failed. Check the console.");
      setPhase("idle");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 z-10 px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white">
              {isEdit ? "✏️ Edit Short Reel" : "🎬 Upload Short Reel"}
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Visible to students in Reels → Shorts tab on the mobile app
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="text-slate-400 hover:text-white text-2xl font-bold leading-none disabled:opacity-40"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">

          {/* Worker URL warning */}
          {!WORKER_URL && (
            <div className="bg-red-950/60 border border-red-600 rounded-xl p-3">
              <p className="text-red-400 text-sm font-bold">
                ⚠️ VITE_CF_WORKER_URL is not set in admin-web/.env
              </p>
              <p className="text-red-400/70 text-xs mt-1">
                Add: VITE_CF_WORKER_URL=https://vidya-stream.dipsankarshom1982.workers.dev
              </p>
            </div>
          )}

          {/* Video picker (create only) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
                Video File <span className="text-red-400">*</span>
              </label>
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  videoFile ? "border-indigo-500 bg-indigo-950/20" : "border-slate-700 hover:border-indigo-600"
                }`}
                onClick={() => videoInputRef.current?.click()}
              >
                {videoFile ? (
                  <>
                    {videoPreview && (
                      <video src={videoPreview} className="mx-auto h-32 rounded-lg mb-2" muted playsInline />
                    )}
                    <p className="text-indigo-400 font-semibold text-sm">{videoFile.name}</p>
                    <p className="text-slate-500 text-xs mt-1">{(videoFile.size / 1024 / 1024).toFixed(1)} MB · Click to change</p>
                  </>
                ) : (
                  <>
                    <p className="text-4xl mb-2">🎬</p>
                    <p className="text-slate-300 font-semibold">Click to select video</p>
                    <p className="text-slate-500 text-xs mt-1">MP4 / MOV · max 2 minutes recommended</p>
                  </>
                )}
              </div>
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setVideoFile(f);
                  if (f) setVideoPreview(URL.createObjectURL(f));
                }}
              />
            </div>
          )}

          {/* Thumbnail picker */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
              Custom Thumbnail <span className="text-slate-500 font-normal">(optional — CF auto-generates one)</span>
            </label>
            <div
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                thumbPreview ? "border-indigo-500 bg-indigo-950/20" : "border-slate-700 hover:border-indigo-600"
              }`}
              onClick={() => thumbInputRef.current?.click()}
            >
              {thumbPreview ? (
                <img src={thumbPreview} alt="thumb" className="mx-auto h-24 object-cover rounded-lg" />
              ) : (
                <p className="text-slate-400 text-sm py-2">Click to upload thumbnail image</p>
              )}
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setThumbFile(f);
                if (f) setThumbPreview(URL.createObjectURL(f));
              }}
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
              Title <span className="text-red-400">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              maxLength={80}
              placeholder="e.g. 5 Study Tips for Board Exams"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={300}
              rows={3}
              placeholder="What is this reel about?"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Category</label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, category: cat }))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    form.category === cat
                      ? "bg-indigo-600 border-indigo-600 text-white"
                      : "bg-slate-800 border-slate-700 text-slate-300 hover:border-indigo-500"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Targeting */}
          <div className="space-y-4 bg-slate-800/50 rounded-xl p-4 border border-slate-700">
            <p className="text-xs font-black text-slate-300 uppercase tracking-widest">
              🎯 Targeting — who should see this?
            </p>
            <MultiChips label="Class"    options={CLASS_OPTIONS}    value={form.targetClass}    onChange={(v) => setForm((f) => ({ ...f, targetClass: v }))} />
            <MultiChips label="Language" options={LANGUAGE_OPTIONS} value={form.targetLanguage} onChange={(v) => setForm((f) => ({ ...f, targetLanguage: v }))} />
            <MultiChips label="State"    options={STATE_OPTIONS}    value={form.targetState}    onChange={(v) => setForm((f) => ({ ...f, targetState: v }))} />
            <MultiChips label="Interest" options={INTEREST_OPTIONS} value={form.targetInterest} onChange={(v) => setForm((f) => ({ ...f, targetInterest: v }))} />
          </div>

          {/* Featured toggle */}
          <div className="flex items-center justify-between bg-slate-800 rounded-xl px-4 py-3 border border-slate-700">
            <div>
              <p className="text-white font-semibold text-sm">⭐ Feature on Home Page</p>
              <p className="text-slate-400 text-xs mt-0.5">Shows in the Shorts preview strip on the student home screen</p>
            </div>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, featured: !f.featured }))}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                form.featured ? "bg-indigo-600" : "bg-slate-600"
              }`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                form.featured ? "translate-x-7" : "translate-x-1"
              }`} />
            </button>
          </div>

          {/* Progress */}
          {isBusy && (
            <div className="bg-slate-800 rounded-xl p-4 space-y-2">
              <p className="text-indigo-400 text-sm font-semibold animate-pulse">{phaseLabel[phase]}</p>
              {phase === "uploading_video" && (
                <div className="bg-slate-700 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
              {/* Debug log */}
              {debugLog.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {debugLog.map((msg, i) => (
                    <p key={i} className="text-slate-500 text-[11px] font-mono truncate">› {msg}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {phase === "done" && (
            <div className="bg-green-950/50 border border-green-700 rounded-xl p-3 text-center">
              <p className="text-green-400 font-bold text-sm">✅ Reel published successfully!</p>
            </div>
          )}

          {error && (
            <div className="bg-red-950/50 border border-red-700 rounded-xl p-4">
              <p className="text-red-400 text-sm font-semibold mb-1">Upload failed</p>
              <p className="text-red-400/80 text-xs font-mono break-all">{error}</p>
              <p className="text-slate-500 text-xs mt-2">Check browser console for full details.</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isBusy || phase === "done" || (!isEdit && !videoFile)}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {isBusy
                ? <span className="animate-spin text-lg">⟳</span>
                : isEdit ? "💾 Save Changes" : "🚀 Publish Reel"
              }
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function ShortReels() {
  const [reels,     setReels]     = useState<ShortReel[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editReel,  setEditReel]  = useState<ShortReel | null>(null);
  const [filter,    setFilter]    = useState<"active" | "archived" | "all">("active");

  const fetchReels = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, "short_reels"), orderBy("createdAt", "desc")));
      setReels(
        snap.docs
          .filter((d) => !d.data()._isSchema)
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ShortReel, "id">) }))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReels(); }, []);

  const handleArchive = async (reel: ShortReel) => {
    const next = reel.status === "active" ? "archived" : "active";
    await updateDoc(doc(db, "short_reels", reel.id), { status: next });
    setReels((prev) => prev.map((r) => r.id === reel.id ? { ...r, status: next } : r));
  };

  const handleDelete = async (reel: ShortReel) => {
    if (!window.confirm(`Delete "${reel.title}"? This cannot be undone.`)) return;
    await deleteDoc(doc(db, "short_reels", reel.id));
    setReels((prev) => prev.filter((r) => r.id !== reel.id));
  };

  const handleToggleFeatured = async (reel: ShortReel) => {
    await updateDoc(doc(db, "short_reels", reel.id), { featured: !reel.featured });
    setReels((prev) => prev.map((r) => r.id === reel.id ? { ...r, featured: !r.featured } : r));
  };

  const onSaved = (reel: ShortReel) => {
    setReels((prev) => {
      const idx = prev.findIndex((r) => r.id === reel.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = reel; return next; }
      return [reel, ...prev];
    });
    setTimeout(() => { setShowModal(false); setEditReel(null); }, 1200);
  };

  const filtered      = filter === "all" ? reels : reels.filter((r) => r.status === filter);
  const activeCount   = reels.filter((r) => r.status === "active").length;
  const featuredCount = reels.filter((r) => r.featured && r.status === "active").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">🎬 Short Reels</h1>
          <p className="text-slate-400 text-sm mt-1">
            Admin-curated reels shown to students based on class, language, location &amp; interest
          </p>
        </div>
        <button
          onClick={() => { setEditReel(null); setShowModal(true); }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 shrink-0"
        >
          ＋ Upload Reel
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Reels",     value: reels.length,   color: "text-white"     },
          { label: "Active",          value: activeCount,    color: "text-green-400" },
          { label: "Featured (Home)", value: featuredCount,  color: "text-yellow-400"},
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <p className="text-slate-400 text-xs">{label}</p>
            <p className={`text-3xl font-black mt-1 ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Worker URL status */}
      <div className={`rounded-xl px-4 py-2.5 border text-sm flex items-center gap-2 ${
        WORKER_URL
          ? "bg-green-950/30 border-green-800/50 text-green-400"
          : "bg-red-950/30 border-red-800/50 text-red-400"
      }`}>
        {WORKER_URL ? "✅" : "❌"}
        <span className="font-mono text-xs truncate">
          {WORKER_URL || "VITE_CF_WORKER_URL not set — uploads will fail"}
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["active", "archived", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors capitalize ${
              filter === f ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            {f === "active" ? "✅ Active" : f === "archived" ? "📦 Archived" : "🗂 All"}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center text-slate-400 py-20">Loading reels…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-5xl mb-3">🎬</p>
          <p className="text-slate-400 font-semibold text-lg">No {filter === "all" ? "" : filter} reels yet</p>
          <p className="text-slate-600 text-sm mt-1">Click "Upload Reel" to add the first one</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <AnimatePresence>
            {filtered.map((reel, i) => (
              <motion.div
                key={reel.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.04 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-600 transition-colors"
              >
                <div className="relative h-40 bg-slate-800 flex items-center justify-center overflow-hidden">
                  {reel.thumbnail ? (
                    <img src={reel.thumbnail} alt={reel.title} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-5xl text-slate-600">🎬</span>
                  )}
                  {reel.featured && (
                    <span className="absolute top-2 left-2 bg-yellow-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full">
                      ⭐ HOME
                    </span>
                  )}
                  <span className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    reel.status === "active"
                      ? "bg-green-600/80 text-white"
                      : "bg-slate-600/80 text-slate-300"
                  }`}>
                    {reel.status}
                  </span>
                  {/* CF video ID badge */}
                  {reel.cfVideoId && (
                    <span className="absolute bottom-2 left-2 bg-black/60 text-slate-400 text-[9px] font-mono px-1.5 py-0.5 rounded">
                      {reel.cfVideoId.slice(0, 8)}…
                    </span>
                  )}
                </div>

                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-indigo-900/50 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
                      {reel.category}
                    </span>
                    <span className="text-slate-500 text-[10px]">
                      Class: {reel.targetClass?.join(", ") ?? "All"}
                    </span>
                  </div>

                  <p className="text-white font-bold text-sm line-clamp-2">{reel.title}</p>

                  <div className="text-[10px] text-slate-500 space-y-0.5">
                    {reel.targetLanguage?.[0] !== "All" && (
                      <p>🗣 {reel.targetLanguage.slice(0, 3).join(", ")}{reel.targetLanguage.length > 3 ? "…" : ""}</p>
                    )}
                    {reel.targetState?.[0] !== "All" && (
                      <p>📍 {reel.targetState.slice(0, 2).join(", ")}{reel.targetState.length > 2 ? "…" : ""}</p>
                    )}
                  </div>

                  <div className="flex gap-3 text-[11px] text-slate-500">
                    <span>👁 {reel.views ?? 0}</span>
                    <span>❤️ {reel.likes ?? 0}</span>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      title="Toggle featured on home"
                      onClick={() => handleToggleFeatured(reel)}
                      className={`flex-1 text-xs py-1.5 rounded-lg font-semibold transition-colors ${
                        reel.featured
                          ? "bg-yellow-600/30 text-yellow-400 hover:bg-yellow-600/50"
                          : "bg-slate-800 text-slate-400 hover:text-yellow-400"
                      }`}
                    >
                      ⭐
                    </button>
                    <button
                      onClick={() => { setEditReel(reel); setShowModal(true); }}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-1.5 rounded-lg font-semibold transition-colors"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleArchive(reel)}
                      className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs py-1.5 rounded-lg font-semibold transition-colors"
                    >
                      {reel.status === "active" ? "📦" : "♻️"}
                    </button>
                    <button
                      onClick={() => handleDelete(reel)}
                      className="bg-red-950/50 hover:bg-red-900/60 text-red-400 text-xs py-1.5 px-2 rounded-lg transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {showModal && (
          <ReelModal
            editReel={editReel}
            onClose={() => { setShowModal(false); setEditReel(null); }}
            onSaved={onSaved}
          />
        )}
      </AnimatePresence>
    </div>
  );
}