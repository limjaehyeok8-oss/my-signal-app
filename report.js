// report.js - 파이썬이 만든 report.json을 "📋 리포트" 탭에 보여줍니다.
(function () {
  // 파이썬 저장소가 웹앱 저장소와 다르면 아래를 raw 주소로 바꾸세요.
  // 예: "https://raw.githubusercontent.com/limjaehyeok8-oss/저장소이름/main/report.json"
  const REPORT_URL = "report.json";

  const style = document.createElement("style");
  style.textContent = `
    #reportView { margin: 0 -16px; }
    #reportView > * { margin-left: 16px; margin-right: 16px; }
    #reportView .rSec { margin: 0; padding: 26px 16px 22px; border-top: 8px solid var(--band); }
    #reportView .rSec:first-of-type { border-top: none; padding-top: 8px; }
    #reportView h3 { margin: 0 0 14px; font-size: 18px; font-weight: 800; }
    #reportView .rBig { font-size: 52px; font-weight: 800; line-height: 1; }
    #reportView .rSub { font-size: 16px; font-weight: 800; margin: 8px 0 14px; }
    #reportView .rRow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 0; border-top: 1px solid var(--line); }
    #reportView .rRow:first-of-type { border-top: none; }
    #reportView .rL { font-size: 15px; font-weight: 700; min-width: 0; }
    #reportView .rL small { display: block; font-size: 12px; font-weight: 400; color: var(--sub); margin-top: 3px; }
    #reportView .rR { text-align: right; font-size: 17px; font-weight: 800; flex: none; }
    #reportView .rR small { display: block; font-size: 12px; font-weight: 400; color: var(--sub); margin-top: 3px; }
    #reportView .up { color: var(--up); } #reportView .down { color: var(--down); }
    #reportView .rTag { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px; background: var(--card2); color: var(--sub); white-space: nowrap; }
    #reportView .rTag.bad { background: rgba(255,170,60,.16); color: #ffa63c; }
    #reportView .rTag.ok { background: rgba(61,220,151,.15); color: var(--accent); }
    #reportView .rBanner { margin-top: 12px; padding: 14px 16px; border-radius: 14px; font-size: 14px; font-weight: 800; line-height: 1.5; background: var(--card2); }
    #reportView .rBanner.bad { background: rgba(255,90,106,.14); color: #ff7a88; }
    #reportView .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    #reportView .chip { padding: 8px 14px; border-radius: 999px; background: var(--card2); font-size: 14px; font-weight: 700; text-decoration: none; color: var(--txt); }
    #reportView .line { font-size: 14px; line-height: 1.6; padding: 10px 0; border-top: 1px solid var(--line); }
    #reportView .line:first-of-type { border-top: none; }
    #reportView .note { font-size: 12px; color: var(--sub); line-height: 1.6; white-space: pre-wrap; margin-top: 12px; }
    #reportView .none { font-size: 14px; color: var(--sub); }
    #reportView .warn { color: #ff7a88; }
    #reportMsg { margin: 16px; color: var(--sub); font-size: 14px; }
    html[data-theme="light"] #reportView .chip, html[data-theme="light"] #reportView .rTag, html[data-theme="light"] #reportView .rBanner { background: #eef1f6; }
  `;
  document.head.appendChild(style);

  // ----- 탭 버튼과 화면 만들기 -----
  const tabs = document.querySelector(".mainTabs");
  const home = document.getElementById("homeView");
  const fgv = document.getElementById("fgView");
  const tabHome = document.getElementById("tabHome");
  const tabFg = document.getElementById("tabFg");
  if (!tabs || !home || !fgv) return;

  const tabBtn = document.createElement("button");
  tabBtn.id = "tabReport";
  tabBtn.textContent = "📋 리포트";
  tabs.appendChild(tabBtn);

  const view = document.createElement("div");
  view.id = "reportView";
  view.style.display = "none";
  fgv.after(view);

  let loaded = false;
  function showReport() {
    home.style.display = "none";
    fgv.style.display = "none";
    view.style.display = "block";
    tabHome.className = "";
    tabFg.className = "";
    tabBtn.className = "on";
    history.replaceState(null, "", "#report");
    if (!loaded) { loaded = true; load(); }
  }
  function leave() { view.style.display = "none"; tabBtn.className = ""; }
  tabBtn.addEventListener("click", showReport);
  tabHome.addEventListener("click", leave);
  tabFg.addEventListener("click", leave);

  // ----- 그리기 도구 -----
  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    return e;
  }
  const COLORS = [[24, "#d32f2f"], [44, "#f57c00"], [55, "#9e9e9e"], [75, "#7cb342"], [100, "#2e7d32"]];
  function colorOf(score) { for (const [m, c] of COLORS) if (score <= m) return c; return COLORS[4][1]; }
  const pctTxt = (v) => v == null ? "-" : (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const winTxt = (v) => v == null ? "-" : (v * 100).toFixed(0) + "%";

  function chip(symbol, text) {
    const ok = /^[A-Z0-9.\-]{1,10}$/.test(symbol);
    const a = el(ok ? "a" : "span", { className: "chip", textContent: text });
    if (ok) {
      a.href = "https://finviz.com/quote.ashx?t=" + encodeURIComponent(symbol);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    return a;
  }

  function section(title) {
    const wrap = el("div", { className: "rSec" });
    wrap.appendChild(el("h3", { textContent: title }));
    const box = el("div");
    wrap.appendChild(box);
    view.appendChild(wrap);
    return box;
  }
  function none(box, text) { box.appendChild(el("div", { className: "none", textContent: text })); }

  // ----- 화면 그리기 -----
  function render(d) {
    view.textContent = "";
    view.appendChild(el("div", { id: "reportMsg" }));

    // 데이터가 오래됐으면 경고
    const ageDays = d.updated ? (Date.now() - new Date(d.updated).getTime()) / 86400000 : 0;
    if (ageDays >= 3) {
      view.appendChild(el("div", { className: "note warn", textContent: "⚠️ 리포트가 " + Math.floor(ageDays) + "일 전 데이터예요. 파이썬 스크립트가 돌고 있는지 확인하세요." }));
    }

    // 시장 심리 + 공포 N일째 통계
    let box = section("시장 심리");
    if (d.sentiment) {
      const big = el("div", { className: "rBig", textContent: String(Math.round(d.sentiment.score)) });
      big.style.color = colorOf(d.sentiment.score);
      const sub = el("div", { className: "rSub", textContent: d.sentiment.label + (d.fearStats ? " · 공포 " + d.fearStats.streak + "일째" : "") });
      sub.style.color = colorOf(d.sentiment.score);
      box.appendChild(big); box.appendChild(sub);
    } else {
      none(box, "데이터를 가져오지 못했어요");
    }
    if (d.fearStats) {
      const fs = d.fearStats;
      Object.keys(fs.results).forEach((h) => {
        const r = fs.results[h], bs = fs.base[h] || {};
        const row = el("div", { className: "rRow" });
        row.appendChild(el("div", { className: "rL", innerHTML: "" }));
        row.firstChild.textContent = h + "일 후";
        row.firstChild.appendChild(el("small", { textContent: "승률 " + winTxt(r.win) + " · " + r.n + "회 · 전체 평균 " + pctTxt(bs.mean) }));
        const rr = el("div", { className: "rR " + (r.mean >= 0 ? "up" : "down"), textContent: pctTxt(r.mean) });
        rr.appendChild(el("small", { textContent: "평균 수익률" }));
        row.appendChild(rr);
        box.appendChild(row);
      });
      box.appendChild(el("div", { className: "note", textContent: "공포 구간이 같은 일수만큼 이어졌던 과거에 SPY를 샀다면 이후 수익률이에요.\n" + String(fs.text || "").split("\n").slice(1).join("\n") }));
    } else if (d.sentiment) {
      box.appendChild(el("div", { className: "note", textContent: "지금은 공포 구간이 아니라 과거 통계를 건너뛰었어요." }));
    }

    // 거시경제
    box = section("거시경제");
    if (d.macro) d.macro.lines.forEach((t) => {
      if (/^🚨|^✅|종합/.test(t)) { box.appendChild(el("div", { className: "rBanner " + (/🚨|비우호/.test(t) ? "bad" : ""), textContent: t.replace(/^🚨\s*/, "🚨 ") })); return; }
      const i = t.lastIndexOf(" · ");
      const row = el("div", { className: "rRow" });
      row.appendChild(el("div", { className: "rL", textContent: i > 0 ? t.slice(0, i) : t }));
      if (i > 0) { const st = t.slice(i + 3); row.appendChild(el("span", { className: "rTag " + (/⚠️|위험|우려/.test(st) ? "bad" : /안정|양호/.test(st) ? "ok" : ""), textContent: st.replace("⚠️ ", "") })); }
      box.appendChild(row);
    });
    else none(box, "데이터를 가져오지 못했어요");

    // 경기 방어주
    box = section("경기 방어주");
    if (d.strong == null) none(box, "데이터를 가져오지 못했어요");
    else if (!d.strong.length) none(box, "조건 부합 종목 없음");
    else d.strong.forEach((s) => {
      const row = el("div", { className: "rRow" });
      const l = el("a", { className: "rL", textContent: s.symbol }); l.style.color = "var(--accent2)"; l.style.textDecoration = "none";
      if (/^[A-Z0-9.\-]{1,10}$/.test(s.symbol)) { l.href = "https://finviz.com/quote.ashx?t=" + encodeURIComponent(s.symbol); l.target = "_blank"; l.rel = "noopener noreferrer"; }
      const m = /(\d+개월)\s*([+\-][\d.]+%)/.exec(s.text || "");
      const rr = el("div", { className: "rR " + (m && m[2][0] === "-" ? "down" : "up"), textContent: m ? m[2] : s.text });
      if (m) rr.appendChild(el("small", { textContent: m[1] + " 수익률" }));
      row.appendChild(l); row.appendChild(rr); box.appendChild(row);
    });

    // 저평가 후보
    box = section("저평가 후보");
    if (d.value == null) none(box, "데이터를 가져오지 못했어요");
    else if (!d.value.items.length) none(box, "조건 부합 종목 없음");
    else {
      const c = el("div", { className: "chips" });
      d.value.items.forEach((s) => c.appendChild(chip(s.symbol, s.symbol + (s.star ? " ★" : ""))));
      box.appendChild(c);
      box.appendChild(el("div", { className: "note", textContent: "조건 통과 " + d.value.total + "종목 중 상위. ★ = 52주 고점 대비 40% 이상 하락" }));
    }

    // 내부자 매수
    box = section("관심종목 내부자 매수");
    if (!d.insider || !d.insider.length) none(box, "해당 없음");
    else d.insider.forEach((t) => box.appendChild(el("div", { className: "line", textContent: t })));

    // 주봉 하이킨아시 (월요일만)
    box = section("주봉 하이킨아시 양봉 전환");
    if (d.weeklyHA == null) none(box, "월요일 리포트에서만 계산돼요");
    else {
      if (!d.weeklyHA.items.length) none(box, "조건 부합 종목 없음");
      else { const c = el("div", { className: "chips" }); d.weeklyHA.items.forEach((t) => c.appendChild(el("span", { className: "chip", textContent: t }))); box.appendChild(c); }
      if (d.weeklyHA.failed) box.appendChild(el("div", { className: "note", textContent: "조회 실패 " + d.weeklyHA.failed + "종목 제외" }));
    }

    // 오늘 실적 발표
    box = section("오늘 실적 발표");
    if (!d.earnings || !d.earnings.length) none(box, "일정 없음");
    else { const c = el("div", { className: "chips" }); d.earnings.forEach((t) => c.appendChild(el("span", { className: "chip", textContent: t }))); box.appendChild(c); }

    view.appendChild(el("div", { className: "note", textContent: "기준 " + (d.updated ? new Date(d.updated).toLocaleString("ko-KR") : "-") + " · 투자 판단의 참고용이며 스크립트가 실행될 때만 갱신돼요." }));
    const msg = document.getElementById("reportMsg");
    if (msg) msg.remove();
  }

  async function load() {
    view.textContent = "";
    view.appendChild(el("div", { id: "reportMsg", textContent: "불러오는 중..." }));
    try {
      const res = await fetch(REPORT_URL + (REPORT_URL.includes("?") ? "&" : "?") + "t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("report.json을 찾을 수 없어요 (" + res.status + "). 파이썬이 한 번 실행돼서 저장소에 올라가야 해요.");
      render(await res.json());
    } catch (e) {
      view.textContent = "";
      view.appendChild(el("div", { id: "reportMsg", textContent: "불러오기 실패: " + e.message }));
      loaded = false; // 탭을 다시 누르면 재시도
    }
  }

  if (location.hash === "#report") showReport();
})();
