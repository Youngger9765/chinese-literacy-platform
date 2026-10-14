"""External review #2 — "scoring must be recomputable from stored data
alone (add a test that recomputes and matches)".

This drives the engine directly (not through HTTP) against its own
in-memory DB, plays a full game, then — acting as an independent audit tool
that only has the DB rows, nothing from the live request/response objects —
replays every stored answer through ``recompute.compute_round_result`` /
``recompute.replay_player_streak`` and asserts the replay matches what was
actually stored.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.live_quiz import LiveQuizAnswer, LiveQuizGame, LiveQuizPlayer
from app.models.school import School
from app.models.user import Role, User, UserRole
from app.auth.password import hash_password
from app.services.live_quiz import engine as live_quiz_engine
from app.services.live_quiz import recompute

engine_db = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine_db, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocalTest = sessionmaker(autocommit=False, autoflush=False, bind=engine_db)


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_db)
    yield
    Base.metadata.drop_all(bind=engine_db)


def _make_user(db, email) -> User:
    u = User(email=email, password_hash=hash_password("x"), name=email.split("@")[0], email_verified=True)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _fake_lesson(n: int) -> dict:
    return {
        "title": "回放測試課文", "version_id": "v1",
        "comprehension": {"questions": [
            {"index": i, "stem": f"題{i}", "answer": "A",
             "options": {"A": "正確", "B": "錯一", "C": "錯二", "D": "錯三"}}
            for i in range(1, n + 1)
        ]},
    }


def test_recompute_matches_stored_scores_across_a_full_game(monkeypatch):
    monkeypatch.setattr(live_quiz_engine, "load_lesson", lambda uid: _fake_lesson(4) if uid == "FAKE4" else None)

    db = SessionLocalTest()
    try:
        school = School(name="Recompute Test School")
        db.add(school)
        db.commit()
        db.refresh(school)
        teacher = _make_user(db, "recompute_teacher@example.com")
        p1 = _make_user(db, "recompute_p1@example.com")
        p2 = _make_user(db, "recompute_p2@example.com")

        game = live_quiz_engine.create_game(
            db, teacher,
            lesson_uids=["FAKE4"], source_modules=["comprehension"],
            question_count_mode="all", seconds=30, reading_seconds=0,
            streak_bonus_enabled=True, double_points_last=True,
        )
        player1 = live_quiz_engine.join_game(db, game.code, p1)
        player2 = live_quiz_engine.join_game(db, game.code, p2)
        live_quiz_engine.start_game(db, game, teacher)

        # A deliberately mixed sequence: player1 correct/correct/wrong/correct,
        # player2 never answers two of the four rounds.
        plan = {
            player1.id: [True, True, False, True],
            player2.id: [True, False, None, True],  # None = never answers this round
        }
        for i in range(4):
            round_def = game.rounds_snapshot[i]
            correct_key = round_def["payload"]["correct_key"]
            wrong_key = next(o["key"] for o in round_def["payload"]["options"] if o["key"] != correct_key)
            for player, player_obj in ((player1, p1), (player2, p2)):
                want = plan[player.id][i]
                if want is None:
                    continue
                submission = {"choice_key": correct_key if want else wrong_key}
                live_quiz_engine.submit_answer(db, game, player, submission)
            if i < 3:
                live_quiz_engine.reveal_round(db, game, teacher)
                live_quiz_engine.next_round(db, game, teacher)
        live_quiz_engine.reveal_round(db, game, teacher)
        live_quiz_engine.end_game(db, game, teacher)

        # ---- Independent audit replay below: read-only from the DB rows ----
        stored_game = db.query(LiveQuizGame).filter(LiveQuizGame.id == game.id).first()
        rounds_snapshot = stored_game.rounds_snapshot
        settings = stored_game.settings
        rounds_total = len(rounds_snapshot)

        for player_row in db.query(LiveQuizPlayer).filter(LiveQuizPlayer.game_id == game.id).all():
            stored_answers = (
                db.query(LiveQuizAnswer)
                .filter(LiveQuizAnswer.player_id == player_row.id)
                .order_by(LiveQuizAnswer.round_index)
                .all()
            )
            is_correct_sequence = [a.is_correct for a in stored_answers]
            replayed_streaks = recompute.replay_player_streak(
                [{"is_correct": c} for c in is_correct_sequence]
            )
            for answer, new_streak in zip(stored_answers, replayed_streaks):
                round_def = rounds_snapshot[answer.round_index]
                is_last_round = answer.round_index == rounds_total - 1
                replayed_is_correct, replayed_points = recompute.compute_round_result(
                    round_def=round_def,
                    settings=settings,
                    submission=answer.submission,
                    elapsed_ms=answer.elapsed_ms,
                    new_streak=new_streak,
                    is_last_round=is_last_round,
                )
                assert replayed_is_correct == answer.is_correct, (
                    f"player={player_row.id} round={answer.round_index}: "
                    f"replayed is_correct={replayed_is_correct} != stored {answer.is_correct}"
                )
                assert replayed_points == answer.points, (
                    f"player={player_row.id} round={answer.round_index}: "
                    f"replayed points={replayed_points} != stored {answer.points}"
                )

        # Sanity: the plan actually produced the mix of outcomes we intended,
        # so this test is exercising wrong/skipped/streak/double-points, not
        # just trivially replaying all-correct answers.
        p1_results = [a.is_correct for a in db.query(LiveQuizAnswer).filter(
            LiveQuizAnswer.player_id == player1.id).order_by(LiveQuizAnswer.round_index).all()]
        assert p1_results == [True, True, False, True]
        p2_answered_rounds = {a.round_index for a in db.query(LiveQuizAnswer).filter(
            LiveQuizAnswer.player_id == player2.id).all()}
        assert p2_answered_rounds == {0, 1, 3}
    finally:
        db.close()
