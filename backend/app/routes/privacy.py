from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.user import User

router = APIRouter(prefix="/privacy", tags=["privacy"])

# Policy version — bump this whenever the policy text changes
POLICY_VERSION = "1.0.0"
POLICY_EFFECTIVE_DATE = "2026-01-01"


@router.get("/policy")
def get_privacy_policy():
    """Return the current privacy policy as structured JSON.

    This endpoint is public and does not require authentication.
    """
    return {
        "version": POLICY_VERSION,
        "effective_date": POLICY_EFFECTIVE_DATE,
        "language": "zh-TW",
        "platform_name": "LingoLeap 朗朗國語文閱讀學習平台",
        "sections": {
            "data_collection": {
                "title": "一、資料蒐集範圍",
                "content": (
                    "本平台依據個人資料保護法及相關法規，蒐集下列使用者資料："
                    "\n\n"
                    "（一）帳號資料：電子郵件地址、使用者名稱、姓名。\n"
                    "（二）學習記錄：課文學習進度、朗讀評估結果（文字形式）、"
                    "生字練習紀錄、課文理解作答。\n"
                    "（三）裝置資訊：瀏覽器類型、作業系統版本（用於相容性分析）。\n\n"
                    "本平台不蒐集下列資料：\n"
                    "（一）語音錄音檔案（詳見第二條）。\n"
                    "（二）精確地理位置資訊。\n"
                    "（三）生物特徵辨識資料。"
                ),
            },
            "audio_data": {
                "title": "二、錄音資料處理方式",
                "content": (
                    "本平台使用瀏覽器內建之 Web Speech API 進行語音辨識。"
                    "\n\n"
                    "重要說明：\n"
                    "（一）語音辨識完全在使用者的裝置端（瀏覽器）執行，"
                    "語音錄音原始檔案不會上傳至本平台伺服器。\n"
                    "（二）僅有語音辨識後產生的文字結果（逐字稿）會傳送至本平台"
                    "後端，用於評估朗讀正確度並提供學習回饋。\n"
                    "（三）Web Speech API 之語音處理規則依您使用的瀏覽器及作業系統"
                    "而定，建議參閱各瀏覽器廠商（如 Google Chrome、Apple Safari）"
                    "之隱私政策，以了解其語音資料處理方式。\n"
                    "（四）本平台不會錄製、儲存或重播任何語音錄音原始資料。"
                ),
            },
            "data_retention": {
                "title": "三、資料保留期限",
                "content": (
                    "（一）帳號資料：於帳號存續期間保留。帳號停用後，"
                    "資料將於三十（30）個日曆日內刪除。\n"
                    "（二）學習記錄：於帳號存續期間保留，供教師查閱及教學分析使用。"
                    "學生畢業或離校後，記錄將保留至學年度結束，"
                    "之後由所屬學校管理員決定是否保留或刪除。\n"
                    "（三）系統日誌：最長保留九十（90）個日曆日，"
                    "用於系統安全及故障排除。\n"
                    "（四）備份資料：備份複本最長保留三十（30）個日曆日後自動清除。"
                ),
            },
            "data_deletion": {
                "title": "四、刪除權利",
                "content": (
                    "依據個人資料保護法第三條，您享有下列權利：\n\n"
                    "（一）查詢或請求閱覽個人資料。\n"
                    "（二）請求製給複製本。\n"
                    "（三）請求補充或更正個人資料。\n"
                    "（四）請求停止蒐集、處理或利用個人資料。\n"
                    "（五）請求刪除個人資料。\n\n"
                    "行使上述權利，請透過學校管理員或聯絡本平台客服信箱提出申請。"
                    "本平台將於收到申請後十五（15）個工作日內回覆並處理。\n\n"
                    "注意事項：部分資料受法令要求須留存一定期間（如教育記錄），"
                    "在法定期間內無法刪除，本平台將說明理由。"
                ),
            },
            "children_privacy": {
                "title": "五、兒童隱私保護",
                "content": (
                    "本平台服務對象包含未滿十八歲之兒童及青少年（主要為國小高年級"
                    "至國中學生），因此特別重視兒童隱私保護。\n\n"
                    "（一）帳號申請：學生帳號由學校管理員或教師代為建立，"
                    "不開放學生自行公開註冊。\n"
                    "（二）監護人同意：學校在建立學生帳號前，應依相關法規取得"
                    "學生家長或法定監護人之同意。\n"
                    "（三）資料最小化：本平台僅蒐集提供教學服務所必要之最少資料，"
                    "不蒐集與學習無關之個人資訊。\n"
                    "（四）廣告限制：本平台不對兒童使用者投放行為廣告，"
                    "不將兒童資料提供予第三方廣告商。\n"
                    "（五）公開限制：學生的學習記錄僅限教師及授權之學校管理員查閱，"
                    "不對外公開。"
                ),
            },
            "contact": {
                "title": "六、聯絡方式",
                "content": (
                    "如對本隱私政策有任何疑問，或欲行使個人資料相關權利，"
                    "請透過以下方式聯絡我們：\n\n"
                    "服務信箱：support@lingoleap.edu.tw\n"
                    "服務時間：週一至週五 09:00–18:00（國定假日除外）\n\n"
                    "本隱私政策得視法規變動或業務需要適時修訂，"
                    "修訂後將公告於本頁面，並以顯著方式通知使用者。"
                ),
            },
        },
        "last_updated": POLICY_EFFECTIVE_DATE,
    }


@router.post("/accept")
def accept_privacy_policy(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record that the current user has accepted the privacy policy.

    Stores the acceptance timestamp in the user record.
    Idempotent — calling multiple times is safe.
    """
    current_user.privacy_accepted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(current_user)
    return {
        "message": "Privacy policy accepted",
        "accepted_at": current_user.privacy_accepted_at.isoformat(),
        "policy_version": POLICY_VERSION,
    }


@router.get("/consent-status")
def get_consent_status(
    current_user: User = Depends(get_current_user),
):
    """Return whether the current user has accepted the privacy policy."""
    return {
        "has_accepted": current_user.privacy_accepted_at is not None,
        "accepted_at": (
            current_user.privacy_accepted_at.isoformat()
            if current_user.privacy_accepted_at
            else None
        ),
        "current_policy_version": POLICY_VERSION,
    }
