"use client";

import { useState } from "react";

// ============================================================
// 相続税計算ロジック（国税庁準拠）
// ============================================================

const TAX_TABLE = [
  { limit: 1000,  rate: 0.10, deduction: 0 },
  { limit: 3000,  rate: 0.15, deduction: 50 },
  { limit: 5000,  rate: 0.20, deduction: 200 },
  { limit: 10000, rate: 0.30, deduction: 700 },
  { limit: 20000, rate: 0.40, deduction: 1700 },
  { limit: 30000, rate: 0.45, deduction: 2700 },
  { limit: 60000, rate: 0.50, deduction: 4200 },
  { limit: Infinity, rate: 0.55, deduction: 7200 },
];

const LEGAL_SHARES = {
  "配偶者のみ":     { 配偶者: 1 },
  "配偶者＋子":     { 配偶者: 0.5, 子: 0.5 },
  "配偶者＋親":     { 配偶者: 2/3, 親: 1/3 },
  "配偶者＋兄弟姉妹": { 配偶者: 3/4, 兄弟姉妹: 1/4 },
  "子のみ":         { 子: 1 },
  "親のみ":         { 親: 1 },
  "兄弟姉妹のみ":   { 兄弟姉妹: 1 },
};

function calcTax(amount) {
  if (amount <= 0) return 0;
  const row = TAX_TABLE.find(r => amount <= r.limit);
  return Math.max(0, amount * row.rate - row.deduction);
}

function calcSmallLandReduction(landValue, landArea, resident, hasSpouse) {
  if (!landValue || !landArea || !resident || resident === "誰も住んでいない") return 0;
  const limit = 330;
  const targetArea = Math.min(landArea, limit);
  const ratio = landArea > 0 ? targetArea / landArea : 0;
  if (
    (resident === "配偶者" && hasSpouse) ||
    resident === "同居の子" ||
    resident === "同居の親族"
  ) {
    return landValue * ratio * 0.8;
  }
  return 0;
}

function calcInheritanceTax(inputs) {
  const {
    deposits, landValue, landArea, buildingValue, landResident,
    realEstateOtherValue, stocks, insurance, insuranceBeneficiary,
    retirement, otherAssets, debts, funeral,
    heirPattern, childCount, hasSpouse,
  } = inputs;

  let heirCount = 0;
  if (hasSpouse) heirCount++;
  if (heirPattern === "配偶者＋子" || heirPattern === "子のみ") heirCount += childCount;
  else if (heirPattern === "配偶者＋親" || heirPattern === "親のみ") heirCount += 1;
  else if (heirPattern === "配偶者＋兄弟姉妹" || heirPattern === "兄弟姉妹のみ") heirCount += 1;
  else if (heirPattern === "配偶者のみ") heirCount = 1;
  if (heirCount === 0) heirCount = 1;

  const insExemption = insuranceBeneficiary === "相続人以外" ? 0 : 500 * heirCount;
  const retExemption = 500 * heirCount;
  const taxableIns = Math.max(0, insurance - insExemption);
  const taxableRet = Math.max(0, retirement - retExemption);

  const smallLandReduction = calcSmallLandReduction(landValue, landArea, landResident, hasSpouse);
  const adjustedLand = Math.max(0, (landValue || 0) - smallLandReduction);
  const totalRE = adjustedLand + (buildingValue || 0) + (realEstateOtherValue || 0);

  const totalAssets = deposits + totalRE + stocks + taxableIns + taxableRet + otherAssets;
  const netAssets = Math.max(0, totalAssets - debts - funeral);
  const basicDeduction = 3000 + 600 * heirCount;
  const taxableEstate = Math.max(0, netAssets - basicDeduction);

  if (taxableEstate === 0) {
    return { heirCount, basicDeduction, netAssets, taxableEstate, totalTax: 0,
      totalTaxAfterSpouse: 0, taxableIns, taxableRet, adjustedLand, smallLandReduction };
  }

  const shares = LEGAL_SHARES[heirPattern] || { 子: 1 };
  let totalTax = 0;
  Object.keys(shares).forEach(role => {
    let share = shares[role];
    if (role === "子" && childCount > 1) {
      share = share / childCount;
      for (let i = 0; i < childCount; i++) totalTax += calcTax(taxableEstate * share);
    } else {
      totalTax += calcTax(taxableEstate * share);
    }
  });

  let totalTaxAfterSpouse = totalTax;
  if (hasSpouse && shares["配偶者"]) {
    const spouseShare = shares["配偶者"];
    const spouseAmount = taxableEstate * spouseShare;
    const spouseTax = calcTax(spouseAmount);
    const spouseLegalShare = netAssets * spouseShare;
    if (spouseLegalShare <= 16000 || spouseAmount <= 16000) {
      totalTaxAfterSpouse = Math.max(0, totalTax - spouseTax);
    }
  }

  return {
    heirCount, basicDeduction, netAssets, taxableEstate,
    totalTax: Math.round(totalTax),
    totalTaxAfterSpouse: Math.round(totalTaxAfterSpouse),
    taxableIns, taxableRet, adjustedLand, smallLandReduction,
  };
}

