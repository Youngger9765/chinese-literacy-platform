"""
#4161 AI 派發：推薦清單裡有「年級是文字」的課（文言文、品格教育）時，整個推薦請求不能壞掉。

後端推薦回應把 grade 定成整數，而課程的年級是分類字串（"4".."9"、文言文、品格教育），
推薦程式又把它原樣放進回應，一旦推薦結果裡出現那兩類課，回應格式驗證失敗（500），
畫面就變成「暫時派不出課文」。首頁改成以推薦為主要入口後碰到的機會變大。
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.routes.learning.learning_recommendations import StoryRecommendationItem
from app.services.learning_path_service import recommend_next_stories


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def test_catalog_really_has_non_numeric_grades(db):
    """正向對照：下面的檢查要有東西可查——整本目錄裡確實有年級不是數字的課。"""
    recs = recommend_next_stories(1, db, limit=500)
    assert any(not str(r["grade"]).isdigit() for r in recs), "目錄裡沒有文字年級的課，這組測試就沒有意義"


@pytest.mark.parametrize("limit", [5, 12, 50, 500])
def test_every_recommendation_fits_the_response_model(db, limit):
    recs = recommend_next_stories(1, db, limit=limit)
    assert recs, "沒有任何推薦"
    for r in recs:
        item = StoryRecommendationItem(**r)  # 驗證失敗就是正式環境的 500
        assert str(item.grade) == str(r["grade"]), "年級要照原樣回傳，不能被改掉"
        # 數字年級維持整數（既有契約），文字年級維持文字
        assert isinstance(item.grade, int) == str(r["grade"]).isdigit()
