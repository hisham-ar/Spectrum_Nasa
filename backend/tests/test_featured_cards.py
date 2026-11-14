import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import featured_cards as fc  # noqa: E402


def test_approve_and_sync(tmp_path, monkeypatch, capsys):
    spec = {"cards": [
        {"slug": "a", "title": "A", "det": 1, "view": "survey", "build_dets": [1, 3], "verified": False, "ra": 1.0},
        {"slug": "b", "title": "B", "det": 3, "view": "survey", "verified": False},
    ]}
    ix = {"built_at": "x", "cards": [
        {"slug": "a", "title": "old", "det": 3, "view": "survey", "ra": 9.0, "sequences": {"1-survey": "a/d1-survey/", "3-survey": "a/d3-survey/"}},
    ]}
    sp, ip = tmp_path / "cards.json", tmp_path / "index.json"
    sp.write_text(json.dumps(spec)); ip.write_text(json.dumps(ix))
    monkeypatch.setattr(fc, "SPEC", sp)
    monkeypatch.setattr(fc, "INDEXES", [ip, tmp_path / "missing.json"])
    monkeypatch.setattr(sys, "argv", ["x", "approve", "a", "--by", "Sara"])
    assert fc.main() == 0
    card = json.loads(ip.read_text())["cards"][0]
    assert card["verified"] is True and card["verified_by"] == "Sara" and card["title"] == "A" and card["det"] == 1
    assert card["ra"] == 9.0 and "build_dets" not in card          # build's resolved position kept
    assert "b: not built yet" in capsys.readouterr().out
    monkeypatch.setattr(sys, "argv", ["x", "unapprove", "a"])
    fc.main()
    card = json.loads(ip.read_text())["cards"][0]
    assert card["verified"] is False and "verified_by" not in card