// ============================================================
// 定型文アドバイスエンジン
// ============================================================
function generateAdvice(inputs, result) {
  const advices = [];
  const { totalTax, totalTaxAfterSpouse, taxableEstate, basicDeduction, netAssets, smallLandReduction } = result;
  const { deposits, landValue, buildingValue, stocks, insurance, insuranceBeneficiary,
    retirement, heirPattern, childCount, hasSpouse, hasAdoptedChild } = inputs;

  // 節税スキーム
  if (landValue > 0 && smallLandReduction === 0) {
    advices.push({ category: "節税スキーム", priority: "高",
      title: "小規模宅地等の特例（居住用）が使える可能性があります",
      body: "自宅土地（330㎡まで）の評価額を最大80%減額できる特例です。居住者の要件（配偶者・同居親族等）を満たす場合、相続税を大幅に軽減できます。",
      cta: true });
  }
  if (insurance === 0 && result.heirCount > 0) {
    advices.push({ category: "節税スキーム", priority: "高",
      title: "生命保険の非課税枠（500万円×相続人数）が未活用です",
      body: `生命保険に加入することで${500 * result.heirCount}万円分を非課税にできます。現金・預金が多い方には特に効果的な節税策です。`,
      cta: true });
  }
  if (insurance > 0 && insurance < 500 * result.heirCount) {
    advices.push({ category: "節税スキーム", priority: "中",
      title: "生命保険の非課税枠がまだ余っています",
      body: `非課税枠（${500 * result.heirCount}万円）に対して現在の保険金は${insurance}万円です。枠をフル活用することで節税余地があります。`,
      cta: true });
  }
  if (insuranceBeneficiary === "相続人以外" && insurance > 0) {
    advices.push({ category: "節税スキーム", priority: "高",
      title: "生命保険の受取人を相続人に変更することで非課税枠が使えます",
      body: `現在の受取人設定では生命保険の非課税枠（500万円×相続人数）が適用されません。受取人を相続人に変更することで${500 * result.heirCount}万円分の節税効果が生まれます。`,
      cta: true });
  }
  if (hasSpouse && totalTax > totalTaxAfterSpouse) {
    advices.push({ category: "節税スキーム", priority: "高",
      title: "配偶者控除で相続税を大幅に軽減できます",
      body: "配偶者が相続する財産が1億6,000万円以下または法定相続分以下であれば配偶者の相続税はゼロになります。ただし二次相続への影響も考慮が必要です。",
      cta: true });
  }
  if (taxableEstate > 0 && (childCount > 0 || heirPattern.includes("子"))) {
    advices.push({ category: "節税スキーム", priority: "中",
      title: "生前贈与（年110万円の基礎控除）で財産を減らせます",
      body: "毎年110万円以内の贈与は贈与税がかかりません。早めに始めるほど効果が大きく、相続財産を計画的に減らすことができます。ただし相続開始前7年以内の贈与は相続税の対象になります。",
      cta: true });
  }
  if (deposits > 5000 && !landValue) {
    advices.push({ category: "節税スキーム", priority: "中",
      title: "現金・預金を不動産に換えることで評価額を下げられる可能性があります",
      body: "現金はそのまま相続税の対象になりますが、不動産は路線価・固定資産税評価額で評価されるため、時価より低く評価される場合があります。",
      cta: true });
  }

  // 法的論点
  if (deposits > netAssets * 0.5 && deposits > 3000) {
    advices.push({ category: "法的論点", priority: "要注意",
      title: "名義預金と判定されるリスクがあります",
      body: "預金が財産の大部分を占める場合、税務署から「名義預金（実質的に被相続人の財産）」と判定されるリスクがあります。口座の管理・通帳・印鑑の状況を整理しておくことが重要です。",
      cta: true });
  }
  if (childCount >= 2 || heirPattern.includes("兄弟姉妹")) {
    advices.push({ category: "法的論点", priority: "確認必要",
      title: "遺産分割協議でもめるリスクがあります",
      body: "相続人が複数いる場合、分割方法について争いが起きる可能性があります。遺言書の作成が有効な対策です。",
      cta: true });
  }
  if (landValue > 0 || buildingValue > 0) {
    advices.push({ category: "法的論点", priority: "確認必要",
      title: "不動産の評価方法によって相続税額が変わります",
      body: "土地は路線価、建物は固定資産税評価額が基準です。実際の評価額は専門家による確認をおすすめします。",
      cta: true });
  }
  if (hasSpouse && totalTax > totalTaxAfterSpouse) {
    advices.push({ category: "法的論点", priority: "確認必要",
      title: "二次相続（配偶者が亡くなった時）の税負担に注意が必要です",
      body: "今回の相続で配偶者控除を最大限使うと、次の相続（配偶者が亡くなった時）で子どもの税負担が大きくなる場合があります。一次・二次相続を合わせた最適化が必要です。",
      cta: true });
  }
  if (taxableEstate > 0) {
    advices.push({ category: "法的論点", priority: "要注意",
      title: "相続税の申告期限は相続開始から10ヶ月以内です",
      body: "申告・納税が期限を過ぎると延滞税・加算税が発生します。早めに税理士・弁護士へご相談ください。",
      cta: true });
  }
  if (stocks > 0) {
    advices.push({ category: "法的論点", priority: "確認必要",
      title: "株式の評価は相続開始日の時価が基準です",
      body: "上場株式は相続開始日・月の終値の平均等で評価されます。非上場株式の場合はさらに複雑な評価が必要です。",
      cta: false });
  }

  // 次のアクション
  if (taxableEstate === 0) {
    advices.push({ category: "次のアクション", priority: "参考情報",
      title: "現時点では相続税がかからない試算結果です",
      body: `基礎控除額（${basicDeduction}万円）以内に収まっています。ただし財産の評価方法や見落とし項目によって変わる場合があります。念のため専門家にご確認されることをおすすめします。`,
      cta: false });
  } else if (totalTaxAfterSpouse <= 500) {
    advices.push({ category: "次のアクション", priority: "確認必要",
      title: "申告手続きの準備を始めましょう",
      body: "相続税の申告が必要な試算結果です。申告期限（相続開始から10ヶ月）に向けて、必要書類の収集と専門家への相談をお早めに。",
      cta: true });
  } else {
    advices.push({ category: "次のアクション", priority: "要注意",
      title: "節税対策の余地があります。早めのご相談をおすすめします",
      body: "相続税額が大きい試算結果です。小規模宅地特例・生命保険の活用・生前贈与など複数の節税策を組み合わせることで大幅に軽減できる可能性があります。",
      cta: true });
  }
  if (hasAdoptedChild) {
    advices.push({ category: "次のアクション", priority: "確認必要",
      title: "養子がいる場合は相続税の計算に影響があります",
      body: "養子は法定相続人に含まれますが、基礎控除に算入できる養子の人数は実子がいる場合は1人、いない場合は2人までと制限があります。実際の計算は専門家にご確認ください。",
      cta: true });
  }

  return advices;
}

