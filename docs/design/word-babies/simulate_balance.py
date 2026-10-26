#!/usr/bin/env python3
"""
文字寶貝養成系統 — 平衡檢查模擬。

模擬「一個每週讀 3 課的學生」一學期（18 週、共 126 個日曆天、54 次上課）下來：
  - 大概收集到幾隻寶貝、各稀有度幾隻
  - 有沒有任何一隻史詩/傳說寶貝全平台的碎片供給量，連一隻都湊不齊

跑法：
    cd docs/design/word-babies && python3 generate_config.py && python3 simulate_balance.py

⛔ 全程決定性（wb_common 的雜湊），不用 random.random()。
"""

from __future__ import annotations

import glob
import json
from pathlib import Path

import yaml

from generate_config import MODULE_TO_FLAVOR, MODULE_TO_STATION, REPO_ROOT
from wb_common import SEED, pick_index, unit_interval

OUT_DIR = Path(__file__).resolve().parent
MANIFEST_GLOB = str(REPO_ROOT / "backend" / "data" / "lessons" / "*" / "v3" / "_manifest.yml")

WEEKS = 18
LESSONS_PER_WEEK = 3
PLAY_DAY_OFFSETS = [0, 2, 4]  # 週一／週三／週五，相對於每週第一天
TOTAL_DAYS = WEEKS * 7  # 126 天，約一學期
STUDENT_ID = "sim-student-diligent-3x-week"


def load_lesson_stations() -> dict[str, list[tuple[str, str]]]:
    """每課 → [(station, flavor), ...]，一定包含 lesson-intro。"""
    registry: dict[str, list[tuple[str, str]]] = {}
    for path in sorted(glob.glob(MANIFEST_GLOB)):
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        lesson_uid = data["lesson_uid"]
        stations: list[tuple[str, str]] = [("lesson-intro", MODULE_TO_FLAVOR["lesson_intro"])]
        for sec in data.get("sections", []):
            module = sec.get("module")
            if module in MODULE_TO_STATION:
                stations.append((MODULE_TO_STATION[module], MODULE_TO_FLAVOR[module]))
            # module 是 None 或不在對照表裡（資料品質缺口，§5.1 外的雜項）就跳過，不當成一個站
        registry[lesson_uid] = stations
    return registry


def pick_semester_lessons(all_lesson_uids: list[str], n: int) -> list[str]:
    """決定性抽 n 個不重複的課（模擬學生一學期讀的課，不重複讀同一課）。"""
    ordered = sorted(all_lesson_uids, key=lambda u: (SEED, u))  # 先固定順序
    scored = sorted(ordered, key=lambda u: unit_interval(SEED, "semester-pick", STUDENT_ID, u))
    return scored[:n]


def rarity_cum_table(encounters: dict) -> list[tuple[str, float, float]]:
    """回傳 [(rarity, lo, hi), ...] 累積區間。"""
    out = []
    acc = 0.0
    for row in encounters["rarity_base_rates"]:
        lo = acc
        acc += row["base_encounter_rate_per_station"]
        out.append((row["rarity"], lo, acc))
    return out


