/* 聚光燈 QA 工具 — docx 原文 ↔ 實際渲染(真 LessonRenderer)對照。file:// 可用。
   右欄上:iframe staging /learn/{story_id}/reading-strategy(真 StrategyExercisePage → LessonRenderer;需先在 staging 登入)
   右欄下:區塊清單(逐 block 🚩 標記 / 標籤 / 備註),findings 綁 block.id。 */
(function () {
  "use strict";

  const LESSONS = window.LESSONS || [];
  const TOOL_VERSION = 2; // v2: block-based(重構後);findings 綁 block_id,localStorage 換 namespace
  const NS = "spotlight-qa2:";
  const LIVE_BASE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app";
  // 右欄改指 staging 真學習頁 /learn/{story_id}/reading-strategy(放棄 /dev/lesson);render base 預設 = staging
  const DEFAULT_BASE = LIVE_BASE;
  // 真原稿 worksheet 由前端 hosting 提供(public);GCS raw url 是 403,不要用。
  const WS_HOST = "https://lingoleap-dev.web.app";

  // ---- 環境自適應(file:// 本機工作台 vs http staging 部署) ----
  const IS_HTTP = location.protocol === "http:" || location.protocol === "https:";
  // 遠端 hosting(*.run.app / *.web.app):worksheet 原稿走 WS_HOST(其 CSP 允許 *.run.app 內嵌)
  const IS_REMOTE = /\.(run|web)\.app$/.test(location.hostname);
  // 後端 API base(比照 testset record.html:apiBase):打對應環境後端存/載 QA JSON
  function apiBase() {
    const h = location.hostname;
    if (h.indexOf("-frontend-") > -1)
      return location.origin.replace("-frontend-", "-backend-");
    if (h === "localhost" || h === "127.0.0.1") return "http://localhost:8000";
    if (/\.web\.app$/.test(h)) return ""; // Firebase 有 /api rewrite,用相對路徑
    return "https://lingoleap-backend-staging-958347263320.asia-east1.run.app";
  }
  const API = apiBase();
  // render iframe base:部署在 staging 同源(IS_REMOTE)→ 用同源;否則(file:// / 本機 http.server)吃輸入框(預設 staging)
  function renderBase() {
    return IS_REMOTE ? location.origin : baseUrl.replace(/\/+$/, "");
  }
  // worksheet PDF 來源:
  //  - 遠端部署(*.run.app / *.web.app)→ WS_HOST/assets(其 CSP 允許 *.run.app 內嵌)
  //  - file:// 本機工作台 → 本機 worksheets/(build.sh 轉好的)
  //  - http localhost → 不可得(dev-hosting CSP 擋 localhost,且 worksheets 未進 public)→ 回 "" 走結構化文字
  function worksheetPdfSrc(L) {
    if (IS_REMOTE) return `${WS_HOST}/assets/worksheets/${L.dev_code}.pdf#view=FitH`;
    if (!IS_HTTP) return L.local_pdf ? L.local_pdf + "#view=FitH" : "";
    return "";
  }

  // 問題標籤: 穩定英文 key ↔ 中文顯示(對照 docx vs 渲染的保真檢查導向)。
  const ISSUE_TAGS = [
    ["render_mismatch", "渲染與原文不符"],
    ["missing_content", "內容缺漏(漏段/題/表)"],
    ["extra_content", "多出原文沒有的內容"],
    ["wrong_placement", "圖表位置錯(左右欄)"],
    ["table_broken", "表格/重點表結構壞"],
    ["image_broken", "圖片破圖/缺圖"],
    ["wrong_answer", "答案標錯"],
    ["should_be_multi_select", "應為複選(被降級)"],
    ["prompt_noise", "prompt 含雜訊"],
    ["other", "其他"],
  ];

  // ---- state ----
  let current = 0;
  let reviewer = localStorage.getItem(NS + "reviewer") || ""; // 預設空白,審查者需自行填名
  let baseUrl = localStorage.getItem(NS + "baseUrl") || DEFAULT_BASE;
  // 舊本機 dev server 值(任何 localhost / 127.0.0.1 形式,含尾斜線)一律遷到 staging,並清乾淨 localStorage。
  if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
    baseUrl = DEFAULT_BASE;
    localStorage.setItem(NS + "baseUrl", baseUrl);
  }
  let leftView = localStorage.getItem(NS + "leftView") || "pdf"; // 'pdf' 原稿 PDF | 'text' 結構化
  if (leftView === "doc") leftView = "pdf"; // 舊值遷移
  // http localhost 原稿 PDF 不可得(見 worksheetPdfSrc)→ 預設結構化文字,免載到 SPA fallback
  if (leftView === "pdf" && location.protocol.startsWith("http") && !/\.(run|web)\.app$/.test(location.hostname))
    leftView = "text";
  let renderCollapsed = localStorage.getItem(NS + "renderCollapsed") === "1";
  let checklistCollapsed = (localStorage.getItem(NS + "checklistCollapsed") ?? "1") === "1"; // 預設收起,省空間
  let overviewMode = false;
  let ovFilter = localStorage.getItem(NS + "ovFilter") || "all";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  function blankReview() {
    return { status: "pending", lesson_note: "", findings: {}, annotations: [] };
  }
  function key(code) {
    return NS + code;
  }
  function loadReview(code) {
    try {
      const raw = localStorage.getItem(key(code));
      if (raw) return Object.assign(blankReview(), JSON.parse(raw));
    } catch (e) {}
    return blankReview();
  }
  function saveReview(code, r) {
    localStorage.setItem(key(code), JSON.stringify(r));
  }

  let review = blankReview();
  function lesson() {
    return LESSONS[current];
  }
  function finding(bid) {
    if (!review.findings[bid])
      review.findings[bid] = { has_issue: false, tags: [], note: "", steps: {} };
    if (!review.findings[bid].steps) review.findings[bid].steps = {};
    return review.findings[bid];
  }
  function stepFinding(bid, i) {
    const f = finding(bid);
    if (!f.steps[i]) f.steps[i] = { has_issue: false, tags: [], note: "" };
    return f.steps[i];
  }
  function persist() {
    saveReview(lesson().lesson_code, review);
    renderTabs();
    renderProgress();
  }

  function flagCount(f) {
    return (f.has_issue ? 1 : 0) +
      Object.values(f.steps || {}).filter((s) => s.has_issue).length;
  }
  function lessonHasIssue(r) {
    if (!r) return false;
    const f = Object.values(r.findings || {}).some((x) => flagCount(x) > 0);
    return f || (r.annotations || []).length > 0;
  }

  // ================= RENDER =================
  function buildLessonSelect() {
    const sel = $("lessonSelect");
    sel.innerHTML = "";
    let curGrade = null,
      og = null;
    LESSONS.forEach((L, i) => {
      if (L.grade !== curGrade) {
        curGrade = L.grade;
        og = document.createElement("optgroup");
        og.label = curGrade;
        sel.appendChild(og);
      }
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${L.lesson_code}${L.title ? "　" + L.title : ""}`;
      og.appendChild(o);
    });
    sel.onchange = () => goto(Number(sel.value));
  }
  function renderTabs() {
    // 課數多,改用下拉;這裡只把目前課同步到下拉
    const sel = $("lessonSelect");
    if (sel) sel.value = String(current);
  }

  function renderProgress() {
    let reviewed = 0,
      issues = 0;
    LESSONS.forEach((L, i) => {
      const r = i === current ? review : loadReview(L.lesson_code);
      if (r.status === "reviewed") reviewed++;
      issues += Object.values(r.findings || {}).reduce((n, x) => n + flagCount(x), 0);
      issues += (r.annotations || []).length;
    });
    $("progress").innerHTML =
      `已審 <b>${reviewed}/${LESSONS.length}</b> · <span class="iss">${issues}</span> 個標記`;
  }

  function highlight(text, q) {
    const e = esc(text);
    if (!q) return e;
    try {
      const re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      return e.replace(re, "<mark>$1</mark>");
    } catch (x) {
      return e;
    }
  }

  function renderTable(t, q) {
    const headers = t.headers || [];
    const rows = t.rows || [];
    const hasSection = rows.some((r) => r && !Array.isArray(r) && "section" in r);
    // 計算同 section 連續列數,做 section 欄 rowspan(近似合併儲存格)
    const spans = [];
    if (hasSection) {
      let i = 0;
      while (i < rows.length) {
        const sec = rows[i].section;
        let j = i;
        while (j < rows.length && rows[j].section === sec) j++;
        spans[i] = j - i;
        i = j;
      }
    }
    let h = '<table class="rd-table">';
    if (t.title) h += `<caption>${highlight(t.title, q)}</caption>`;
    if (headers.length) {
      h += "<thead><tr>";
      if (hasSection) h += `<th>${esc(t.section_label_col || "")}</th>`;
      headers.forEach((hd) => (h += `<th>${highlight(hd, q)}</th>`));
      h += "</tr></thead>";
    }
    h += "<tbody>";
    rows.forEach((r, idx) => {
      const cells = Array.isArray(r) ? r : r.cells || [];
      h += "<tr>";
      if (hasSection && spans[idx])
        h += `<td class="sec" rowspan="${spans[idx]}">${highlight(r.section || "", q)}</td>`;
      cells.forEach((c) => (h += `<td>${highlight(c, q)}</td>`));
      h += "</tr>";
    });
    h += "</tbody></table>";
    return h;
  }

  function renderReader(L, q) {
    const out = [];
    const paras = L.paragraphs || [];
    const imgs = L.images || [];
    const tables = L.tables || [];
    const mcq = L.multiple_choice || [];

    if (paras.length) {
      out.push('<div class="rd-sec">課文段落</div>');
      paras.forEach((p, i) => out.push(`<div class="rd-p">${i + 1}. ${highlight(p, q)}</div>`));
    }
    if (imgs.length) {
      out.push('<div class="rd-sec">圖 (figure)</div>');
      imgs.forEach((im) => {
        const cap = im.caption || "";
        out.push(
          `<div class="rd-fig"><span class="lbl">${esc(im.figure_label || "圖")}</span>` +
            (cap ? ` <span class="cap">${highlight(cap, q)}</span>` : "") +
            `<div class="missing">🖼 ${esc(im.filename || "")}（圖片需 GCS 權限，此處僅列標題/說明）</div></div>`
        );
      });
    }
    if (tables.length) {
      out.push('<div class="rd-sec">表 (table)</div>');
      tables.forEach((t) => out.push(renderTable(t, q)));
    }
    if (mcq.length) {
      out.push('<div class="rd-sec">選擇題 (multiple_choice)</div>');
      mcq.forEach((m) => {
        const opts = (m.options || [])
          .map((o, i) => {
            const letter = String.fromCharCode(65 + i);
            const correct = String(m.answer).toUpperCase() === letter;
            return `<div class="opt${correct ? " correct" : ""}">${letter}. ${highlight(o, q)}${
              correct ? " ✓" : ""
            }</div>`;
          })
          .join("");
        out.push(`<div class="rd-mcq"><div class="q">${highlight(m.question || "", q)}</div>${opts}</div>`);
      });
    }
    if (!out.length)
      out.push(
        '<div class="rd-p" style="color:var(--muted)">(此課解析無結構化段落/表格;請看下方「聚光燈原文」與「課文全文」)</div>'
      );
    $("reader").innerHTML = out.join("");
  }

  function applyLeftView(L) {
    const wantPdf = leftView === "pdf";
    $("viewPdf").classList.toggle("active", wantPdf);
    $("viewText").classList.toggle("active", !wantPdf);
    $("wsWrap").style.display = wantPdf ? "block" : "none";
    $("reader").style.display = wantPdf ? "none" : "block";
    if (!wantPdf) return;
    const pdf = $("wsPdf");
    const hint = $("wsHint");
    const src = worksheetPdfSrc(L);
    if (src) {
      pdf.style.display = "block";
      hint.style.display = "none";
      if (pdf.getAttribute("src") !== src) pdf.src = src;
    } else {
      pdf.style.display = "none";
      pdf.removeAttribute("src");
      hint.style.display = "block";
      hint.innerHTML =
        "本機 localhost 無法內嵌原稿 PDF(dev-hosting CSP 限制 + worksheets 未進 public)。" +
        "請用「📝 結構化文字」對照;<b>部署到 staging 後原稿 PDF 會正常顯示</b>(改抓線上原稿)。" +
        "file:// 版則用 <code>bash build.sh</code> 轉好的本機 PDF。";
    }
  }

  function renderLeft() {
    const L = lesson();
    const q = $("search").value.trim();
    applyLeftView(L);
    renderReader(L, q);
    const parts = [];
    if ((L.paragraphs || []).length) parts.push(`段 ${L.paragraphs.length}`);
    if ((L.tables || []).length) parts.push(`表 ${L.tables.length}`);
    if ((L.images || []).length) parts.push(`圖 ${L.images.length}`);
    if ((L.multiple_choice || []).length) parts.push(`選 ${L.multiple_choice.length}`);
    $("rawMeta").textContent = parts.join(" · ");
    $("rawText").innerHTML = highlight(L.spotlight_raw_text || "(無原文)", q);
    $("storyText").innerHTML = highlight(L.story_text || "(無全文)", q);

    const ans = L.spotlight_answers || [];
    $("answersFold").style.display = ans.length ? "" : "none";
    $("answersBody").innerHTML = ans
      .map(
        (a) =>
          `<div class="ans-item"><span class="ans">${esc(a.answer)}</span>` +
          `<div class="ctx">…${esc(a.context_before || "")}<b>【${esc(a.answer)}】</b>${esc(
            a.context_after || ""
          )}…</div></div>`
      )
      .join("");

    renderRawAnnos();
    $("docxView").innerHTML = "";
    $("docxStatus").textContent = "";
    const emb = $("pdfEmbed");
    emb.style.display = "none";
    emb.removeAttribute("src");
  }

  function renderRawAnnos() {
    let box = $("rawAnnos");
    if (!box) {
      box = document.createElement("div");
      box.id = "rawAnnos";
      box.className = "annos";
      $("rawText").after(box);
    }
    const list = review.annotations.filter((a) => a.scope === "raw_text");
    box.innerHTML = list.length
      ? `<div class="col-head" style="margin:8px 0 6px">原文標註 (${list.length})</div>` +
        list.map((a) => annoHtml(a)).join("")
      : "";
    bindAnnoDelete(box);
  }

  function annoHtml(a) {
    return (
      `<div class="anno"><button class="del" data-id="${a.id}">✕</button>` +
      `<span class="q">「${esc(a.quote)}」</span>` +
      (a.note ? `<div>${esc(a.note)}</div>` : "") +
      `</div>`
    );
  }
  function bindAnnoDelete(scopeEl) {
    scopeEl.querySelectorAll(".anno .del").forEach((btn) => {
      btn.onclick = () => {
        review.annotations = review.annotations.filter((a) => a.id !== btn.dataset.id);
        persist();
        renderRawAnnos();
        renderCards();
      };
    });
  }

  function renderHeader() {
    const L = lesson();
    // 這幾個是已從精簡單行 bar 移除的元件(資訊已在別處顯示),存在才設,避免 null。
    const setHtml = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
    const setHref = (id, href) => { const el = $(id); if (el) el.href = href; };
    setHtml("strategy", `<span class="badge">${esc(L.lesson_code)}</span>${esc(L.strategy_name || "")}`);
    setHtml("lessonMeta",
      `${esc(L.title || "")}　<strong>${L.block_count}</strong> blocks` +
      ` (段 ${L.paragraph_count} / 題 ${L.exercise_count} / 圖 ${L.figure_count} / 表 ${L.table_count})`);
    $("blocksMeta").textContent = L.fixture_found
      ? `${(L.checklist || []).length} 項可審`
      : "⚠ 缺 fixture,無審查清單";
    // 用前端 hosting 的 public 原稿(GCS raw url 403);dev_code 已是正規化課號
    setHref("docxLink", `${WS_HOST}/assets/worksheets/${L.dev_code}.docx`);
    setHref("liveLink", L.story_id ? `${LIVE_BASE}/learn/${L.story_id}/reading-strategy` : "#");
    $("prevBtn").disabled = current === 0;
    $("nextBtn").disabled = current === LESSONS.length - 1;
    $("lessonReviewed").checked = review.status === "reviewed";
    $("lessonNote").value = review.lesson_note || "";
  }

  // ---- iframe (real render on staging) ----
  function devUrl() {
    const id = lesson().story_id;
    return id ? `${renderBase()}/learn/${id}/reading-strategy` : "about:blank";
  }
  function renderFrame() {
    const url = devUrl();
    $("renderFrame").src = url;
    $("openFrame").href = url;
    const hint = $("frameHint");
    if (!lesson().story_id) {
      hint.classList.add("show");
      hint.querySelector("div").textContent = `本課解析不到 story_id,無法在 staging 開啟渲染(${lesson().lesson_code})。`;
    } else {
      hint.classList.remove("show");
    }
    $("hintBase").textContent = renderBase();
  }

  function renderCards() {
    const L = lesson();
    const wrap = $("cards");
    wrap.innerHTML = "";
    const list = L.checklist || [];
    if (!list.length) {
      wrap.innerHTML = `<div class="empty">此課無可審項目(題 / 圖 / 表)。</div>`;
      return;
    }
    list.forEach((blk) => wrap.appendChild(cardEl(blk)));
  }

  // ---- 自動預檢:回傳 [{step:idx|null, code, msg}] ----
  const PF_TAG = {
    needs_review: "other",
    figure_no_asset: "image_broken",
    table_empty: "table_broken",
    keypoints_blank_gap: "table_broken",
    missing_ref_answer: "missing_content",
    no_marked_answer: "wrong_answer",
    too_few_options: "missing_content",
    multi_select_lt2: "should_be_multi_select",
  };
  function preflight(block) {
    const out = [];
    if (!block) return out;
    if (block.needs_review) out.push({ step: null, code: "needs_review", msg: "標為需人工檢核" });
    if (block.type === "figure" && !block.asset)
      out.push({ step: null, code: "figure_no_asset", msg: "圖無 asset 檔" });
    if (block.type === "table" && !(block.rows && block.rows.length))
      out.push({ step: null, code: "table_empty", msg: "表無列" });
    if (block.type === "exercise") {
      const q = block.question || {};
      if (q.kind === "keypoints_table") {
        const blanks = q.blanks || [];
        const ids = new Set(blanks.map((b) => b.id));
        blanks.forEach((b) => {
          if (!(b.answer != null && String(b.answer).trim()))
            out.push({ step: null, code: "keypoints_blank_gap", msg: `空格 ${b.id} 無答案` });
        });
        (q.rows || []).forEach((r, ri) =>
          (r.blank_ids || []).forEach((bid) => {
            if (!ids.has(bid))
              out.push({ step: null, code: "keypoints_blank_gap", msg: `第 ${ri + 1} 列參照到不存在的空格 ${bid}` });
          })
        );
      } else {
        (q.steps || []).forEach((s, i) => {
          if (s.type === "free_text") {
            if (!(s.reference_answer != null && String(s.reference_answer).trim()))
              out.push({ step: i, code: "missing_ref_answer", msg: "free_text 無參考答案" });
          } else if (s.type === "multi_select") {
            const a = Array.isArray(s.answer) ? s.answer : s.answer != null ? [s.answer] : [];
            if (a.length < 2) out.push({ step: i, code: "multi_select_lt2", msg: "複選正解 < 2" });
          } else if (s.type === "select") {
            if (s.answer == null) out.push({ step: i, code: "no_marked_answer", msg: "選擇題無標記正解" });
            if ((s.options || []).length < 2) out.push({ step: i, code: "too_few_options", msg: "選項 < 2" });
          }
        });
      }
    }
    return out;
  }

  // ---- 對齊/跳轉:PDF #search(worksheet 含題目原文;Chromium 支援);無 PDF 退回文字高亮 ----
  function jumpKeyword(text) {
    return String(text || "")
      .replace(/[【】〔〕（）()［］\[\]「」『』？?！!、，,。.：:；;～~　\s0-9❶❷❸❹]/g, "")
      .slice(0, 12);
  }
  function jumpTo(text) {
    const kw = jumpKeyword(text);
    if (!kw) return;
    const L = lesson();
    const pdfBase = worksheetPdfSrc(L).split("#")[0];
    if (pdfBase) {
      leftView = "pdf";
      localStorage.setItem(NS + "leftView", "pdf");
      $("viewPdf").classList.add("active");
      $("viewText").classList.remove("active");
      $("wsWrap").style.display = "block";
      $("reader").style.display = "none";
      $("wsHint").style.display = "none";
      const emb = $("wsPdf");
      emb.style.display = "block";
      emb.src = pdfBase + "#search=" + encodeURIComponent(kw);
    } else {
      setLeftView("text");
      $("search").value = kw;
      renderLeft();
      setTimeout(() => {
        const m = document.querySelector("#reader mark");
        if (m) m.scrollIntoView({ block: "center" });
      }, 40);
    }
  }

  // ---- 內容渲染 ----
  function optsHtml(step) {
    const type = step.type;
    if (type === "select" || type === "multi_select") {
      const ans = Array.isArray(step.answer) ? step.answer : step.answer != null ? [step.answer] : [];
      return (
        `<div class="s-opts">` +
        (step.options || [])
          .map((o, oi) => {
            const ok = ans.includes(oi);
            return `<div class="s-opt${ok ? " correct" : ""}"><span class="s-letter">${String.fromCharCode(
              65 + oi
            )}.</span>${esc(o)}${ok ? " ✓" : ""}</div>`;
          })
          .join("") +
        `</div>`
      );
    }
    const ref = step.reference_answer;
    return ref && String(ref).trim()
      ? `<div class="s-ref">正解:${esc(ref)}</div>`
      : `<div class="s-ref none">(無參考答案)</div>`;
  }

  function pfWarnHtml(arr) {
    return arr.length
      ? `<div class="pf-list">` +
          arr
            .map(
              (w) =>
                `<div class="pf">⚠ ${esc(w.msg)} <button class="pf-adopt" data-code="${w.code}" data-step="${
                  w.step == null ? "" : w.step
                }">採納為標記</button></div>`
            )
            .join("") +
          `</div>`
      : "";
  }

  function contentHtml(block, bid, pf) {
    if (!block) return `<div class="c-empty">(無 block 資料)</div>`;
    const pfByStep = {};
    const pfBlock = [];
    pf.forEach((w) => {
      if (w.step == null) pfBlock.push(w);
      else (pfByStep[w.step] = pfByStep[w.step] || []).push(w);
    });
    let html = pfWarnHtml(pfBlock);

    if (block.type === "exercise") {
      const q = block.question || {};
      if (q.instruction) html += `<div class="c-instr">${esc(q.instruction)}</div>`;
      if (q.kind === "keypoints_table") {
        const bmap = {};
        (q.blanks || []).forEach((b) => (bmap[b.id] = b.answer));
        html +=
          `<table class="c-kp"><tbody>` +
          (q.rows || [])
            .map((r) => {
              const ans = (r.blank_ids || []).map((id) => (bmap[id] != null ? bmap[id] : "—")).join(" / ");
              return `<tr><td>${esc(r.label)}</td><td class="c-ans">${esc(ans)}</td></tr>`;
            })
            .join("") +
          `</tbody></table>`;
      } else {
        let lastSec = null;
        (q.steps || []).forEach((s, i) => {
          if (s.section && s.section !== lastSec) {
            lastSec = s.section;
            html += `<div class="c-sec">${esc(s.section)}</div>`;
          }
          const bf = review.findings[bid];
          const sf = (bf && bf.steps && bf.steps[i]) || { has_issue: false, tags: [], note: "" };
          const chips = ISSUE_TAGS.map(
            ([k, label]) => `<button class="chip${sf.tags.includes(k) ? " on" : ""}" data-tag="${k}">${esc(label)}</button>`
          ).join("");
          html +=
            `<div class="step-row${sf.has_issue ? " flagged" : ""}" data-step="${i}">` +
            `<div class="s-head"><span class="s-ix">${i + 1}</span>` +
            `<span class="s-prompt">${esc(s.prompt)}</span>` +
            `<button class="s-jump" title="到左欄原稿找這題">⇤</button>` +
            `<label class="flag-toggle sm"><input type="checkbox" class="s-chk"${sf.has_issue ? " checked" : ""}> 🚩</label></div>` +
            optsHtml(s) +
            pfWarnHtml(pfByStep[i] || []) +
            `<div class="s-review${sf.has_issue ? " show" : ""}"><div class="chips">${chips}</div>` +
            `<textarea class="s-note" placeholder="這一步哪裡不對？">${esc(sf.note)}</textarea></div>` +
            `</div>`;
        });
      }
    } else if (block.type === "figure") {
      html +=
        `<div class="c-fig"><b>${esc(block.label || "圖")}</b>` +
        (block.caption ? ` — ${esc(block.caption)}` : "") +
        `<div class="c-meta">asset:${esc(block.asset || "(無)")}　placement:${
          block.placement === "exercise" ? "右欄" : "左欄"
        }</div><div class="c-meta">(圖檔 GCS-gated,此處僅列說明)</div></div>`;
    } else if (block.type === "table") {
      html += (block.title ? `<div class="c-sec">${esc(block.title)}</div>` : "") + renderTable(block, "");
    }
    return html;
  }

  function anyStepFlagged(bid) {
    const f = review.findings[bid];
    return !!(f && f.steps && Object.values(f.steps).some((s) => s.has_issue));
  }
  function toggleTag(targetFinding, chipEl, chkEl, rowEl, reviewEl, onFlag) {
    const t = chipEl.dataset.tag;
    if (targetFinding.tags.includes(t)) targetFinding.tags = targetFinding.tags.filter((x) => x !== t);
    else targetFinding.tags.push(t);
    if (!targetFinding.has_issue) {
      targetFinding.has_issue = true;
      if (chkEl) chkEl.checked = true;
      rowEl.classList.add("flagged");
      if (reviewEl) reviewEl.classList.add("show");
      if (onFlag) onFlag();
    }
    chipEl.classList.toggle("on");
    persist();
  }

  function cardEl(blk) {
    const bid = blk.block_id;
    const block = (lesson().blocks || [])[blk.index] || null;
    const pf = preflight(block);
    const f = review.findings[bid] || { has_issue: false, tags: [], note: "", steps: {} };
    const stepFlagN = Object.values(f.steps || {}).filter((s) => s.has_issue).length;
    // exercise(主審對象)預設展開;figure/table 收合,除非有預檢警示或已標記
    const autoOpen = blk.type === "exercise" || pf.length > 0 || f.has_issue || stepFlagN > 0;

    const card = document.createElement("div");
    card.className = "card" + (f.has_issue || stepFlagN ? " flagged" : "");
    card.dataset.block = bid;
    card.dataset.idx = blk.index;

    const badge = `<span class="type-badge ${esc(blk.type)}">${esc(
      blk.kind ? blk.type + "·" + blk.kind : blk.type
    )}</span>`;
    const nr = blk.needs_review ? `<span class="type-badge nr">需人工檢核</span>` : "";
    const pfBadge = pf.length ? `<span class="pf-count">⚠ ${pf.length}</span>` : "";
    const chips = ISSUE_TAGS.map(
      ([k, label]) => `<button class="chip${f.tags.includes(k) ? " on" : ""}" data-tag="${k}">${esc(label)}</button>`
    ).join("");
    const stepAnnos = review.annotations.filter((a) => a.scope === "block" && a.block_id === bid);

    card.innerHTML =
      `<div class="card-top">` +
      `<span class="expand-caret">${autoOpen ? "▾" : "▸"}</span>` +
      `<span class="blk-no">#${blk.index}</span>${badge}${nr}${pfBadge}` +
      `<span class="blk-summary">${esc(blk.summary)}</span>` +
      `<button class="s-jump card-jump" title="到左欄原稿找這題">⇤</button>` +
      `<label class="flag-toggle flagchk-inline"><input type="checkbox" class="flagchk"${f.has_issue ? " checked" : ""}> 🚩</label>` +
      `</div>` +
      `<div class="content${autoOpen ? " show" : ""}">${contentHtml(block, bid, pf)}</div>` +
      `<div class="review${f.has_issue ? " show" : ""}">` +
      `<div class="chips">${chips}</div>` +
      `<textarea class="note-box" placeholder="整題性問題（與 docx 不符 / 渲染錯 / 漏題…）">${esc(f.note)}</textarea>` +
      `<div class="annos">${stepAnnos.map((a) => annoHtml(a)).join("")}</div>` +
      `</div>`;

    const caret = card.querySelector(".expand-caret");
    const contentBox = card.querySelector(".content");
    card.querySelector(".card-top").onclick = (e) => {
      if (e.target.closest(".flag-toggle, .s-jump, .flagchk")) return;
      const open = contentBox.classList.toggle("show");
      caret.textContent = open ? "▾" : "▸";
    };

    const chk = card.querySelector(".flagchk");
    const reviewBox = card.querySelector(":scope > .review");
    const noteBox = reviewBox.querySelector(".note-box");
    chk.onchange = () => {
      const ff = finding(bid);
      ff.has_issue = chk.checked;
      card.classList.toggle("flagged", chk.checked || anyStepFlagged(bid));
      reviewBox.classList.toggle("show", chk.checked);
      persist();
    };
    reviewBox.querySelectorAll(".chip").forEach((c) => {
      c.onclick = () => toggleTag(finding(bid), c, chk, card, reviewBox);
    });
    noteBox.oninput = () => {
      finding(bid).note = noteBox.value;
      saveReview(lesson().lesson_code, review);
    };

    card.querySelector(".card-jump").onclick = (e) => {
      e.stopPropagation();
      const b = block;
      let key = blk.summary;
      if (b && b.type === "exercise") {
        const st = b.question && b.question.steps && b.question.steps[0];
        key = (st && st.prompt) || (b.question && b.question.title) || blk.summary;
      } else if (b) {
        key = b.caption || b.title || b.label || blk.summary;
      }
      jumpTo(key);
    };

    card.querySelectorAll(".step-row").forEach((row) => {
      const i = Number(row.dataset.step);
      const schk = row.querySelector(".s-chk");
      const sReview = row.querySelector(".s-review");
      const sNote = row.querySelector(".s-note");
      const stepObj = ((block.question || {}).steps || [])[i] || {};
      schk.onchange = () => {
        const sf = stepFinding(bid, i);
        sf.has_issue = schk.checked;
        row.classList.toggle("flagged", schk.checked);
        sReview.classList.toggle("show", schk.checked);
        card.classList.toggle("flagged", schk.checked || chk.checked || anyStepFlagged(bid));
        persist();
      };
      row.querySelectorAll(".chip").forEach((c) => {
        c.onclick = () => toggleTag(stepFinding(bid, i), c, schk, row, sReview, () => card.classList.add("flagged"));
      });
      sNote.oninput = () => {
        stepFinding(bid, i).note = sNote.value;
        saveReview(lesson().lesson_code, review);
      };
      row.querySelector(".s-jump").onclick = (e) => {
        e.stopPropagation();
        jumpTo(stepObj.prompt || stepObj.section);
      };
    });

    card.querySelectorAll(".pf-adopt").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const tag = PF_TAG[btn.dataset.code] || "other";
        const stepStr = btn.dataset.step;
        const target = stepStr === "" ? finding(bid) : stepFinding(bid, Number(stepStr));
        target.has_issue = true;
        if (!target.tags.includes(tag)) target.tags.push(tag);
        persist();
        renderCards();
      };
    });

    bindAnnoDelete(card);
    return card;
  }

  // ================= NAV =================
  function goto(i) {
    if (i < 0 || i >= LESSONS.length) return;
    if (overviewMode) hideOverview();
    current = i;
    review = loadReview(lesson().lesson_code);
    localStorage.setItem(NS + "current", String(i));
    renderAll();
    $("cards").scrollTop = 0;
    document.querySelector(".col.left").scrollTop = 0;
    document.querySelector(".checklist-pane").scrollTop = 0;
  }

  function renderAll() {
    renderHeader();
    renderTabs();
    renderProgress();
    renderLeft();
    renderFrame();
    renderCards();
  }

  // ================= TEXT ANNOTATION =================
  let pending = null; // {quote, scope, block_id}
  const annoBtn = $("annoBtn");
  const annoPop = $("annoPop");

  document.addEventListener("mouseup", (e) => {
    if (annoPop.contains(e.target) || e.target === annoBtn) return;
    setTimeout(showAnnoBtn, 0);
  });
  document.addEventListener("scroll", () => (annoBtn.style.display = "none"), true);

  function showAnnoBtn() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      annoBtn.style.display = "none";
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      annoBtn.style.display = "none";
      return;
    }
    const node =
      sel.anchorNode && sel.anchorNode.nodeType === 3
        ? sel.anchorNode.parentElement
        : sel.anchorNode;
    if (!node || !(node instanceof Element)) return;
    const blockEl = node.closest("[data-block]");
    const rawEl = node.closest('[data-scope="raw_text"]');
    if (!blockEl && !rawEl) {
      annoBtn.style.display = "none";
      return;
    }
    pending = blockEl
      ? { quote: text, scope: "block", block_id: blockEl.dataset.block }
      : { quote: text, scope: "raw_text", block_id: null };
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    annoBtn.style.left = Math.max(8, rect.left + rect.width / 2 - 30) + "px";
    annoBtn.style.top = Math.max(8, rect.top - 34) + "px";
    annoBtn.style.display = "block";
  }

  annoBtn.onclick = () => {
    if (!pending) return;
    annoBtn.style.display = "none";
    $("annoQuote").textContent =
      "「" + pending.quote + "」" +
      (pending.scope === "block" ? `（block ${pending.block_id}）` : "（原文）");
    $("annoNote").value = "";
    annoPop.style.left = Math.min(window.innerWidth - 340, Number(parseInt(annoBtn.style.left))) + "px";
    annoPop.style.top = Math.min(window.innerHeight - 200, Number(parseInt(annoBtn.style.top)) + 10) + "px";
    annoPop.style.display = "block";
    $("annoNote").focus();
  };
  $("annoCancel").onclick = () => (annoPop.style.display = "none");
  $("annoSave").onclick = () => {
    if (!pending) return;
    review.annotations.push({
      id: "a" + Date.now() + Math.floor(performance.now()),
      scope: pending.scope,
      block_id: pending.block_id,
      quote: pending.quote,
      note: $("annoNote").value.trim(),
    });
    annoPop.style.display = "none";
    pending = null;
    persist();
    renderRawAnnos();
    renderCards();
  };

  // ================= docx 渲染(docx-preview 高保真;mammoth fallback) =================
  const hasDocxPreview = () =>
    !window.__noDocxPreview && typeof docx !== "undefined" && docx && typeof docx.renderAsync === "function";
  const hasMammoth = () => !window.__noMammoth && typeof mammoth !== "undefined";

  function renderDocx(arrayBuffer) {
    const view = $("docxView");
    view.innerHTML = "";
    if (hasDocxPreview()) {
      $("docxStatus").textContent = "渲染中(docx-preview 高保真)…";
      docx
        .renderAsync(arrayBuffer, view, null, {
          className: "dpx",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          experimental: true,
          useBase64URL: true,
        })
        .then(() => {
          $("docxStatus").textContent = "✓ 已渲染(docx-preview:表格/合併儲存格/圖片/版面保真)";
        })
        .catch((err) => {
          $("docxStatus").textContent = "docx-preview 失敗,改用 mammoth… " + err.message;
          renderDocxMammoth(arrayBuffer);
        });
      return;
    }
    renderDocxMammoth(arrayBuffer);
  }

  function renderDocxMammoth(arrayBuffer) {
    if (!hasMammoth()) {
      $("docxStatus").textContent = "docx 渲染引擎未載入(請重跑 bash build.sh,或改用上方連結開啟)。";
      return;
    }
    $("docxStatus").textContent = "渲染中(mammoth)…";
    mammoth
      .convertToHtml({ arrayBuffer })
      .then((res) => {
        $("docxView").innerHTML = res.value;
        $("docxStatus").textContent = "✓ 已渲染(mammoth:表格/合併儲存格僅近似)";
      })
      .catch((err) => {
        $("docxStatus").textContent = "渲染失敗: " + err.message;
      });
  }
  $("loadGcsDocx").onclick = () => {
    const url = lesson().worksheet_docx_url;
    if (!url) {
      $("docxStatus").textContent = "本課無 docx 連結。";
      return;
    }
    $("docxStatus").textContent = "下載中…";
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(renderDocx)
      .catch((err) => {
        $("docxStatus").innerHTML =
          "GCS 載入失敗(可能 CORS): " +
          esc(err.message) +
          `。請改<a href="${esc(url)}" target="_blank">開新分頁下載</a>後用「選擇本機 .docx」。`;
      });
  };
  $("docxFile").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => renderDocx(fr.result);
    fr.readAsArrayBuffer(file);
  };
  $("pdfFile").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const emb = $("pdfEmbed");
    if (emb.dataset.url) URL.revokeObjectURL(emb.dataset.url);
    const url = URL.createObjectURL(file);
    emb.dataset.url = url;
    emb.src = url;
    emb.style.display = "block";
    $("docxStatus").textContent = "✓ 已載入本機 PDF:" + file.name;
  };

  // ================= top controls =================
  $("prevBtn").onclick = () => goto(current - 1);
  $("nextBtn").onclick = () => goto(current + 1);
  $("search").oninput = renderLeft;
  $("reviewer").value = reviewer;
  $("reviewer").oninput = () => {
    reviewer = $("reviewer").value;
    localStorage.setItem(NS + "reviewer", reviewer);
  };
  $("baseUrl").value = baseUrl;
  $("baseUrl").onchange = () => {
    baseUrl = $("baseUrl").value.trim() || DEFAULT_BASE;
    localStorage.setItem(NS + "baseUrl", baseUrl);
    renderFrame();
  };
  function setLeftView(v) {
    leftView = v;
    localStorage.setItem(NS + "leftView", v);
    applyLeftView(lesson());
  }
  $("viewPdf").onclick = () => setLeftView("pdf");
  $("viewText").onclick = () => setLeftView("text");
  $("reloadFrame").onclick = () => {
    // 重設 src 強制 reload(cross-origin 下不能碰 contentWindow)
    $("renderFrame").src = "about:blank";
    setTimeout(renderFrame, 30);
  };
  function applyRenderCollapsed() {
    document.querySelector(".render-pane").classList.toggle("collapsed", renderCollapsed);
    $("collapseFrame").textContent = renderCollapsed ? "▸ 渲染" : "▾ 渲染";
  }
  $("collapseFrame").onclick = () => {
    renderCollapsed = !renderCollapsed;
    localStorage.setItem(NS + "renderCollapsed", renderCollapsed ? "1" : "0");
    applyRenderCollapsed();
  };
  applyRenderCollapsed();

  function applyChecklistCollapsed() {
    document.querySelector(".checklist-pane").classList.toggle("collapsed", checklistCollapsed);
    $("collapseChecklist").textContent = checklistCollapsed ? "▸ 清單" : "▾ 清單";
  }
  $("collapseChecklist").onclick = () => {
    checklistCollapsed = !checklistCollapsed;
    localStorage.setItem(NS + "checklistCollapsed", checklistCollapsed ? "1" : "0");
    applyChecklistCollapsed();
  };
  applyChecklistCollapsed();

  // ================= HOME / OVERVIEW =================
  // 新版聚光燈是否已跑過 Skill 且有完整新資料
  function skillStatus(L) {
    const hasFx = !!L.fixture_found;
    const hasEx = (L.exercise_count || 0) > 0;
    const needsRev = (L.blocks || []).some((b) => b.needs_review);
    if (!hasFx) return { cls: "no", label: "✗ 未跑 Skill", complete: false };
    if (!hasEx || needsRev) return { cls: "partial", label: "⚠ 需檢核", complete: false };
    return { cls: "ok", label: "✅ 完整", complete: true };
  }

  function overviewStat(L, i) {
    const r = i === current ? review : loadReview(L.lesson_code);
    let flags = 0;
    Object.values(r.findings || {}).forEach((f) => (flags += flagCount(f)));
    let pf = 0;
    (L.checklist || []).forEach((c) => (pf += preflight((L.blocks || [])[c.index]).length));
    return {
      i,
      L,
      r,
      flags,
      pf,
      annos: (r.annotations || []).length,
      items: (L.checklist || []).length,
      sk: skillStatus(L),
      reviewed: r.status === "reviewed",
      issue: flags > 0 || (r.annotations || []).length > 0,
    };
  }
  const OV_FILTERS = {
    all: () => true,
    todo_skill: (s) => !s.sk.complete,
    done_skill: (s) => s.sk.complete,
    flagged: (s) => s.issue,
    reviewed: (s) => s.reviewed,
    pending: (s) => !s.reviewed,
  };
  function renderOverview() {
    const stats = LESSONS.map((L, i) => overviewStat(L, i));
    const skillDone = stats.filter((s) => s.sk.complete).length;
    const reviewed = stats.filter((s) => s.reviewed).length;
    const totFlags = stats.reduce((n, s) => n + s.flags, 0);
    const totPf = stats.reduce((n, s) => n + s.pf, 0);
    $("ovSummary").innerHTML =
      `新版資料完整 <b>${skillDone}/${LESSONS.length}</b>　·　已審 <b>${reviewed}/${LESSONS.length}</b>` +
      `　·　待複核預檢 <b>${totPf}</b>　·　人工標記 <b>${totFlags}</b>`;

    const pred = OV_FILTERS[ovFilter] || OV_FILTERS.all;
    const shown = stats.filter(pred);
    let html = "";
    let curGrade = null;
    if (!shown.length) html = `<div class="empty">此篩選沒有課。</div>`;
    shown.forEach((s) => {
      if (s.L.grade !== curGrade) {
        curGrade = s.L.grade;
        const n = shown.filter((x) => x.L.grade === curGrade).length;
        html += `<div class="ov-group">${esc(curGrade)}(${n} 課)</div>`;
      }
      const L = s.L;
      const cls = s.reviewed ? "reviewed" : s.issue ? "has-issue" : "";
      const pill = s.reviewed
        ? `<span class="ov-pill reviewed">已審畢</span>`
        : s.issue
        ? `<span class="ov-pill issue">有標記</span>`
        : `<span class="ov-pill pending">未審</span>`;
      const note =
        s.r.lesson_note && s.r.lesson_note.trim()
          ? `<div class="ov-note">📝 ${esc(s.r.lesson_note.slice(0, 70))}</div>`
          : "";
      html +=
        `<div class="ov-row ${cls}" data-i="${s.i}">` +
        `<span class="ov-code">${esc(L.lesson_code)}</span>` +
        `<div class="ov-main"><div class="ov-title">${esc(L.title || "")}</div>` +
        `<div class="ov-strat">${esc(L.strategy_name || "")}</div>${note}</div>` +
        `<div class="ov-stats">` +
        `<span class="ov-skill ${s.sk.cls}" title="新版聚光燈是否已跑過 Skill 並產出完整新資料">${s.sk.label}</span>` +
        `<span class="ov-stat">可審 <b>${s.items}</b></span>` +
        `<span class="ov-stat pf">⚠ <b>${s.pf}</b></span>` +
        `<span class="ov-stat flag">🚩 <b>${s.flags}</b></span>` +
        `<span class="ov-stat">✎ <b>${s.annos}</b></span>` +
        pill +
        `</div></div>`;
    });
    $("ovList").innerHTML = html;
    $("ovList")
      .querySelectorAll(".ov-row")
      .forEach((row) => {
        row.onclick = () => {
          hideOverview();
          goto(Number(row.dataset.i));
        };
      });
  }
  $("ovFilter")
    .querySelectorAll(".ov-fbtn")
    .forEach((btn) => {
      btn.onclick = () => {
        ovFilter = btn.dataset.f;
        localStorage.setItem(NS + "ovFilter", ovFilter);
        $("ovFilter").querySelectorAll(".ov-fbtn").forEach((b) => b.classList.toggle("active", b === btn));
        renderOverview();
      };
    });
  $("ovFilter")
    .querySelectorAll(".ov-fbtn")
    .forEach((b) => b.classList.toggle("active", b.dataset.f === ovFilter));
  function showOverview() {
    overviewMode = true;
    renderOverview();
    document.querySelector("main").style.display = "none";
    $("overview").style.display = "block";
    $("homeBtn").classList.add("active");
  }
  function hideOverview() {
    overviewMode = false;
    document.querySelector("main").style.display = "flex";
    $("overview").style.display = "none";
    $("homeBtn").classList.remove("active");
  }
  $("homeBtn").onclick = () => (overviewMode ? hideOverview() : showOverview());
  $("ovExport").onclick = () => $("exportBtn").click();
  $("lessonReviewed").onchange = () => {
    review.status = $("lessonReviewed").checked ? "reviewed" : "pending";
    persist();
  };
  $("lessonNote").oninput = () => {
    review.lesson_note = $("lessonNote").value;
    saveReview(lesson().lesson_code, review);
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") goto(current - 1);
    if (e.key === "ArrowRight") goto(current + 1);
  });

  // ================= EXPORT =================
  function buildExportObject() {
    const lessons = [];
    LESSONS.forEach((L, i) => {
      const r = i === current ? review : loadReview(L.lesson_code);
      const byId = {};
      (L.checklist || []).forEach((b) => (byId[b.block_id] = b));
      const blockByIdx = L.blocks || [];

      const stepHasContent = (s) => s.has_issue || (s.note && s.note.trim()) || (s.tags && s.tags.length);
      const blockFindings = Object.keys(r.findings || {})
        .map((bid) => ({ bid, f: r.findings[bid] }))
        .filter(
          ({ f }) =>
            f.has_issue ||
            (f.note && f.note.trim()) ||
            (f.tags && f.tags.length) ||
            (f.steps && Object.values(f.steps).some(stepHasContent))
        )
        .map(({ bid, f }) => {
          const meta = byId[bid] || {};
          const raw = blockByIdx[meta.index] || null;
          const rawSteps = (raw && raw.question && raw.question.steps) || [];
          const stepFindings = Object.keys(f.steps || {})
            .map((i) => ({ i: Number(i), s: f.steps[i] }))
            .filter(({ s }) => stepHasContent(s))
            .map(({ i, s }) => {
              const rs = rawSteps[i] || {};
              return {
                step_index: i,
                section: rs.section || null,
                prompt: rs.prompt || null,
                type: rs.type || null,
                options: rs.options || null,
                answer: rs.answer ?? null,
                reference_answer: rs.reference_answer ?? null,
                has_issue: !!s.has_issue,
                issue_tags: s.tags || [],
                note: s.note || "",
              };
            });
          return {
            block_id: bid,
            block_index: meta.index ?? null,
            block_type: meta.type || null,
            block_kind: meta.kind || null,
            summary: meta.summary || null,
            has_issue: !!f.has_issue,
            issue_tags: f.tags || [],
            note: f.note || "",
            step_findings: stepFindings,
            preflight: preflight(raw), // 自動預檢結果,供 AI 參考
            current_block: raw, // 完整 block 內容,供 AI 直接據此修復
          };
        });
      const annos = (r.annotations || []).map((a) => ({
        scope: a.scope,
        block_id: a.block_id,
        quote: a.quote,
        note: a.note,
      }));
      if (
        r.status === "reviewed" ||
        (r.lesson_note && r.lesson_note.trim()) ||
        blockFindings.length ||
        annos.length
      ) {
        lessons.push({
          lesson_code: L.lesson_code,
          title: L.title,
          strategy_name: L.strategy_name,
          dev_url: L.story_id ? `/learn/${L.story_id}/reading-strategy` : "",
          source_docx: L.source_file,
          worksheet_docx_url: L.worksheet_docx_url,
          lesson_status: r.status,
          lesson_note: r.lesson_note || "",
          block_findings: blockFindings,
          text_annotations: annos,
        });
      }
    });

    return {
      exported_at: new Date().toISOString(),
      reviewer: reviewer,
      tool_version: TOOL_VERSION,
      compared_against: "docx ground truth ↔ staging StrategyExercisePage (/learn/{story_id}/reading-strategy)",
      issue_tag_legend: Object.fromEntries(ISSUE_TAGS),
      lessons,
    };
  }

  $("exportBtn").onclick = () => {
    const out = buildExportObject();
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spotlight-qa-review-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- 雲端存 / 載(staging;比照 testset)----
  $("saveCloudBtn").onclick = async () => {
    const btn = $("saveCloudBtn");
    if (!reviewer.trim()) {
      alert("請先在上方「審查者」欄填入你的名字再存到 staging(存檔會用它當路徑)。");
      $("reviewer").focus();
      return;
    }
    const out = buildExportObject();
    if (!out.lessons.length && !confirm("目前沒有任何標記/備註,仍要存空的 review 到 staging?")) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "存檔中…";
    try {
      const res = await fetch(`${API}/api/spotlight-qa/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(out),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        btn.textContent = "✅ 已存";
        setTimeout(() => (btn.textContent = old), 1800);
      } else {
        alert("存檔失敗(" + res.status + "):" + (j.detail || JSON.stringify(j)));
        btn.textContent = old;
      }
    } catch (e) {
      alert("存檔失敗:" + e.message + "\nAPI=" + API);
      btn.textContent = old;
    } finally {
      btn.disabled = false;
    }
  };

  $("loadCloudBtn").onclick = async () => {
    const box = $("cloudList");
    box.style.display = "block";
    box.innerHTML = "<div class='cloud-row'>載入清單中…</div>";
    try {
      const res = await fetch(`${API}/api/spotlight-qa/reviews`);
      const j = await res.json();
      const list = (j && j.reviews) || [];
      if (!list.length) {
        box.innerHTML = "<div class='cloud-row'>雲端沒有已存的 review。</div>";
        return;
      }
      box.innerHTML =
        `<div class="cloud-head">雲端 review(點一筆載回,會覆寫本機同課標記)<button class="link-btn" id="cloudClose">✕</button></div>` +
        list
          .map(
            (r) =>
              `<div class="cloud-row" data-path="${esc(r.path)}"><b>${esc(r.reviewer)}</b>　${esc(
                r.saved_at
              )}　<span class="meta">${r.size || 0}B</span></div>`
          )
          .join("");
      $("cloudClose").onclick = () => (box.style.display = "none");
      box.querySelectorAll(".cloud-row[data-path]").forEach((row) => {
        row.onclick = () => loadCloudReview(row.dataset.path);
      });
    } catch (e) {
      box.innerHTML = "<div class='cloud-row'>載入清單失敗:" + esc(e.message) + "</div>";
    }
  };

  async function loadCloudReview(path) {
    if (!confirm("載回這筆 review?會覆寫本機對應課的標記/備註。")) return;
    try {
      const res = await fetch(`${API}/api/spotlight-qa/review?path=` + encodeURIComponent(path));
      const payload = await res.json();
      const lessons = (payload && payload.lessons) || [];
      // 把 payload 各課回填成本工具的 review 結構(findings 綁 block_id + steps)
      lessons.forEach((L) => {
        const r = blankReview();
        r.status = L.lesson_status || "pending";
        r.lesson_note = L.lesson_note || "";
        (L.block_findings || []).forEach((bf) => {
          const f = { has_issue: !!bf.has_issue, tags: bf.issue_tags || [], note: bf.note || "", steps: {} };
          (bf.step_findings || []).forEach((sf) => {
            f.steps[sf.step_index] = {
              has_issue: !!sf.has_issue,
              tags: sf.issue_tags || [],
              note: sf.note || "",
            };
          });
          r.findings[bf.block_id] = f;
        });
        r.annotations = (L.text_annotations || []).map((a) => ({
          id: "a" + Math.random().toString(36).slice(2),
          scope: a.scope,
          block_id: a.block_id,
          quote: a.quote,
          note: a.note,
        }));
        saveReview(L.lesson_code, r);
      });
      if (payload.reviewer) {
        reviewer = payload.reviewer;
        $("reviewer").value = reviewer;
        localStorage.setItem(NS + "reviewer", reviewer);
      }
      $("cloudList").style.display = "none";
      review = loadReview(lesson().lesson_code);
      renderAll();
      showOverview();
      alert("已載回 " + lessons.length + " 課的 review。");
    } catch (e) {
      alert("載回失敗:" + e.message);
    }
  }

  // ================= INIT =================
  if (!LESSONS.length) {
    document.querySelector("main").innerHTML =
      '<div class="empty">找不到資料。請先在這個資料夾執行 <code>bash build.sh</code> 產生 lessons-data.js。</div>';
    return;
  }
  current = Math.min(
    LESSONS.length - 1,
    Math.max(0, Number(localStorage.getItem(NS + "current") || 0))
  );
  review = loadReview(lesson().lesson_code);
  buildLessonSelect();
  renderAll();
  showOverview(); // 首頁 = 各課審查進度總覽;點某課或分頁進入審查
})();