// ============================================================
// ユーティリティ
// ============================================================
const fmt = (n) => {
  if (!n && n !== 0) return "―";
  return new Intl.NumberFormat("ja-JP").format(Math.round(n)) + "万円";
};

const priorityStyle = {
  "高":      { bg: "rgba(192,57,43,0.08)",   color: "#c0392b", label: "優先度：高" },
  "中":      { bg: "rgba(211,84,0,0.08)",    color: "#d35400", label: "優先度：中" },
  "要注意":  { bg: "rgba(192,57,43,0.08)",   color: "#c0392b", label: "要注意" },
  "確認必要":{ bg: "rgba(211,84,0,0.08)",    color: "#d35400", label: "確認必要" },
  "参考情報":{ bg: "rgba(36,113,163,0.08)",  color: "#2471a3", label: "参考情報" },
};

// ============================================================
// メインコンポーネント
// ============================================================
export default function InheritanceTaxPhase1() {
  const [step, setStep] = useState(0);
  const [result, setResult] = useState(null);
  const [advices, setAdvices] = useState([]);

  const [inputs, setInputs] = useState({
    userRole: "",
    deposits: "", landValue: "", landArea: "", landAddress: "",
    landResident: "", buildingValue: "", realEstateOtherValue: "",
    stocks: "", insurance: "",
    insuranceBeneficiary: "相続人（配偶者・子など）",
    retirement: "", otherAssets: "", debts: "", funeral: "",
    heirPattern: "配偶者＋子", childCount: 2,
    hasAdoptedChild: false, hasSpouse: true,
  });

  const set = (key, val) => setInputs(prev => ({ ...prev, [key]: val }));
  const num = (v) => parseFloat(v) || 0;

  const handleHeirPattern = (v) => {
    set("heirPattern", v);
    set("hasSpouse", v.includes("配偶者"));
  };

  const calculate = () => {
    const parsed = {
      ...inputs,
      deposits: num(inputs.deposits), landValue: num(inputs.landValue),
      landArea: num(inputs.landArea), buildingValue: num(inputs.buildingValue),
      realEstateOtherValue: num(inputs.realEstateOtherValue),
      stocks: num(inputs.stocks), insurance: num(inputs.insurance),
      retirement: num(inputs.retirement), otherAssets: num(inputs.otherAssets),
      debts: num(inputs.debts), funeral: num(inputs.funeral),
      childCount: parseInt(inputs.childCount) || 1,
    };
    const res = calcInheritanceTax(parsed);
    const adv = generateAdvice(parsed, res);
    setResult(res);
    setAdvices(adv);
    setStep(3);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 100);
  };

  const reset = () => { setStep(0); setResult(null); setAdvices([]); };

  const categoryOrder = ["節税スキーム", "法的論点", "次のアクション"];
  const categoryLabel = {
    "節税スキーム": "💡 節税スキームの提案",
    "法的論点": "⚖️ 法的論点・リスク",
    "次のアクション": "📋 次のアクション",
  };

  const liveHeirCount = (() => {
    let n = inputs.hasSpouse ? 1 : 0;
    if (inputs.heirPattern === "配偶者＋子" || inputs.heirPattern === "子のみ") n += parseInt(inputs.childCount) || 1;
    else if (["配偶者＋親","親のみ","配偶者＋兄弟姉妹","兄弟姉妹のみ"].includes(inputs.heirPattern)) n += 1;
    return Math.max(1, n);
  })();

  return (
    <div style={{ fontFamily: "'Noto Sans JP','Hiragino Kaku Gothic ProN',sans-serif", background: "#f8f5f0", minHeight: "100vh", color: "#2c2420" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        :root{--gold:#b8935a;--dark:#2c2420;--border:rgba(184,147,90,0.25);--red:#c0392b;--orange:#d35400;--blue:#2471a3;}
        input,select{font-family:'Noto Sans JP',sans-serif;}
        input[type=number],input[type=text]{background:white;border:1px solid var(--border);color:var(--dark);padding:10px 14px;border-radius:6px;width:100%;font-size:15px;outline:none;transition:border-color 0.2s;}
        input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(184,147,90,0.12);}
        select{background:white;border:1px solid var(--border);color:var(--dark);padding:10px 14px;border-radius:6px;width:100%;font-size:15px;outline:none;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23b8935a' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center;padding-right:36px;}
        select:focus{border-color:var(--gold);}
        .btn-calc{background:linear-gradient(135deg,#b8935a,#8a6a35);color:white;border:none;padding:16px 48px;border-radius:8px;font-family:'Noto Sans JP',sans-serif;font-size:17px;font-weight:700;cursor:pointer;letter-spacing:0.05em;transition:transform 0.15s,opacity 0.15s;box-shadow:0 4px 16px rgba(184,147,90,0.35);}
        .btn-calc:hover{transform:translateY(-2px);opacity:0.95;}
        .btn-sub{background:transparent;color:var(--gold);border:1px solid var(--border);padding:10px 24px;border-radius:6px;font-family:'Noto Sans JP',sans-serif;font-size:14px;cursor:pointer;transition:all 0.2s;}
        .btn-sub:hover{background:rgba(184,147,90,0.08);border-color:var(--gold);}
        .field-label{font-size:12px;color:#7a6a5a;letter-spacing:0.04em;margin-bottom:6px;font-weight:500;}
        .field-note{font-size:11px;color:#8a7a6a;margin-top:4px;line-height:1.6;}
        .card{background:white;border:1px solid var(--border);border-radius:12px;padding:24px;margin-bottom:20px;}
        .section-head{font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--gold);margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid var(--border);font-weight:700;}
        .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
        .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;}
        .check-row{display:flex;align-items:flex-start;gap:10px;padding:12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:background 0.2s;margin-bottom:8px;}
        .check-row:hover{background:rgba(184,147,90,0.05);}
        .check-row input[type=checkbox]{width:18px;height:18px;margin-top:1px;accent-color:var(--gold);flex-shrink:0;}
        .stat-box{background:#f0ebe3;border:1px solid var(--border);border-radius:10px;padding:18px;text-align:center;}
        .stat-label{font-size:11px;color:#8a7a6a;letter-spacing:0.06em;margin-bottom:6px;}
        .stat-value{font-size:20px;font-weight:700;color:var(--gold);}
        .advice-card{border-left:3px solid;padding:16px 16px 16px 20px;margin-bottom:12px;border-radius:0 8px 8px 0;}
        .cta-box{background:linear-gradient(135deg,#b8935a,#8a6a35);color:white;border-radius:12px;padding:28px 32px;text-align:center;margin-top:32px;}
        .cta-btn{background:white;color:#8a6a35;border:none;padding:14px 40px;border-radius:8px;font-family:'Noto Sans JP',sans-serif;font-size:16px;font-weight:700;cursor:pointer;margin-top:16px;transition:transform 0.15s;box-shadow:0 2px 12px rgba(0,0,0,0.15);}
        .cta-btn:hover{transform:translateY(-2px);}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        .fade-up{animation:fadeUp 0.5s ease forwards;}
        .tag{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.04em;}
        .disclaimer{background:#f5f0ea;border:1px solid var(--border);border-radius:8px;padding:14px 18px;font-size:12px;color:#8a7a6a;line-height:1.8;margin-top:20px;}
        .role-btn{background:white;border:2px solid var(--border);border-radius:12px;padding:20px 16px;cursor:pointer;transition:all 0.2s;text-align:center;font-family:'Noto Sans JP',sans-serif;}
        .role-btn:hover{border-color:var(--gold);background:rgba(184,147,90,0.05);}
        .role-btn.selected{border-color:var(--gold);background:rgba(184,147,90,0.1);}
        .role-icon{font-size:28px;margin-bottom:8px;}
        .role-label{font-size:14px;font-weight:700;color:var(--dark);}
        .role-sub{font-size:11px;color:#8a7a6a;margin-top:4px;}
      `}</style>

      {/* ヘッダー */}
      <div style={{ background: "white", borderBottom: "1px solid var(--border)", padding: "0 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 34, height: 34, background: "linear-gradient(135deg,#b8935a,#8a6a35)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 16 }}>⚖</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.04em" }}>相続税 かんたん診断</div>
              <div style={{ fontSize: 10, color: "#8a7a6a", letterSpacing: "0.06em" }}>INHERITANCE TAX SIMULATOR</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#8a7a6a" }}>国税庁準拠・無料・匿名</div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 60px" }}>

        {/* ステップインジケーター */}
        {step > 0 && step < 3 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 28 }}>
            {["財産の入力", "相続人・確認", "診断結果"].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, background: step > i+1 ? "linear-gradient(135deg,#b8935a,#8a6a35)" : step === i+1 ? "rgba(184,147,90,0.2)" : "white", border: step === i+1 ? "1px solid var(--gold)" : step > i+1 ? "none" : "1px solid var(--border)", color: step > i+1 ? "white" : step === i+1 ? "var(--gold)" : "#8a7a6a" }}>
                    {step > i+1 ? "✓" : i+1}
                  </div>
                  <div style={{ fontSize: 10, color: step >= i+1 ? "var(--gold)" : "#8a7a6a", whiteSpace: "nowrap" }}>{s}</div>
                </div>
                {i < 2 && <div style={{ width: 40, height: 1, background: step > i+1 ? "var(--gold)" : "var(--border)", margin: "0 4px", marginBottom: 16 }} />}
              </div>
            ))}
          </div>
        )}

        {/* STEP 0: 属性選択 */}
        {step === 0 && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, marginBottom: 10 }}>相続税をかんたん診断</h1>
              <p style={{ fontSize: 14, color: "#6a5a4a", lineHeight: 1.8 }}>
                氏名不要・匿名でご利用いただけます。<br />
                まず、あなたはどのお立場でシミュレーションされますか？
              </p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
              {[
                { role: "本人（被相続人となる方）", icon: "👤", sub: "ご自身の財産について生前対策を検討したい" },
                { role: "配偶者", icon: "💑", sub: "配偶者が亡くなった場合の相続税を知りたい" },
                { role: "子", icon: "👨‍👩‍👦", sub: "親が亡くなった場合の相続税を知りたい" },
                { role: "親・兄弟姉妹・その他", icon: "👪", sub: "家族が亡くなった場合の相続税を知りたい" },
              ].map(item => (
                <button key={item.role} className={`role-btn${inputs.userRole === item.role ? " selected" : ""}`} onClick={() => set("userRole", item.role)}>
                  <div className="role-icon">{item.icon}</div>
                  <div className="role-label">{item.role}</div>
                  <div className="role-sub">{item.sub}</div>
                </button>
              ))}
            </div>
            <div style={{ background: "#fdf9f4", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", fontSize: 12, color: "#7a6a5a", lineHeight: 1.7, marginBottom: 24 }}>
              ℹ️ このシミュレーターは「被相続人（亡くなる方）の財産に対して、法定相続分で相続した場合の相続税概算」を計算します。氏名などの個人情報は一切不要です。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn-calc" onClick={() => { if (!inputs.userRole) { alert("属性を選択してください"); return; } setStep(1); }}>次へ：財産の入力 →</button>
            </div>
          </div>
        )}

        {/* STEP 1: 財産入力 */}
        {step === 1 && (
          <div className="fade-up">
            <div className="card">
              <div className="section-head">💰 金融資産</div>
              <div className="grid2">
                <div>
                  <div className="field-label">預貯金 合計（万円）</div>
                  <input type="number" value={inputs.deposits} onChange={e => set("deposits", e.target.value)} placeholder="例：3000" />
                </div>
                <div>
                  <div className="field-label">上場株式・投資信託（万円）</div>
                  <input type="number" value={inputs.stocks} onChange={e => set("stocks", e.target.value)} placeholder="例：1000" />
                </div>
                <div>
                  <div className="field-label">生命保険金（受取予定額・万円）</div>
                  <input type="number" value={inputs.insurance} onChange={e => set("insurance", e.target.value)} placeholder="例：1500" />
                  <div className="field-note">※ 生命保険金は相続財産ではありませんが相続税の課税対象になります。受取人が相続人の場合は非課税枠（500万円×相続人数）が適用されます。</div>
                </div>
                <div>
                  <div className="field-label">生命保険の受取人</div>
                  <select value={inputs.insuranceBeneficiary} onChange={e => set("insuranceBeneficiary", e.target.value)}>
                    <option value="相続人（配偶者・子など）">相続人（配偶者・子など）</option>
                    <option value="相続人以外">相続人以外（孫・第三者など）</option>
                    <option value="未定・不明">未定・不明</option>
                  </select>
                </div>
                <div>
                  <div className="field-label">死亡退職金（万円）</div>
                  <input type="number" value={inputs.retirement} onChange={e => set("retirement", e.target.value)} placeholder="例：500" />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-head">🏠 不動産 ― 土地</div>
              <div className="grid2">
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="field-label">土地の住所（路線価の参考用）</div>
                  <input type="text" value={inputs.landAddress} onChange={e => set("landAddress", e.target.value)} placeholder="例：兵庫県神戸市中央区○○町1-2-3" />
                  <div className="field-note">💡 路線価は<a href="https://www.rosenka.nta.go.jp/" target="_blank" rel="noopener noreferrer" style={{ color: "var(--gold)" }}>国税庁 路線価サイト</a>で住所から調べられます。路線価（円/㎡）× 面積（㎡）÷ 10,000 = 評価額（万円）の目安です。</div>
                </div>
                <div>
                  <div className="field-label">土地面積（㎡）</div>
                  <input type="number" value={inputs.landArea} onChange={e => set("landArea", e.target.value)} placeholder="例：150" />
                </div>
                <div>
                  <div className="field-label">土地評価額（万円）</div>
                  <input type="number" value={inputs.landValue} onChange={e => set("landValue", e.target.value)} placeholder="例：5000" />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="field-label">その土地に誰が住んでいますか？</div>
                  <select value={inputs.landResident} onChange={e => set("landResident", e.target.value)}>
                    <option value="">選択してください</option>
                    <option value="被相続人本人のみ">被相続人本人のみ</option>
                    <option value="配偶者">配偶者（と被相続人）</option>
                    <option value="同居の子">同居の子（と被相続人）</option>
                    <option value="同居の親族">その他同居の親族</option>
                    <option value="誰も住んでいない">誰も住んでいない（空き家・賃貸など）</option>
                  </select>
                  <div className="field-note">※ 居住者によって小規模宅地等の特例（最大80%減額）の適用可否が自動判定されます</div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="section-head">🏗 不動産 ― 建物</div>
              <div>
                <div className="field-label">建物の固定資産税評価額（万円）</div>
                <input type="number" value={inputs.buildingValue} onChange={e => set("buildingValue", e.target.value)} placeholder="例：800" />
                <div className="field-note">💡 固定資産税・都市計画税の納税通知書に記載の「評価額」をご入力ください。お手元にない場合は市区町村役場でご確認いただけます。</div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="field-label">その他不動産（賃貸物件・別荘等）の合計評価額（万円）</div>
                <input type="number" value={inputs.realEstateOtherValue} onChange={e => set("realEstateOtherValue", e.target.value)} placeholder="例：2000" />
              </div>
            </div>

            <div className="card">
              <div className="section-head">📦 その他財産・債務</div>
              <div className="grid2">
                <div>
                  <div className="field-label">その他財産（車・貴金属・ゴルフ会員権・骨董品等・万円）</div>
                  <input type="number" value={inputs.otherAssets} onChange={e => set("otherAssets", e.target.value)} placeholder="例：300" />
                </div>
                <div>
                  <div className="field-label">債務合計（借入金・未払金等・万円）</div>
                  <input type="number" value={inputs.debts} onChange={e => set("debts", e.target.value)} placeholder="例：1000" />
                </div>
                <div>
                  <div className="field-label">葬式費用（万円）</div>
                  <input type="number" value={inputs.funeral} onChange={e => set("funeral", e.target.value)} placeholder="例：200" />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button className="btn-sub" onClick={() => setStep(0)}>← 戻る</button>
              <button className="btn-calc" onClick={() => setStep(2)}>次へ：相続人の確認 →</button>
            </div>
          </div>
        )}

        {/* STEP 2: 相続人 */}
        {step === 2 && (
          <div className="fade-up">
            <div className="card">
              <div className="section-head">👨‍👩‍👧 相続人の構成</div>
              <div className="grid2" style={{ marginBottom: 14 }}>
                <div>
                  <div className="field-label">相続人パターン</div>
                  <select value={inputs.heirPattern} onChange={e => handleHeirPattern(e.target.value)}>
                    <option value="配偶者のみ">配偶者のみ</option>
                    <option value="配偶者＋子">配偶者＋子</option>
                    <option value="配偶者＋親">配偶者＋父母（子なし）</option>
                    <option value="配偶者＋兄弟姉妹">配偶者＋兄弟姉妹（子・親なし）</option>
                    <option value="子のみ">子のみ（配偶者なし）</option>
                    <option value="親のみ">父母のみ（配偶者・子なし）</option>
                    <option value="兄弟姉妹のみ">兄弟姉妹のみ（配偶者・子・親なし）</option>
                  </select>
                </div>
                {(inputs.heirPattern === "配偶者＋子" || inputs.heirPattern === "子のみ") && (
                  <div>
                    <div className="field-label">子の人数（養子を含む）</div>
                    <select value={inputs.childCount} onChange={e => set("childCount", parseInt(e.target.value))}>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}人</option>)}
                    </select>
                  </div>
                )}
              </div>
              <label className="check-row">
                <input type="checkbox" checked={inputs.hasAdoptedChild} onChange={e => set("hasAdoptedChild", e.target.checked)} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>子の中に養子がいる</div>
                  <div style={{ fontSize: 12, color: "#8a7a6a", marginTop: 2 }}>養子は法定相続人に含まれますが、基礎控除に算入できる人数に制限があります（実子がいる場合は1人まで）</div>
                </div>
              </label>
              <div style={{ background: "#fdf9f4", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 16px", marginTop: 14, fontSize: 13, color: "var(--gold)", fontWeight: 600 }}>
                📊 基礎控除額（概算）：<strong style={{ fontSize: 16 }}>{(3000 + 600 * liveHeirCount).toLocaleString()}万円</strong>
                <span style={{ color: "#8a7a6a", marginLeft: 8, fontSize: 12 }}>（3,000万円 + 600万円 × {liveHeirCount}人）</span>
              </div>
            </div>

            <div className="card">
              <div className="section-head">📋 入力内容の確認</div>
              <div style={{ fontSize: 13, lineHeight: 2.2, color: "#5a4a3a" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px" }}>
                  <div>預貯金：<strong>{fmt(num(inputs.deposits))}</strong></div>
                  <div>株式：<strong>{fmt(num(inputs.stocks))}</strong></div>
                  <div>生命保険：<strong>{fmt(num(inputs.insurance))}</strong>（受取人：{inputs.insuranceBeneficiary}）</div>
                  <div>死亡退職金：<strong>{fmt(num(inputs.retirement))}</strong></div>
                  <div>土地：<strong>{fmt(num(inputs.landValue))}</strong>{inputs.landArea ? `（${inputs.landArea}㎡）` : ""}</div>
                  <div>建物：<strong>{fmt(num(inputs.buildingValue))}</strong></div>
                  <div>その他不動産：<strong>{fmt(num(inputs.realEstateOtherValue))}</strong></div>
                  <div>その他財産：<strong>{fmt(num(inputs.otherAssets))}</strong></div>
                  <div>債務：<strong>{fmt(num(inputs.debts))}</strong></div>
                  <div>葬式費用：<strong>{fmt(num(inputs.funeral))}</strong></div>
                </div>
                {inputs.landResident && (
                  <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(184,147,90,0.08)", borderRadius: 6, fontSize: 12 }}>
                    🏠 土地居住者：{inputs.landResident}
                    {(inputs.landResident === "配偶者" || inputs.landResident === "同居の子" || inputs.landResident === "同居の親族") && " → 小規模宅地等の特例（80%減額）が自動適用されます"}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button className="btn-sub" onClick={() => setStep(1)}>← 戻る</button>
              <button className="btn-calc" onClick={calculate}>診断する →</button>
            </div>
          </div>
        )}

        {/* STEP 3: 結果 */}
        {step === 3 && result && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, marginBottom: 8 }}>診断結果</h2>
              <p style={{ fontSize: 13, color: "#6a5a4a" }}>入力いただいた内容をもとにした概算です（{inputs.userRole}としてシミュレーション）</p>
            </div>

            <div className="card" style={{ marginBottom: 24 }}>
              <div className="section-head">相続税 概算計算</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
                <div className="stat-box">
                  <div className="stat-label">正味財産総額</div>
                  <div className="stat-value">{fmt(result.netAssets)}</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">基礎控除額</div>
                  <div className="stat-value">{fmt(result.basicDeduction)}</div>
                  <div style={{ fontSize: 11, color: "#8a7a6a", marginTop: 4 }}>3,000万円＋600万円×{result.heirCount}人</div>
                </div>
                <div className="stat-box">
                  <div className="stat-label">課税遺産総額</div>
                  <div className="stat-value" style={{ color: result.taxableEstate > 0 ? "#c0392b" : "var(--gold)" }}>{fmt(result.taxableEstate)}</div>
                </div>
              </div>

              {result.taxableEstate === 0 ? (
                <div style={{ background: "rgba(39,174,96,0.08)", border: "1px solid rgba(39,174,96,0.3)", borderRadius: 8, padding: "16px 20px", textAlign: "center" }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#1a8a4a", marginBottom: 4 }}>✓ 相続税はかかりません（概算）</div>
                  <div style={{ fontSize: 13, color: "#4a7a5a" }}>課税遺産総額がゼロです。ただし財産の評価方法によって変わる場合があります。</div>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div className="stat-box" style={{ border: "1px solid rgba(192,57,43,0.3)" }}>
                    <div className="stat-label">相続税総額（概算）</div>
                    <div className="stat-value" style={{ color: "#c0392b" }}>{fmt(result.totalTax)}</div>
                  </div>
                  <div className="stat-box" style={{ border: "1px solid rgba(184,147,90,0.4)" }}>
                    <div className="stat-label">相続税総額（配偶者控除後・概算）</div>
                    <div className="stat-value">{fmt(result.totalTaxAfterSpouse)}</div>
                    <div style={{ fontSize: 11, color: "#8a7a6a", marginTop: 4 }}>配偶者分を軽減後</div>
                  </div>
                </div>
              )}

              {(result.smallLandReduction > 0 || result.taxableIns > 0 || result.taxableRet > 0) && (
                <div style={{ marginTop: 14, fontSize: 12, color: "#7a6a5a", background: "#fdf9f4", borderRadius: 6, padding: "10px 14px", lineHeight: 2 }}>
                  {result.smallLandReduction > 0 && <div>✅ 小規模宅地等の特例を自動適用：<strong>{fmt(result.smallLandReduction)}</strong>減額</div>}
                  {result.taxableIns > 0 && <div>・生命保険金のうち課税対象：{fmt(result.taxableIns)}（非課税枠 {fmt(500*result.heirCount)} 控除後）</div>}
                  {result.taxableRet > 0 && <div>・死亡退職金のうち課税対象：{fmt(result.taxableRet)}（非課税枠 {fmt(500*result.heirCount)} 控除後）</div>}
                </div>
              )}

              {inputs.hasAdoptedChild && (
                <div style={{ marginTop: 14, background: "rgba(211,84,0,0.06)", border: "1px solid rgba(211,84,0,0.3)", borderRadius: 6, padding: "10px 14px", fontSize: 12, color: "#d35400", lineHeight: 1.8 }}>
                  ⚠️ <strong>養子がいる場合の注意：</strong>基礎控除に算入できる養子の人数は、実子がいる場合は1人、いない場合は2人までと制限されています。実際の計算は専門家にご確認ください。
                </div>
              )}
            </div>

            {categoryOrder.map(cat => {
              const items = advices.filter(a => a.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} className="card" style={{ marginBottom: 20 }}>
                  <div className="section-head">{categoryLabel[cat]}</div>
                  {items.map((adv, i) => {
                    const ps = priorityStyle[adv.priority] || priorityStyle["参考情報"];
                    return (
                      <div key={i} className="advice-card" style={{ borderLeftColor: ps.color, background: ps.bg }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                          <span className="tag" style={{ background: `${ps.color}22`, color: ps.color, border: `1px solid ${ps.color}44` }}>{ps.label}</span>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--dark)" }}>{adv.title}</span>
                        </div>
                        <p style={{ fontSize: 13, color: "#5a4a3a", lineHeight: 1.8 }}>{adv.body}</p>
                        {adv.cta && <div style={{ marginTop: 10, fontSize: 12, color: ps.color, fontWeight: 600 }}>→ 詳しくはご相談ください</div>}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="cta-box">
              <div style={{ fontSize: 11, letterSpacing: "0.15em", marginBottom: 8, opacity: 0.8 }}>LEGAL CONSULTATION</div>
              <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10, fontFamily: "'Playfair Display',serif" }}>節税対策・詳しい試算はご相談ください</h3>
              <p style={{ fontSize: 14, lineHeight: 1.8, opacity: 0.9, marginBottom: 4 }}>
                相続税の実際の申告・節税スキームの立案・法的リスクの回避には<br />専門家によるアドバイスが不可欠です。初回相談は無料です。
              </p>
              <button className="cta-btn">無料相談のお申し込み →</button>
            </div>

            <div className="disclaimer">
              ⚠️ 本シミュレーターは国税庁の計算式に基づく概算であり、法的・税務上のアドバイスではありません。実際の評価方法・特例適用の要件は個々の事情により異なります。正確な申告・手続きは必ず資格を持つ税理士・弁護士にご確認ください。
            </div>

            <div style={{ display: "flex", justifyContent: "center", marginTop: 28 }}>
              <button className="btn-sub" onClick={reset}>← もう一度入力する</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
