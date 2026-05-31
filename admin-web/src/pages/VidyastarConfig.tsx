import { useEffect, useState } from "react";
import {
  collection, getDocs, doc, setDoc, serverTimestamp, deleteDoc,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { motion } from "framer-motion";

// ── Period key helpers ────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, "0");

function getWeekNumber(d: Date): number {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
}

function buildPeriodKey(type: PeriodType, offset = 0): string {
  const d = new Date();
  if (type === "daily") {
    d.setDate(d.getDate() - offset);
    return `daily_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (type === "weekly") {
    d.setDate(d.getDate() - offset * 7);
    return `weekly_${d.getFullYear()}-W${pad(getWeekNumber(d))}`;
  }
  if (type === "monthly") {
    d.setMonth(d.getMonth() - offset);
    return `monthly_${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  return `yearly_${d.getFullYear() - offset}`;
}

type PeriodType = "daily" | "weekly" | "monthly" | "yearly";
type PrizeType  = "gift_voucher" | "physical" | "vcoin";

interface PrizeRow {
  rankMin: number; rankMax: number;
  prizeType: PrizeType; prizeValue: string;
  medalEmoji: string; badge: string;
}

interface Config {
  id: string;
  period: PeriodType;
  periodKey: string;
  entryFee: number;
  totalPool: number;
  prizeRows: PrizeRow[];
}

const PERIOD_TYPES: PeriodType[] = ["daily", "weekly", "monthly", "yearly"];
const PRIZE_TYPES: { value: PrizeType; label: string }[] = [
  { value: "gift_voucher", label: "🎁 Gift Voucher (₹)" },
  { value: "physical",     label: "📦 Physical Prize"   },
  { value: "vcoin",        label: "🪙 V-Coins"          },
];
const MEDAL_OPTS = ["🥇", "🥈", "🥉", "🏅", "⭐"];

const EMPTY_ROW: PrizeRow = { rankMin: 1, rankMax: 1, prizeType: "gift_voucher", prizeValue: "", medalEmoji: "🥇", badge: "" };

const inputCls = "w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors";
const labelCls = "text-slate-300 text-sm font-semibold block mb-2";

export default function VidyastarConfig() {
  const [configs, setConfigs]       = useState<Config[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [success, setSuccess]       = useState(false);

  // Form state
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [periodKey,  setPeriodKey]  = useState(buildPeriodKey("monthly"));
  const [entryFee,   setEntryFee]   = useState(0);
  const [totalPool,  setTotalPool]  = useState(0);
  const [prizeRows,  setPrizeRows]  = useState<PrizeRow[]>([{ ...EMPTY_ROW }]);
  const [editingId,  setEditingId]  = useState<string | null>(null);

  useEffect(() => {
    getDocs(collection(db, "vidyastarConfig")).then((snap) => {
      setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Config)));
      setLoading(false);
    });
  }, []);

  const onPeriodTypeChange = (t: PeriodType) => {
    setPeriodType(t);
    setPeriodKey(buildPeriodKey(t));
  };

  const addPrizeRow = () => setPrizeRows((r) => [...r, { ...EMPTY_ROW, rankMin: r.length + 1, rankMax: r.length + 1 }]);
  const removePrizeRow = (i: number) => setPrizeRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof PrizeRow, value: any) =>
    setPrizeRows((r) => r.map((row, idx) => idx === i ? { ...row, [field]: value } : row));

  const handleSave = async () => {
    if (!periodKey) return;
    setSaving(true);
    try {
      const docId = editingId ?? periodKey;
      await setDoc(doc(db, "vidyastarConfig", docId), {
        period: periodType, periodKey, entryFee: Number(entryFee),
        totalPool: Number(totalPool), prizeRows,
        updatedAt: serverTimestamp(),
        createdAt: editingId ? undefined : serverTimestamp(),
      }, { merge: true });
      setSuccess(true);
      setShowForm(false);
      setEditingId(null);
      // Refresh list
      const snap = await getDocs(collection(db, "vidyastarConfig"));
      setConfigs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Config)));
      setTimeout(() => setSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: Config) => {
    setEditingId(c.id);
    setPeriodType(c.period);
    setPeriodKey(c.periodKey);
    setEntryFee(c.entryFee);
    setTotalPool(c.totalPool);
    setPrizeRows(c.prizeRows?.length ? c.prizeRows : [{ ...EMPTY_ROW }]);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this config?")) return;
    await deleteDoc(doc(db, "vidyastarConfig", id));
    setConfigs((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">⭐ VidyaStar Config</h1>
          <p className="text-slate-400 text-sm mt-1">Set prizes & entry fees per time period</p>
        </div>
        <button onClick={() => { setEditingId(null); setShowForm(true); setPeriodKey(buildPeriodKey(periodType)); setPrizeRows([{ ...EMPTY_ROW }]); setEntryFee(0); setTotalPool(0); }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-colors">
          + New Config
        </button>
      </div>

      {success && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-green-500/15 border border-green-500/30 rounded-xl p-4 text-green-400 font-semibold">
          ✅ Saved!
        </motion.div>
      )}

      {/* Form */}
      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
          <h2 className="text-white font-black text-lg">{editingId ? "✏️ Edit Config" : "➕ New Config"}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Period Type</label>
              <select value={periodType} onChange={(e) => onPeriodTypeChange(e.target.value as PeriodType)} className={inputCls}>
                {PERIOD_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Period Key (auto-generated)</label>
              <input value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Period shortcuts */}
            <div className="col-span-3">
              <label className={labelCls}>Quick Select Period</label>
              <div className="flex flex-wrap gap-2">
                {[0, 1, 2].map((offset) => {
                  const k = buildPeriodKey(periodType, offset);
                  return (
                    <button key={k} type="button" onClick={() => setPeriodKey(k)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${periodKey === k ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Entry Fee (₹) — 0 = Free</label>
              <input type="number" min={0} value={entryFee} onChange={(e) => setEntryFee(Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Total Pool (₹) — for display</label>
              <input type="number" min={0} value={totalPool} onChange={(e) => setTotalPool(Number(e.target.value))} className={inputCls} />
            </div>
          </div>

          {/* Prize rows */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className={labelCls.replace("block mb-2", "")}>Prize Rows (per rank)</label>
              <button type="button" onClick={addPrizeRow} className="text-indigo-400 text-sm font-bold hover:text-indigo-300">+ Add Row</button>
            </div>
            <div className="space-y-3">
              {prizeRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-end flex-wrap bg-slate-800 rounded-xl p-3">
                  <div className="w-16">
                    <label className="text-slate-400 text-xs mb-1 block">Rank Min</label>
                    <input type="number" min={1} value={row.rankMin} onChange={(e) => updateRow(i, "rankMin", Number(e.target.value))}
                      className="w-full bg-slate-700 text-white rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div className="w-16">
                    <label className="text-slate-400 text-xs mb-1 block">Rank Max</label>
                    <input type="number" min={1} value={row.rankMax} onChange={(e) => updateRow(i, "rankMax", Number(e.target.value))}
                      className="w-full bg-slate-700 text-white rounded-lg px-2 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-slate-400 text-xs mb-1 block">Prize Type</label>
                    <select value={row.prizeType} onChange={(e) => updateRow(i, "prizeType", e.target.value)}
                      className="bg-slate-700 text-white rounded-lg px-2 py-2 text-sm">
                      {PRIZE_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <label className="text-slate-400 text-xs mb-1 block">
                      {row.prizeType === "gift_voucher" ? "Voucher (e.g. ₹500 Amazon Voucher)"
                        : row.prizeType === "physical" ? "Item (e.g. Laptop, Mobile)"
                        : "V-Coins amount"}
                    </label>
                    <input value={row.prizeValue} onChange={(e) => updateRow(i, "prizeValue", e.target.value)}
                      className="w-full bg-slate-700 text-white rounded-lg px-2 py-2 text-sm"
                      placeholder={row.prizeType === "gift_voucher" ? "₹500 Amazon Voucher" : row.prizeType === "physical" ? "Dell Laptop" : "1000"} />
                  </div>
                  <div className="w-20">
                    <label className="text-slate-400 text-xs mb-1 block">Medal</label>
                    <select value={row.medalEmoji} onChange={(e) => updateRow(i, "medalEmoji", e.target.value)}
                      className="bg-slate-700 text-white rounded-lg px-2 py-2 text-sm w-full">
                      {MEDAL_OPTS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[120px]">
                    <label className="text-slate-400 text-xs mb-1 block">Badge label</label>
                    <input value={row.badge} onChange={(e) => updateRow(i, "badge", e.target.value)}
                      className="w-full bg-slate-700 text-white rounded-lg px-2 py-2 text-sm" placeholder="Champion" />
                  </div>
                  <button type="button" onClick={() => removePrizeRow(i)} className="text-red-400 hover:text-red-300 text-lg leading-none pb-1">×</button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold py-2.5 px-6 rounded-xl transition-colors">
              {saving ? "Saving…" : "Save Config"}
            </button>
            <button onClick={() => setShowForm(false)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-2.5 px-6 rounded-xl transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {loading ? <div className="p-8 text-center text-slate-400">Loading…</div>
          : configs.length === 0 ? <div className="p-8 text-center text-slate-400">No configs yet.</div>
          : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-xs uppercase">
                <th className="text-left p-4">Period Key</th>
                <th className="text-left p-4">Type</th>
                <th className="text-right p-4">Entry Fee</th>
                <th className="text-right p-4">Pool</th>
                <th className="text-right p-4">Prize Rows</th>
                <th className="text-right p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.sort((a, b) => b.periodKey.localeCompare(a.periodKey)).map((c, i) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 text-white font-mono font-medium">{c.periodKey}</td>
                  <td className="p-4"><span className="bg-slate-800 text-slate-300 text-xs px-2 py-1 rounded-lg capitalize">{c.period}</span></td>
                  <td className="p-4 text-right">
                    {c.entryFee > 0
                      ? <span className="text-amber-400 font-bold">₹{c.entryFee}</span>
                      : <span className="text-green-400 text-xs font-bold">Free</span>}
                  </td>
                  <td className="p-4 text-right text-slate-300">{c.totalPool > 0 ? `₹${c.totalPool}` : "—"}</td>
                  <td className="p-4 text-right text-slate-300">{c.prizeRows?.length ?? 0} rows</td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => handleEdit(c)} className="text-indigo-400 hover:text-indigo-300 text-xs">Edit</button>
                      <button onClick={() => handleDelete(c.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
