"""
UHSAA Boys Soccer RPI Calculator
=================================
Implements the official UHSAA Post-Season Ranking (PSR) formula exactly:

    RPI = (45% x MWP) + (45% x OWP) + (10% x OOWP)

Key differences from generic RPI:
  - MWP (Modified Winning Percentage): accounts for cross-classification game values
  - Cross-class exemptions: lower-class opponents count as full value for first 3 wins
  - Head-to-head games excluded from OWP and OOWP calculations
  - OWP = average of each opponent's MWP (not combined record)
  - OOWP = average of each opp-of-opp's MWP (excluding games vs the common opponent)

Soccer classification game values (UHSAA):
  2A, 3A opponents -> game value 1.0
  4A, 5A, 6A, out-of-state -> game value 1.25
  3 cross-class exemptions: when a 4A-6A team beats a 2A/3A opponent,
  the first 3 such wins count as full value; after that, true value (1.0).

Usage:
    python maxpreps_rpi_v2.py

Requires: pip install requests beautifulsoup4
"""

import re
import time
import json
import requests
from bs4 import BeautifulSoup

# ── CONFIG ─────────────────────────────────────────────────────────────────
MY_TEAM_SLUG     = "ut/orem/timpanogos-timberwolves"
MY_CLASSIFICATION = 4       # UHSAA class: 2, 3, 4, 5, or 6
SEASON            = "spring"
THROTTLE          = 0.5     # seconds between requests
# ──────────────────────────────────────────────────────────────────────────

BASE_URL = "https://www.maxpreps.com"
HEADERS  = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Referer":    "https://www.maxpreps.com/",
    "Accept":     "application/json, text/html",
}

GAME_VALUE             = {2: 1.0, 3: 1.0, 4: 1.25, 5: 1.25, 6: 1.25, "oos": 1.25}
LOWER_CLASS_VALUES     = {2, 3}
CROSS_CLASS_EXEMPTIONS = 3

_build_id_cache = None


