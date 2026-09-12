/**
 * qaCloudResponse.js — 兩個 QA 看板共用：把「請求被拒絕」翻成一句給人看的原因。
 *
 * 為什麼需要它（#3188）：看板原本 `await res.json()` 之後直接讀 `j.reviews`，
 * 不看 `res.ok`。後端拒絕時回的是**帶合法 JSON body 的非 2xx**，所以 `res.json()`
 * 成功、`j.reviews` 是 undefined、清單變成空的 —— 畫面於是顯示
 * 「雲端沒有已存的 review。」。審查者會以為自己存的東西不見了，而真相是請求被擋下來。
 *
 * #3169 把「刻意停用」從 503 改成 404（5xx 會被 Cloud Run 標成 severity=ERROR，
 * 一筆就讓警報響一整週）。那個改動是對的，但它讓「被拒絕」從此都長成
 * 一次成功的 JSON 解析，所以這個既有的缺口變成每次都會踩到。
 *
 * 純函式、不碰 DOM、不碰 fetch —— 呼叫端負責讀 body，這裡只負責決定「該說什麼」。
 */
(function () {
  /**
   * @param {number} status  res.status
   * @param {*} body         已解析的回應 body（解析失敗就傳 null）
   * @returns {string|null}  該顯示的原因；真的成功才回 null
   */
  function failureMessage(status, body) {
    // 後端有兩種「失敗」，只擋其中一種等於沒擋：
    //   (a) 非 2xx —— 停用 404、未授權 401/403、伺服器 5xx
    //   (b) **HTTP 200 但 body 說 ok:false** —— `/keypoints-qa/reviews` 在
    //       `bucket is None` 與列舉炸掉時回 {"ok":false,"reviews":[],"reason":...}
    //       （keypoints_qa.py:130 與 :152）。它是 2xx，所以只看 res.ok 會放行，
    //       然後 reviews 是空陣列 —— 又變成「雲端沒有已存的 review」那個謊。
    if (typeof status === 'number' && status >= 200 && status < 300) {
      if (body && body.ok === false) {
        var reason = body && typeof body.reason === 'string' ? body.reason : '';
        return '雲端這次沒讀到，不是沒有存檔。後端回報：' + (reason || '未說明原因');
      }
      return null;
    }

    var code = '（HTTP ' + status + '）';
    // detail 來自後端 body，可能不是字串（null／物件／數字）—— 一律先轉成安全的字串
    var text = body && typeof body.detail === 'string' ? body.detail : '';

    if (status === 404 && /disabled/i.test(text)) {
      return '這個環境的 QA 看板已停用，不是雲端沒有存檔。' + code + ' ' + text;
    }
    if (status === 401 || status === 403) {
      return '沒有讀取雲端 review 的權限 —— 請確認網址帶的 token 正確。' + code;
    }
    if (status >= 500) {
      return '伺服器錯誤，雲端 review 這次沒載到，稍後再試。' + code;
    }
    return '載入雲端 review 失敗。' + code + (text ? ' ' + text : '');
  }

  window.qaCloud = { failureMessage: failureMessage };
})();