def main() -> None:
    babies_doc = json.loads((OUT_DIR / "babies.json").read_text(encoding="utf-8"))
    fragments_doc = json.loads((OUT_DIR / "fragments.json").read_text(encoding="utf-8"))
    encounters_doc = json.loads((OUT_DIR / "encounters.json").read_text(encoding="utf-8"))
    care_doc = json.loads((OUT_DIR / "care.json").read_text(encoding="utf-8"))

    babies_by_id = {b["id"]: b for b in babies_doc["babies"]}
    babies_by_flavor: dict[str, list[str]] = {f: [] for f in fragments_doc["flavor_families"]}
    for b in babies_doc["babies"]:
        for flavor in b["diet_flavors"]:
            babies_by_flavor[flavor].append(b["id"])
    for flavor in babies_by_flavor:
        babies_by_flavor[flavor].sort()

    drop_prob = fragments_doc["drop_probability_by_flavor"]
    cum_table = rarity_cum_table(encounters_doc)
    weaken_after = care_doc["weaken_after_days"]

    lesson_stations = load_lesson_stations()
    all_lesson_uids = list(lesson_stations.keys())
    chosen_lessons = pick_semester_lessons(all_lesson_uids, WEEKS * LESSONS_PER_WEEK)

    # --- 建立 126 天的課表：每週固定三天各讀一課 ---
    schedule: list[tuple[int, str]] = []  # (day, lesson_uid)
    it = iter(chosen_lessons)
    for week in range(WEEKS):
        for offset in PLAY_DAY_OFFSETS:
            day = week * 7 + offset
            schedule.append((day, next(it)))

    wallet: dict[str, int] = {f: 0 for f in fragments_doc["flavor_families"]}
    owned: dict[str, dict] = {}
    stats = {
        "fragments_collected_by_flavor": {f: 0 for f in fragments_doc["flavor_families"]},
        "encounters_triggered": 0,
        "duplicate_bonus_events": 0,
        "stations_visited": 0,
    }

    def eligible_candidates(flavor: str) -> list[str]:
        return [bid for bid in babies_by_flavor[flavor] if bid not in owned]

    def try_feed(baby_id: str) -> None:
        baby = babies_by_id[baby_id]
        state = owned[baby_id]
        if state["dormant"] is not None or state["stage_index"] > baby["stage_count"]:
            return
        stage = baby["stages"][state["stage_index"] - 1]
        fbf = stage.get("fragments_by_flavor")
        if fbf:
            # 結構化餵食（史詩／傳說）：文言文跟配對到的常見口味各自要湊自己的配額，
            # 不是共用同一個池子——否則常見口味充足的供給會先被貪婪吃光，看不出
            # 「文言文配額其實很小」這件事對供需比的真實影響。
            fed_by_flavor = state.setdefault("fed_by_flavor", {f: 0 for f in fbf})
            changed = True
            while changed:
                changed = False
                for flavor, required in fbf.items():
                    if fed_by_flavor[flavor] < required and wallet[flavor] > 0:
                        wallet[flavor] -= 1
                        fed_by_flavor[flavor] += 1
                        changed = True
            state["fed_current_stage"] = sum(fed_by_flavor.values())
            stage_done = all(fed_by_flavor[f] >= req for f, req in fbf.items())
        else:
            need_total = stage["fragments_to_finish_stage"]
            diet = baby["diet_flavors"]
            # 貪婪餵食：手上有的正確口味碎片，能餵多少餵多少
            while state["fed_current_stage"] < need_total:
                flavor_fed = None
                for flavor in diet:
                    if wallet[flavor] > 0:
                        flavor_fed = flavor
                        break
                if flavor_fed is None:
                    break
                wallet[flavor_fed] -= 1
                state["fed_current_stage"] += 1
            stage_done = state["fed_current_stage"] >= need_total

        if stage_done and stage["dormancy_after_this_stage"] is not None:
            state["dormant"] = {
                "type": stage["dormancy_after_this_stage"]["type"],
                "hatch_days_required": stage["dormancy_after_this_stage"]["hatch_days"],
                "hatch_progress": 0,
                "started_at": state["last_cared_at"],
            }
            state.pop("fed_by_flavor", None)
        elif stage_done:
            state["stage_index"] = baby["stage_count"] + 1  # 已經是最終型態且餵滿，標記完成

    last_event_day = 0
    for day in range(TOTAL_DAYS):
        # 處理當天是否有上課
        todays_lessons = [lesson for d, lesson in schedule if d == day]
        for lesson_uid in todays_lessons:
            last_event_day = day
            for state in owned.values():
                state["last_cared_at"] = day  # 完成任何站 = 重設所有已擁有寶貝的照顧時鐘
            for station, flavor in lesson_stations.get(lesson_uid, []):
                stats["stations_visited"] += 1
                # 碎片
                r_frag = unit_interval(SEED, STUDENT_ID, lesson_uid, station, "fragment")
                if r_frag < drop_prob[flavor]:
                    wallet[flavor] += 1
                    stats["fragments_collected_by_flavor"][flavor] += 1
                # 遭遇
                r_enc = unit_interval(SEED, STUDENT_ID, lesson_uid, station, "encounter")
                for rarity, lo, hi in cum_table:
                    if lo <= r_enc < hi:
                        candidates = [bid for bid in eligible_candidates(flavor)
                                      if babies_by_id[bid]["rarity"] == rarity]
                        if candidates:
                            idx = pick_index(len(candidates), SEED, STUDENT_ID, lesson_uid, station, "baby-pick")
                            baby_id = candidates[idx]
                            owned[baby_id] = {
                                "stage_index": 1,
                                "fed_current_stage": 0,
                                "dormant": None,
                                "last_cared_at": day,
                                "caught_day": day,
                            }
                            stats["encounters_triggered"] += 1
                        else:
                            # 這個稀有度＋口味的候選全部已擁有 → 補償碎片
                            wallet[flavor] += fragments_doc["duplicate_catch_bonus"]["bonus_fragment_count"]
                            stats["duplicate_bonus_events"] += 1
                        break
            # 這次上課後嘗試餵食（貪婪：優先餵「越接近完成本階段」的寶貝）
            feed_order = sorted(
                owned.keys(),
                key=lambda bid: (
                    babies_by_id[bid]["stages"][owned[bid]["stage_index"] - 1]["fragments_to_finish_stage"]
                    - owned[bid]["fed_current_stage"]
                    if owned[bid]["dormant"] is None and owned[bid]["stage_index"] <= babies_by_id[bid]["stage_count"]
                    else 10**9
                ),
            )
            for bid in feed_order:
                try_feed(bid)

        # 每天都要檢查休眠中的寶貝：虛弱/深沉睡眠會暫停孵化累積（這個模擬的學生 3 天一上線，
        # 間隔 ≤ 4 天 < weaken_after_days，所以理論上不會真的虛弱——這裡仍然照規則跑，
        # 用來證明「不會意外卡住」，不是只用口頭保證）
        for bid, state in list(owned.items()):
            if state["dormant"] is None:
                continue
            gap = day - state["last_cared_at"]
            if gap > weaken_after:
                continue  # 虛弱中，暫停累積（不倒退）
            state["dormant"]["hatch_progress"] += 1
            if state["dormant"]["hatch_progress"] >= state["dormant"]["hatch_days_required"]:
                baby = babies_by_id[bid]
                state["stage_index"] += 1
                state["fed_current_stage"] = 0
                state["dormant"] = None
                state.pop("fed_by_flavor", None)  # 下一階段的配額不同，重新計算
                if state["stage_index"] <= baby["stage_count"]:
                    pass  # 進入下一個可見階段，等下次上課繼續餵食
                # 若超過 stage_count，代表已經孵化到最終型態

    # ---- 統計輸出 ----
    by_rarity_owned: dict[str, int] = {}
    by_rarity_final: dict[str, int] = {}
    stuck_in_stage_1 = []
    for bid, state in owned.items():
        baby = babies_by_id[bid]
        by_rarity_owned[baby["rarity"]] = by_rarity_owned.get(baby["rarity"], 0) + 1
        if state["stage_index"] > baby["stage_count"]:
            by_rarity_final[baby["rarity"]] = by_rarity_final.get(baby["rarity"], 0) + 1
        if state["stage_index"] == 1 and state["dormant"] is None and state["fed_current_stage"] == 0:
            stuck_in_stage_1.append(bid)

    never_encountered_rarities = [
        r for r in ["common", "uncommon", "rare", "epic", "legendary"]
        if by_rarity_owned.get(r, 0) == 0
    ]

    # 逐隻列出目前停在第幾階段（不是只看「有沒有到最終型態」）——用來核對分層目標
    # 「稀有多數停在第 2~3 階段」「史詩/傳說多半還在前兩階段」是不是真的落在那個區間，
    # 不是只看「沒到頂」就當作達標（沒到頂也可能是卡在第 1 階段，不符合分層目標）。
    stage_detail = sorted(
        (
            {
                "baby_id": bid,
                "rarity": babies_by_id[bid]["rarity"],
                "stage_index": min(state["stage_index"], babies_by_id[bid]["stage_count"]),
                "stage_count": babies_by_id[bid]["stage_count"],
                "dormant": state["dormant"] is not None,
                "reached_final": state["stage_index"] > babies_by_id[bid]["stage_count"],
            }
            for bid, state in owned.items()
        ),
        key=lambda d: (d["rarity"], d["baby_id"]),
    )

    report = {
        "schedule_days": TOTAL_DAYS,
        "lessons_visited": len(chosen_lessons),
        "stations_visited": stats["stations_visited"],
        "fragments_collected_by_flavor": stats["fragments_collected_by_flavor"],
        "fragments_remaining_in_wallet": wallet,
        "encounters_triggered": stats["encounters_triggered"],
        "duplicate_bonus_events": stats["duplicate_bonus_events"],
        "babies_owned_total": len(owned),
        "babies_owned_by_rarity": by_rarity_owned,
        "babies_reached_final_stage_by_rarity": by_rarity_final,
        "babies_untouched_since_catch": len(stuck_in_stage_1),
        "rarities_never_encountered_this_semester": never_encountered_rarities,
        "stage_detail": stage_detail,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))

    # ---- 供給 vs 需求分析（全平台終生供給，不受一學期限制）----
    all_stations_platform: list[tuple[str, str]] = []
    for stations in lesson_stations.values():
        all_stations_platform.extend(stations)
    supply_by_flavor: dict[str, float] = {f: 0.0 for f in fragments_doc["flavor_families"]}
    for station, flavor in all_stations_platform:
        supply_by_flavor[flavor] += drop_prob[flavor]

    demand_by_flavor: dict[str, float] = {f: 0.0 for f in fragments_doc["flavor_families"]}
    for b in babies_doc["babies"]:
        if any("fragments_by_flavor" in s for s in b["stages"]):
            # 史詩／傳說：每階段各口味的配額是明寫的，直接加總，不用均分近似
            # （見 generate_config.py 的 CLASSICAL_CAP_BY_RARITY）
            for stage in b["stages"]:
                for flavor, amt in stage.get("fragments_by_flavor", {}).items():
                    demand_by_flavor[flavor] += amt
        else:
            total_need = sum(stage["fragments_to_finish_stage"] for stage in b["stages"])
            # 均分給牠的飲食口味（簡化：假設玩家會平均湊，不是只餵單一口味）
            per_flavor = total_need / len(b["diet_flavors"])
            for flavor in b["diet_flavors"]:
                demand_by_flavor[flavor] += per_flavor

    print("\n=== 全平台終生供給 vs 100 隻寶貝全部養到最終型態的需求（期望值）===")
    for flavor in fragments_doc["flavor_families"]:
        supply = supply_by_flavor[flavor]
        demand = demand_by_flavor[flavor]
        ratio = (supply / demand) if demand else float("inf")
        print(f"{flavor}: 供給≈{supply:.1f} 片／需求≈{demand:.1f} 片／供需比={ratio:.2f}")


if __name__ == "__main__":
    main()