def get_build_id():
    global _build_id_cache
    if _build_id_cache:
        return _build_id_cache
    print("Fetching MaxPreps build ID...")
    r = requests.get(BASE_URL, headers=HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    tag  = soup.find("script", id="__NEXT_DATA__")
    if not tag:
        raise RuntimeError("Could not find __NEXT_DATA__ on MaxPreps homepage.")
    data = json.loads(tag.string)
    _build_id_cache = data["buildId"].strip()
    print(f"  Build ID: {_build_id_cache}")
    return _build_id_cache


def schedule_url(team_slug):
    return f"{BASE_URL}/_next/data/{get_build_id()}/{team_slug}/soccer/{SEASON}/schedule.json"


def url_to_slug(full_url):
    path  = full_url.replace(BASE_URL + "/", "").strip("/")
    parts = path.split("/")
    return "/".join(parts[:3]) if len(parts) >= 3 else path


def parse_result(description):
    if " won "  in description: return True
    if " lost " in description: return False
    if " tied " in description: return None
    raise ValueError("unplayed")


def get_classification_from_data(data):
    try:
        division = (data.get("pageProps", {})
                        .get("teamContext", {})
                        .get("data", {})
                        .get("stateDivisionName", ""))
        m = re.search(r"(\d)A", division)
        if m:
            return int(m.group(1))
    except Exception:
        pass
    return "oos"


def get_schedule(team_slug):
    url = schedule_url(team_slug)
    try:
        r = requests.get(url, headers=HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"    warning: Could not fetch {team_slug}: {e}")
        return [], "oos"

    classification = get_classification_from_data(data)
    events = (data.get("pageProps", {})
                  .get("linkedDataJson", {})
                  .get("mainEntity", {})
                  .get("event", []))

    games = []
    for ev in events:
        try:
            won = parse_result(ev.get("description", ""))
        except ValueError:
            continue
        away_slug = url_to_slug(ev.get("awayTeam", {}).get("url", ""))
        home_slug = url_to_slug(ev.get("homeTeam", {}).get("url", ""))
        away_name = ev.get("awayTeam", {}).get("name", "")
        home_name = ev.get("homeTeam", {}).get("name", "")
        if away_slug == team_slug:
            # We are the away team — description is from our perspective
            opp_slug, opp_name = home_slug, home_name
            our_result = won
        else:
            # We are the home team — description is from away team's perspective, flip it
            opp_slug, opp_name = away_slug, away_name
            our_result = (not won) if won is not None else None

        games.append({"opponent_slug": opp_slug, "opponent_name": opp_name, "won": our_result})
    return games, classification


def calc_mwp(games, my_classification, opp_classifications, exclude_slug=None):
    my_gv = GAME_VALUE.get(my_classification, 1.25)
    exemptions_used  = 0
    total_win_value  = 0.0
    total_game_value = 0.0

    for g in games:
        if exclude_slug and g["opponent_slug"] == exclude_slug:
            continue
        opp_class   = opp_classifications.get(g["opponent_slug"], "oos")
        true_opp_gv = GAME_VALUE.get(opp_class, 1.25)

        is_higher_vs_lower = (
            g["won"] is True
            and isinstance(my_classification, int)
            and isinstance(opp_class, int)
            and opp_class in LOWER_CLASS_VALUES
            and my_classification not in LOWER_CLASS_VALUES
        )
        if is_higher_vs_lower and exemptions_used < CROSS_CLASS_EXEMPTIONS:
            effective_opp_gv = my_gv
            exemptions_used += 1
        else:
            effective_opp_gv = true_opp_gv

        game_value = (my_gv + effective_opp_gv) / 2.0
        win_value  = game_value if g["won"] is True else (game_value * 0.5 if g["won"] is None else 0.0)

        total_win_value  += win_value
        total_game_value += game_value

    return total_win_value / total_game_value if total_game_value else 0.0


def calculate_rpi(team_slug, my_classification):
    print(f"\n{'='*62}")
    print(f"  UHSAA RPI Calculator -- {team_slug}  ({my_classification}A)")
    print(f"{'='*62}")

    # Level 1
    print("\nFetching our schedule...")
    l1_games, _ = get_schedule(team_slug)
    wins   = sum(1 for g in l1_games if g["won"] is True)
    losses = sum(1 for g in l1_games if g["won"] is False)
    ties   = sum(1 for g in l1_games if g["won"] is None)
    record = f"{wins}-{losses}" + (f"-{ties}" if ties else "")
    print(f"  Record: {record}  ({len(l1_games)} completed games)")

    # Level 2
    unique_opp_slugs = list(dict.fromkeys(g["opponent_slug"] for g in l1_games))
    print(f"\nFetching {len(unique_opp_slugs)} opponent schedules (Level 2)...")
    opp_data = {}
    for slug in unique_opp_slugs:
        time.sleep(THROTTLE)
        games, cls = get_schedule(slug)
        opp_data[slug] = (games, cls)

    classifications = {team_slug: my_classification}
    for slug, (_, cls) in opp_data.items():
        classifications[slug] = cls

    # Level 3
    opp_opp_needed = set()
    for slug, (games, _) in opp_data.items():
        for g in games:
            s = g["opponent_slug"]
            if s != team_slug and s not in opp_data:
                opp_opp_needed.add(s)

    print(f"\nFetching {len(opp_opp_needed)} opp-of-opp schedules (Level 3)...")
    opp_opp_data = {}
    for slug in opp_opp_needed:
        time.sleep(THROTTLE)
        games, cls = get_schedule(slug)
        opp_opp_data[slug] = (games, cls)
        classifications[slug] = cls

    all_team_data = {**opp_data, **opp_opp_data}

    # MWP
    mwp = calc_mwp(l1_games, my_classification, classifications)
    print(f"\n  MWP: {mwp:.4f}")

    # OWP
    print("\n  Opponent MWP breakdown:")
    opp_mwp_list = []
    for slug in unique_opp_slugs:
        opp_games, opp_cls = opp_data[slug]
        opp_name = next((g["opponent_name"] for g in l1_games if g["opponent_slug"] == slug), slug)
        opp_mwp  = calc_mwp(opp_games, opp_cls if isinstance(opp_cls, int) else my_classification,
                             classifications, exclude_slug=team_slug)
        opp_mwp_list.append(opp_mwp)
        opp_w = sum(1 for g in opp_games if g["won"] is True)
        opp_l = sum(1 for g in opp_games if g["won"] is False)
        cls_label = f"{opp_cls}A" if isinstance(opp_cls, int) else str(opp_cls)
        print(f"    {opp_name:42s}  {opp_w}-{opp_l}  MWP={opp_mwp:.4f}  ({cls_label})")

    owp = sum(opp_mwp_list) / len(opp_mwp_list) if opp_mwp_list else 0.0
    print(f"\n  OWP (avg opp MWP, H2H excluded): {owp:.4f}")

    # OOWP
    oowp_per_opp = []
    for opp_slug in unique_opp_slugs:
        opp_games, _ = opp_data[opp_slug]
        oo_slugs = list(dict.fromkeys(
            g["opponent_slug"] for g in opp_games if g["opponent_slug"] != team_slug
        ))
        oo_mwps = []
        for oo_slug in oo_slugs:
            if oo_slug not in all_team_data:
                continue
            oo_games, oo_cls = all_team_data[oo_slug]
            oo_mwp = calc_mwp(oo_games, oo_cls if isinstance(oo_cls, int) else my_classification,
                               classifications, exclude_slug=opp_slug)
            oo_mwps.append(oo_mwp)
        if oo_mwps:
            oowp_per_opp.append(sum(oo_mwps) / len(oo_mwps))

    oowp = sum(oowp_per_opp) / len(oowp_per_opp) if oowp_per_opp else 0.0
    print(f"  OOWP (avg opp-of-opp MWP):       {oowp:.4f}")

    rpi = round(0.45 * mwp + 0.45 * owp + 0.10 * oowp, 4)

    return {
        "team":              team_slug,
        "classification":    f"{my_classification}A",
        "record":            record,
        "games_counted":     len(l1_games),
        "opponents_counted": len(unique_opp_slugs),
        "opp_opp_counted":   len(opp_opp_data),
        "MWP":               round(mwp,  4),
        "OWP":               round(owp,  4),
        "OOWP":              round(oowp, 4),
        "RPI":               rpi,
        "formula":           "RPI = 0.45(MWP) + 0.45(OWP) + 0.10(OOWP)",
    }


if __name__ == "__main__":
    result = calculate_rpi(MY_TEAM_SLUG, MY_CLASSIFICATION)

    print(f"\n{'='*62}")
    print("  FINAL UHSAA RPI RESULT")
    print(f"{'='*62}")
    print(f"  Team:    {result['team']}")
    print(f"  Class:   {result['classification']}")
    print(f"  Record:  {result['record']}  ({result['games_counted']} games)")
    print(f"  MWP:     {result['MWP']:.4f}   (modified win %, 45% weight)")
    print(f"  OWP:     {result['OWP']:.4f}   (opponents' MWP, 45% weight, {result['opponents_counted']} teams)")
    print(f"  OOWP:    {result['OOWP']:.4f}   (opp-of-opp MWP, 10% weight, {result['opp_opp_counted']} teams)")
    print(f"  RPI:     {result['RPI']:.4f}")
    print(f"{'='*62}")
    print(f"  {result['formula']}")
    print()

    out_file = "rpi_result.json"
    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"Result saved to {out_file}")
