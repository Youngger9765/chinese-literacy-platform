/* 文章重點表 QA 工具 — docx 原文 ↔ 實際渲染(真 StoryStructureTable)對照。file:// 可用。
   右欄上:iframe {base}/learn/{story_id}/story-structure(真 StoryStructureTable,需同源已登入)
   右欄下:逐 row 清單(每列 🚩 標記 / 標籤 / 備註),findings 綁 row_key。 */
(function () {
  "use strict";

  const LESSONS = window.LESSONS || [];
  const TOOL_VERSION = 1;
  const NS = "keypoints-qa:";
  const LIVE_BASE = "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app";
  const DEFAULT_BASE = LIVE_BASE; // render base 預設 = staging(有 /learn + demo 帳號 + 答案已遮罩)
  const OLD_DEFAULT_BASE = "http://localhost:3000"; // 舊預設,見到就遷移到 staging
  const WS_HOST = "https://lingoleap-dev.web.app"; // worksheet 原稿(前端 hosting;GCS raw 403)

  // ---- 環境自適應(file:// 本機工作台 vs http staging 部署) ----
  const IS_HTTP = location.protocol === "http:" || location.protocol === "https:";
  const IS_REMOTE = /\.(run|web)\.app$/.test(location.hostname);

  // render iframe base:
  //  - 部署在 app 同源(staging public,IS_REMOTE)→ 同源就有 /learn
  //  - 否則(file:// 或本機靜態伺服 localhost:PORT)→ 用「render base」輸入框(指向有 /learn 的站,如 staging)
  function renderBase() {
    return IS_REMOTE ? location.origin : baseUrl.replace(/\/+$/, "");
  }
  // worksheet PDF 來源:
  //  - 遠端部署 → WS_HOST/assets(其 CSP 允許內嵌)
  //  - file:// 或本機靜態伺服(worksheets/ 與工具同資料夾一起被服務)→ 相對路徑 local_pdf
  function worksheetPdfSrc(L) {
    if (IS_REMOTE) return `${WS_HOST}/assets/worksheets/${L.lesson_code}.pdf#view=FitH`;
    return L.local_pdf ? L.local_pdf + "#view=FitH" : "";
  }
  // 後端 API base(比照 spotlight/testset):打對應環境後端存/載 QA JSON
  function apiBase() {
    const h = location.hostname;
    if (h.indexOf("-frontend-") > -1) return location.origin.replace("-frontend-", "-backend-");
    if (h === "localhost" || h === "127.0.0.1") return "http://localhost:8000";
    if (/\.web\.app$/.test(h)) return ""; // Firebase 有 /api rewrite,用相對路徑
    return "https://lingoleap-backend-staging-958347263320.asia-east1.run.app";
  }
  const API = apiBase();

  // #2534: arm QA-board with the shared secret. Visit once with ?qa_token=<secret>
  // to persist it; sent as x-qa-token on save/reviews/review. No token → header
  // omitted → backend stays open (no regression until QA_TOOLS_SHARED_SECRET is set).
  try {
    const _qt = new URLSearchParams(location.search).get("qa_token");
    if (_qt) localStorage.setItem(NS + "qaToken", _qt);
  } catch (e) {}
  function qaAuthHeaders() {
    const t = localStorage.getItem(NS + "qaToken");
    return t ? { "x-qa-token": t } : {};
  }

  // 問題標籤(docx ↔ 重點表渲染的保真檢查導向)
  const ISSUE_TAGS = [
    ["blank_wrong", "空格位置/數量/答案錯"],
    ["cell_mismatch", "格內容與 docx 不符"],
    ["missing_row", "漏列(docx 有、渲染無)"],
    ["extra_row", "多列(渲染多出)"],
    ["checkbox_options_wrong", "選項/干擾項錯"],
    ["label_wrong", "標籤/欄名錯"],
    ["merge_broken", "合併儲存格渲染壞"],
    ["answer_leak", "答案沒遮罩(露答案)"],
    ["render_broken", "整體渲染壞"],
    ["other", "其他"],
  ];

  // ---- state ----
  let current = 0;
  let reviewer = localStorage.getItem(NS + "reviewer") || "啟翔";
  let baseUrl = localStorage.getItem(NS + "baseUrl") || DEFAULT_BASE;
  if (baseUrl === OLD_DEFAULT_BASE) baseUrl = DEFAULT_BASE; // 把舊的 localhost 預設遷到 staging
  let leftView = localStorage.getItem(NS + "leftView") || "pdf"; // 預設 'pdf' 原稿 PDF('text' = 結構化重點表)
  // 註:worksheets/ 會與工具一起被靜態伺服,http 本機也載得到 PDF,故不再強制切文字;
  //     某課若沒有本機 PDF(build.sh 未轉/抓不到),applyLeftView 會顯示提示並請改用結構化。
  let renderCollapsed = localStorage.getItem(NS + "renderCollapsed") === "1";
  let checklistCollapsed = localStorage.getItem(NS + "checklistCollapsed") === "1";
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
  function finding(rk) {
    if (!review.findings[rk]) review.findings[rk] = { has_issue: false, tags: [], note: "" };
    return review.findings[rk];
  }
  function persist() {
    saveReview(lesson().lesson_code, review);
    syncSelect();
    renderProgress();
  }
  function flagCount(r) {
    if (!r) return 0;
    let n = Object.values(r.findings || {}).filter((f) => f.has_issue).length;
    n += (r.annotations || []).length;
    return n;
  }

  // ================= HELPERS =================
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
  // 有 query → 高亮;否則 → 把 【答案】 標綠(二選一,避免 HTML 破損)
  function cellHtml(text, q) {
    if (q) return highlight(text, q);
    return esc(text).replace(/【([^】]*)】/g, '<span class="blank">【$1】</span>');
  }
  function accentClass(label) {
    if (/問題|困境|衝突|挑戰|難題|障礙/.test(label)) return "acc-problem";
    if (/解決|方法|策略|行動|回應|措施|處理|應對/.test(label)) return "acc-solution";
    if (/結果|影響|成效|成果|結局|後果|變化/.test(label)) return "acc-result";
    return "acc-none";
  }

  // ================= LEFT: 結構化重點表 reader =================
  function renderKeypointsTable(L, q) {
    const rowsHtml = [];
    if (L.group === "docx") {
      (L.structure_table || []).forEach((row) => {
        const r = Array.isArray(row) ? row : [row];
        const n = r.length;
        if (n === 1) {
          rowsHtml.push(`<tr class="title-row"><td colspan="3">${cellHtml(String(r[0]), q)}</td></tr>`);
        } else if (n === 2) {
          const acc = accentClass(String(r[0]));
          rowsHtml.push(
            `<tr><td class="lbl ${acc}">${cellHtml(String(r[0]), q)}</td>` +
              `<td colspan="2">${cellHtml(String(r[1]), q)}</td></tr>`
          );
        } else {
          const acc = accentClass(String(r[0]));
          const rest = r.slice(1).map(String);
          const pairs = [];
          for (let k = 0; k < rest.length; k += 2) pairs.push([rest[k], rest[k + 1] || ""]);
          pairs.forEach(([sl, sv], pi) => {
            let tr = "<tr>";
            if (pi === 0) tr += `<td class="lbl ${acc}" rowspan="${pairs.length}">${cellHtml(String(r[0]), q)}</td>`;
            tr += `<td class="sublbl">${cellHtml(sl, q)}</td><td>${cellHtml(sv, q)}</td></tr>`;
            rowsHtml.push(tr);
          });
        }
      });
    } else {
      const emit = (row, sub) => {
        const acc = accentClass(String(row.label || ""));
        const val = String(row.value || "");
        let opts = "";
        if (row.options && row.options.length) {
          const correct = new Set(row.correct_options || []);
          opts =
            `<div class="opt-line">` +
            row.options
              .map((o, i) => `<span class="${correct.has(i) ? "ok" : ""}">${String.fromCharCode(65 + i)}. ${esc(o)}${correct.has(i) ? " ✓" : ""}</span>`)
              .join("　") +
            `</div>`;
        }
        return (
          `<tr><td class="${sub ? "sublbl" : "lbl " + acc}">${cellHtml(String(row.label || ""), q)}</td>` +
          `<td colspan="2">${cellHtml(val, q)}${opts}</td></tr>`
        );
      };
      (L.structure_rows || []).forEach((row) => {
        rowsHtml.push(emit(row, false));
        (row.sub_rows || []).forEach((sub) => rowsHtml.push(emit(sub, true)));
      });
    }
    const title = L.title ? `<div class="kp-title">${cellHtml(L.title, q)}</div>` : "";
    return title + `<table class="kp"><tbody>${rowsHtml.join("")}</tbody></table>`;
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
      if (pdf.getAttribute("src") !== src) pdf.src = src;
      if (IS_REMOTE) {
        // 部署在 staging:PDF 來自 hosting,大部分課可顯示;沒有原稿的課會空白 → 常駐提示改切結構化
        hint.style.display = "block";
        hint.innerHTML =
          "<small>原稿 PDF 來自 hosting;<b>若此課空白</b>代表無原稿學習單 → 請切上方「📝 結構化重點表」對照。</small>";
      } else {
        hint.style.display = "none";
      }
    } else {
      pdf.style.display = "none";
      pdf.removeAttribute("src");
      hint.style.display = "block";
      hint.innerHTML =
        "此課沒有本機原稿 PDF(<code>build.sh</code> 未轉出或 hosting 抓不到)。" +
        "請改用「📝 結構化重點表」對照;跑 <code>bash build.sh</code> 補轉後再回來即可顯示。";
    }
  }

  function renderLeft() {
    const L = lesson();
    const q = $("search").value.trim();
    applyLeftView(L);
    $("reader").innerHTML = renderKeypointsTable(L, q);
    const parts = [];
    parts.push(`列 ${L.row_count}`);
    if (L.blank_count) parts.push(`空格 ${L.blank_count}`);
    if (L.checkbox_count) parts.push(`勾選 ${L.checkbox_count}`);
    parts.push(L.group === "docx" ? "docx 真解析" : "AI 生成");
    $("rawMeta").textContent = "· " + parts.join(" · ");

    $("docxView").innerHTML = "";
    $("docxStatus").textContent = "";
    const emb = $("pdfEmbed");
    emb.style.display = "none";
    emb.removeAttribute("src");
  }

  // ================= HEADER + iframe =================
  function renderHeader() {
    const L = lesson();
    const gtag = `<span class="gtag ${L.group}">${L.group === "docx" ? "docx 真解析" : "AI 生成"}</span>`;
    $("strategy").innerHTML =
      `<span class="badge">${esc(L.lesson_code)}</span>${gtag}${esc(L.strategy_name || "")}`;
    $("lessonMeta").innerHTML =
      `${esc(L.title || "")}　<strong>${L.row_count}</strong> 列` +
      ` (可審 ${L.reviewable_count} · 空格 ${L.blank_count} · 勾選 ${L.checkbox_count})`;
    $("blocksMeta").textContent = L.story_id
      ? `${L.reviewable_count} 列可審`
      : "⚠ 無 story_id,右欄無法渲染";
    $("docxLink").href = `${WS_HOST}/assets/worksheets/${L.lesson_code}.docx`;
    $("openLearn").href = learnUrl();
    $("prevBtn").disabled = current === 0;
    $("nextBtn").disabled = current === LESSONS.length - 1;
    $("lessonReviewed").checked = review.status === "reviewed";
    $("lessonNote").value = review.lesson_note || "";
  }

  function learnUrl() {
    const L = lesson();
    return L.story_id ? `${renderBase()}/learn/${L.story_id}/story-structure` : "about:blank";
  }
  function renderFrame() {
    const L = lesson();
    const url = learnUrl();
    $("renderFrame").src = url;
    $("openFrame").href = url;
    const hint = $("frameHint");
    if (!L.story_id) {
      hint.classList.add("show");
      hint.querySelector("div").textContent = `本課解析不到 story_id,無法渲染(${L.lesson_code})。`;
    } else {
      hint.classList.remove("show");
    }
    $("hintBase").textContent = renderBase();
  }

  // ================= RIGHT: row checklist =================
  function optsLine(item) {
    if (!item.options || !item.options.length) return "";
    const correct = new Set(item.correct_options || []);
    return (
      `<div class="row-opts">` +
      item.options
        .map((o, i) => `<span class="${correct.has(i) ? "ok" : ""}">${String.fromCharCode(65 + i)}. ${esc(o)}${correct.has(i) ? " ✓" : ""}</span>`)
        .join("　") +
      `</div>`
    );
  }

  function renderCards() {
    const L = lesson();
    const wrap = $("cards");
    wrap.innerHTML = "";
    const list = L.checklist || [];
    if (!list.length) {
      wrap.innerHTML = `<div class="empty">此課無重點表列。</div>`;
      return;
    }
    list.forEach((item) => wrap.appendChild(cardEl(item)));
  }

  function cardEl(item) {
    const rk = item.row_key;
    const f = review.findings[rk] || { has_issue: false, tags: [], note: "" };
    const isHeader = item.kind === "title" || item.kind === "section";

    const card = document.createElement("div");
    card.className = "card" + (f.has_issue ? " flagged" : "") + (isHeader ? " title-card" : "");
    card.dataset.block = rk;

    const badge = `<span class="type-badge ${esc(item.kind)}">${esc(item.kind)}</span>`;
    const num = item.sub_index == null ? `#${item.row_index}` : `#${item.row_index}.${item.sub_index}`;
    const labelHtml = item.label ? `<span class="row-label">${cellHtml(item.label, "")}</span>` : "";
    const cell = isHeader && item.kind === "title" ? "" : `<span class="row-cell">${cellHtml(item.raw_cell, "")}${optsLine(item)}</span>`;
    const chips = ISSUE_TAGS.map(
      ([k, label]) => `<button class="chip${f.tags.includes(k) ? " on" : ""}" data-tag="${k}">${esc(label)}</button>`
    ).join("");
    const blockAnnos = review.annotations.filter((a) => a.scope === "block" && a.block_id === rk);

    card.innerHTML =
      `<div class="card-top">` +
      `<span class="blk-no">${num}</span>${badge}${labelHtml}${cell}` +
      `<button class="s-jump" title="到左欄原稿找這列">⇤</button>` +
      `<label class="flag-toggle flagchk-inline"><input type="checkbox" class="flagchk"${f.has_issue ? " checked" : ""}> 🚩</label>` +
      `</div>` +
      `<div class="review${f.has_issue ? " show" : ""}">` +
      `<div class="chips">${chips}</div>` +
      `<textarea class="note-box" placeholder="這一列哪裡不對？（與 docx 不符 / 空格錯 / 漏列 / 露答案…）">${esc(f.note)}</textarea>` +
      `<div class="annos">${blockAnnos.map((a) => annoHtml(a)).join("")}</div>` +
      `</div>`;

    const chk = card.querySelector(".flagchk");
    const reviewBox = card.querySelector(".review");
    const noteBox = reviewBox.querySelector(".note-box");
    chk.onchange = () => {
      const ff = finding(rk);
      ff.has_issue = chk.checked;
      card.classList.toggle("flagged", chk.checked);
      reviewBox.classList.toggle("show", chk.checked);
      persist();
    };
    reviewBox.querySelectorAll(".chip").forEach((c) => {
      c.onclick = () => toggleTag(finding(rk), c, chk, card, reviewBox);
    });
    noteBox.oninput = () => {
      finding(rk).note = noteBox.value;
      saveReview(lesson().lesson_code, review);
    };
    card.querySelector(".s-jump").onclick = (e) => {
      e.stopPropagation();
      jumpTo(item.raw_cell || item.label);
    };
    bindAnnoDelete(card);
    return card;
  }

  function toggleTag(targetFinding, chipEl, chkEl, card, reviewEl) {
    const t = chipEl.dataset.tag;
    if (targetFinding.tags.includes(t)) targetFinding.tags = targetFinding.tags.filter((x) => x !== t);
    else targetFinding.tags.push(t);
    if (!targetFinding.has_issue) {
      targetFinding.has_issue = true;
      if (chkEl) chkEl.checked = true;
      card.classList.add("flagged");
      if (reviewEl) reviewEl.classList.add("show");
    }
    chipEl.classList.toggle("on");
    persist();
  }

  // ---- 對齊/跳轉:PDF #search(Chromium 支援);無 PDF 退回結構化文字高亮 ----
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
      setLeftView("pdf");
      const emb = $("wsPdf");
      emb.style.display = "block";
      $("wsHint").style.display = "none";
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

  // ================= NAV =================
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
      const tag = L.group === "docx" ? "📄" : "🤖";
      o.textContent = `${tag} ${L.lesson_code}${L.title ? "　" + L.title : ""}`;
      og.appendChild(o);
    });
    sel.onchange = () => goto(Number(sel.value));
  }
  function syncSelect() {
    const sel = $("lessonSelect");
    if (sel) sel.value = String(current);
  }
  function renderProgress() {
    let reviewed = 0,
      issues = 0;
    LESSONS.forEach((L, i) => {
      const r = i === current ? review : loadReview(L.lesson_code);
      if (r.status === "reviewed") reviewed++;
      issues += flagCount(r);
    });
    $("progress").innerHTML = `已審 <b>${reviewed}/${LESSONS.length}</b> · <span class="iss">${issues}</span> 個標記`;
  }

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
    syncSelect();
    renderProgress();
    renderLeft();
    renderFrame();
    renderCards();
  }

  // ================= TEXT ANNOTATION =================
  let pending = null;
  const annoBtn = $("annoBtn");
  const annoPop = $("annoPop");

  document.addEventListener("mouseup", (e) => {
    if (annoPop.contains(e.target) || e.target === annoBtn) return;
    setTimeout(showAnnoBtn, 0);
  });
  document.addEventListener("scroll", () => (annoBtn.style.display = "none"), true);

  function showAnnoBtn() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return (annoBtn.style.display = "none");
    const text = sel.toString().trim();
    if (!text) return (annoBtn.style.display = "none");
    const node =
      sel.anchorNode && sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    if (!node || !(node instanceof Element)) return;
    const blockEl = node.closest("[data-block]");
    const rawEl = node.closest('[data-scope="raw_text"]');
    if (!blockEl && !rawEl) return (annoBtn.style.display = "none");
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
      "「" + pending.quote + "」" + (pending.scope === "block" ? `（列 ${pending.block_id}）` : "（原稿）");
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
    renderCards();
  };

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
        renderCards();
      };
    });
  }

  // ================= docx 渲染(docx-preview;mammoth fallback) =================
  const hasDocxPreview = () =>
    !window.__noDocxPreview && typeof docx !== "undefined" && docx && typeof docx.renderAsync === "function";
  const hasMammoth = () => !window.__noMammoth && typeof mammoth !== "undefined";

  function renderDocx(arrayBuffer) {
    const view = $("docxView");
    view.innerHTML = "";
    if (hasDocxPreview()) {
      $("docxStatus").textContent = "渲染中(docx-preview 高保真)…";
      docx
        .renderAsync(arrayBuffer, view, null, { className: "dpx", inWrapper: true, breakPages: true, experimental: true, useBase64URL: true })
        .then(() => ($("docxStatus").textContent = "✓ 已渲染(docx-preview)"))
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
      $("docxStatus").textContent = "docx 渲染引擎未載入(請重跑 bash build.sh,或用上方連結開啟)。";
      return;
    }
    $("docxStatus").textContent = "渲染中(mammoth)…";
    mammoth
      .convertToHtml({ arrayBuffer })
      .then((res) => {
        $("docxView").innerHTML = res.value;
        $("docxStatus").textContent = "✓ 已渲染(mammoth:合併儲存格僅近似)";
      })
      .catch((err) => ($("docxStatus").textContent = "渲染失敗: " + err.message));
  }
  $("loadGcsDocx").onclick = () => {
    const url = $("docxLink").href;
    $("docxStatus").textContent = "下載中…";
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.arrayBuffer();
      })
      .then(renderDocx)
      .catch((err) => {
        $("docxStatus").innerHTML =
          "載入失敗(可能 CORS): " + esc(err.message) + `。請改<a href="${esc(url)}" target="_blank">開新分頁下載</a>後用「選擇本機 .docx」。`;
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
    renderHeader();
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
    $("renderFrame").src = "about:blank";
    setTimeout(renderFrame, 30);
  };
  const renderPaneEl = document.querySelector(".render-pane");
  const colRightEl = document.querySelector(".col.right");
  function applyRenderCollapsed() {
    renderPaneEl.classList.toggle("collapsed", renderCollapsed);
    if (renderCollapsed) {
      renderPaneEl.style.flex = ""; // 交回 .collapsed CSS
    } else {
      const h = Number(localStorage.getItem(NS + "renderH") || 0);
      renderPaneEl.style.flex = h > 0 ? `0 0 ${h}px` : ""; // 有存高度就固定,否則用預設比例
    }
    $("collapseFrame").textContent = renderCollapsed ? "▸ 渲染" : "▾ 渲染";
  }
  $("collapseFrame").onclick = () => {
    renderCollapsed = !renderCollapsed;
    localStorage.setItem(NS + "renderCollapsed", renderCollapsed ? "1" : "0");
    applyRenderCollapsed();
  };
  applyRenderCollapsed();

  // 可拖曳分隔線:調整渲染區高度(記住)
  (function () {
    const rz = $("vResizer");
    if (!rz) return;
    let dragging = false;
    rz.addEventListener("pointerdown", (e) => {
      if (renderCollapsed) return;
      dragging = true;
      rz.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
    });
    rz.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const top = colRightEl.getBoundingClientRect().top;
      const max = colRightEl.clientHeight - 130; // 給清單留最小高度
      const h = Math.max(150, Math.min(max, e.clientY - top));
      renderPaneEl.style.flex = `0 0 ${Math.round(h)}px`;
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = "";
      localStorage.setItem(NS + "renderH", String(Math.round(renderPaneEl.getBoundingClientRect().height)));
    };
    rz.addEventListener("pointerup", end);
    rz.addEventListener("pointercancel", end);
  })();
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

  $("lessonReviewed").onchange = () => {
    review.status = $("lessonReviewed").checked ? "reviewed" : "pending";
    persist();
  };
  $("lessonNote").oninput = () => {
    review.lesson_note = $("lessonNote").value;
    saveReview(lesson().lesson_code, review);
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft") goto(current - 1);
    if (e.key === "ArrowRight") goto(current + 1);
  });

  // ================= HOME / OVERVIEW =================
  function overviewStat(L, i) {
    const r = i === current ? review : loadReview(L.lesson_code);
    const flags = flagCount(r);
    return {
      i,
      L,
      r,
      flags,
      items: L.reviewable_count,
      reviewed: r.status === "reviewed",
      issue: flags > 0,
    };
  }
  const OV_FILTERS = {
    all: () => true,
    docx: (s) => s.L.group === "docx",
    ai: (s) => s.L.group === "ai",
    flagged: (s) => s.issue,
    reviewed: (s) => s.reviewed,
    pending: (s) => !s.reviewed,
  };
  function renderOverview() {
    const stats = LESSONS.map((L, i) => overviewStat(L, i));
    const docxN = stats.filter((s) => s.L.group === "docx").length;
    const reviewed = stats.filter((s) => s.reviewed).length;
    const totFlags = stats.reduce((n, s) => n + s.flags, 0);
    $("ovSummary").innerHTML =
      `docx 真解析 <b>${docxN}</b> · AI 生成 <b>${LESSONS.length - docxN}</b>` +
      `　·　已審 <b>${reviewed}/${LESSONS.length}</b>　·　人工標記 <b>${totFlags}</b>`;

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
        `<span class="ov-gtag ${L.group}">${L.group === "docx" ? "📄 docx" : "🤖 AI"}</span>` +
        `<span class="ov-stat">可審 <b>${s.items}</b></span>` +
        `<span class="ov-stat flag">🚩 <b>${s.flags}</b></span>` +
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

  // ================= EXPORT =================
  function buildExportObject() {
    const lessons = [];
    LESSONS.forEach((L, i) => {
      const r = i === current ? review : loadReview(L.lesson_code);
      const byKey = {};
      (L.checklist || []).forEach((c) => (byKey[c.row_key] = c));

      const rowFindings = Object.keys(r.findings || {})
        .map((rk) => ({ rk, f: r.findings[rk] }))
        .filter(({ f }) => f.has_issue || (f.note && f.note.trim()) || (f.tags && f.tags.length))
        .map(({ rk, f }) => {
          const meta = byKey[rk] || {};
          return {
            row_key: rk,
            row_index: meta.row_index ?? null,
            sub_index: meta.sub_index ?? null,
            kind: meta.kind || null,
            label: meta.label || null,
            raw_cell: meta.raw_cell ?? null, // ground truth 原文(含 【答案】),供 AI 對照修
            options: meta.options || null,
            correct_options: meta.correct_options || null,
            has_issue: !!f.has_issue,
            issue_tags: f.tags || [],
            note: f.note || "",
          };
        });
      const annos = (r.annotations || []).map((a) => ({
        scope: a.scope,
        block_id: a.block_id,
        quote: a.quote,
        note: a.note,
      }));
      if (r.status === "reviewed" || (r.lesson_note && r.lesson_note.trim()) || rowFindings.length || annos.length) {
        lessons.push({
          lesson_code: L.lesson_code,
          title: L.title,
          group: L.group,
          story_id: L.story_id,
          strategy_name: L.strategy_name,
          learn_url: L.story_id ? `/learn/${L.story_id}/story-structure` : null,
          source_docx: L.source_file,
          worksheet_docx_url: L.worksheet_docx_url,
          lesson_status: r.status,
          lesson_note: r.lesson_note || "",
          row_findings: rowFindings,
          text_annotations: annos,
        });
      }
    });

    return {
      exported_at: new Date().toISOString(),
      reviewer: reviewer,
      tool_version: TOOL_VERSION,
      compared_against: "docx story_structure_table ↔ 真 StoryStructureTable (/learn/{id}/story-structure)",
      issue_tag_legend: Object.fromEntries(ISSUE_TAGS),
      lessons,
    };
  }
  $("exportBtn").onclick = () => {
    const out = buildExportObject();
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keypoints-qa-review-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- 雲端存 / 載(staging;比照 spotlight-qa /api/keypoints-qa/*)----
  $("saveCloudBtn").onclick = async () => {
    const btn = $("saveCloudBtn");
    const out = buildExportObject();
    if (!out.lessons.length && !confirm("目前沒有任何標記/備註,仍要存空的 review 到 staging?")) return;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "存檔中…";
    try {
      const res = await fetch(`${API}/api/keypoints-qa/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...qaAuthHeaders() },
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
      const res = await fetch(`${API}/api/keypoints-qa/reviews`, { headers: qaAuthHeaders() });
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
      const res = await fetch(`${API}/api/keypoints-qa/review?path=` + encodeURIComponent(path), { headers: qaAuthHeaders() });
      const payload = await res.json();
      const lessons = (payload && payload.lessons) || [];
      // 回填成本工具的 review 結構(findings 綁 row_key)
      lessons.forEach((L) => {
        const r = blankReview();
        r.status = L.lesson_status || "pending";
        r.lesson_note = L.lesson_note || "";
        (L.row_findings || []).forEach((rf) => {
          if (!rf.row_key) return;
          r.findings[rf.row_key] = {
            has_issue: !!rf.has_issue,
            tags: rf.issue_tags || [],
            note: rf.note || "",
          };
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
  current = Math.min(LESSONS.length - 1, Math.max(0, Number(localStorage.getItem(NS + "current") || 0)));
  review = loadReview(lesson().lesson_code);
  buildLessonSelect();
  renderAll();
  showOverview();
})();
